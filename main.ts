import { Notice, Plugin, TFile, TFolder } from "obsidian";
import { SessionRecord, TimerEngine } from "./src/engine";
import { formatSessionEntry, HISTORY_FILE_HEADER } from "./src/history";
import { SAMPLE_ROUTINE, parseRoutine } from "./src/routine";
import {
	BritaSettings,
	BritaSettingTab,
	DEFAULT_SETTINGS,
	normalizeFolder,
} from "./src/settings";
import { beep, closeAudio } from "./src/sound";
import { RoutineTimerView, VIEW_TYPE_ROUTINE_TIMER } from "./src/view";

/** Arquivo único da versão anterior; mantido como fallback de migração. */
const LEGACY_ROUTINE_PATH = "Rotina.md";
const TICK_INTERVAL_MS = 250;

export default class BritaRoutinesPlugin extends Plugin {
	engine: TimerEngine;
	settings: BritaSettings;
	/** Path efetivamente carregado no engine (pode ser o legado; null = sample). */
	private loadedRoutinePath: string | null = null;
	private routineListListeners = new Set<() => void>();

	async onload() {
		await this.loadSettings();

		// O engine vive no plugin: fechar a view não pausa nem reseta o timer.
		this.engine = new TimerEngine({
			onStepComplete: (step, _index, isLast) => {
				// No último passo, onRoutineComplete cuida do aviso — evita
				// Notice duplo e beep(1) sobreposto ao beep(3).
				if (isLast) return;
				new Notice(`Passo concluído: ${step.name}`);
				beep(1);
			},
			onRoutineComplete: (routine) => {
				new Notice(`Rotina concluída: ${routine.name} 🎉`);
				beep(3);
			},
			onSessionEnd: (record) => {
				void this.appendSessionToHistory(record);
			},
		});

		this.addSettingTab(new BritaSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_ROUTINE_TIMER,
			(leaf) => new RoutineTimerView(leaf, this),
		);

		this.addRibbonIcon("timer", "Abrir Brita Routines", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-timer-panel",
			name: "Abrir painel de rotina",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "toggle-timer",
			name: "Iniciar/pausar rotina",
			callback: () => {
				const { status } = this.engine.getSnapshot();
				if (status === "running") this.engine.pause();
				else this.engine.start();
			},
		});

		this.registerInterval(
			window.setInterval(() => this.engine.tick(), TICK_INTERVAL_MS),
		);

		// Recarrega sozinho quando a rotina ativa muda — mas só com o timer
		// parado, para não resetar uma execução em andamento.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				// Observa também a selecionada (pode divergir da carregada
				// quando ela estava inválida e a cascata caiu num fallback).
				if (
					file.path !== this.loadedRoutinePath &&
					file.path !== this.settings.activeRoutinePath
				) {
					return;
				}
				if (this.engine.getSnapshot().status !== "idle") return;
				void this.loadRoutine(false);
			}),
		);

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (this.isInRoutinesFolder(file.path)) {
					this.notifyRoutineListChanged();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file.path === this.settings.activeRoutinePath) {
					this.settings.activeRoutinePath = null;
					void this.saveSettings();
					if (this.engine.getSnapshot().status === "idle") {
						void this.loadRoutine(false);
					}
				}
				if (this.isInRoutinesFolder(file.path)) {
					this.notifyRoutineListChanged();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (oldPath === this.settings.activeRoutinePath) {
					this.settings.activeRoutinePath = file.path;
					void this.saveSettings();
					if (oldPath === this.loadedRoutinePath) {
						this.loadedRoutinePath = file.path;
					}
				}
				if (
					this.isInRoutinesFolder(file.path) ||
					this.isInRoutinesFolder(oldPath)
				) {
					this.notifyRoutineListChanged();
				}
			}),
		);

		// O índice do vault só está pronto após o layout carregar.
		this.app.workspace.onLayoutReady(() => void this.loadRoutine(false));
	}

	onunload(): void {
		closeAudio();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Notas .md diretas da pasta de rotinas (exclui o arquivo de histórico). */
	listRoutineFiles(): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(
			normalizeFolder(this.settings.routinesFolder),
		);
		if (!(folder instanceof TFolder)) return [];
		return folder.children
			.filter(
				(child): child is TFile =>
					child instanceof TFile &&
					child.extension === "md" &&
					child.path !== this.settings.historyFilePath,
			)
			.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	/** Troca a rotina ativa (reseta o timer via setRoutine). */
	async setActiveRoutine(path: string | null, notify: boolean): Promise<void> {
		this.settings.activeRoutinePath = path;
		await this.saveSettings();
		await this.loadRoutine(notify);
	}

	onRoutineListChanged(listener: () => void): () => void {
		this.routineListListeners.add(listener);
		return () => this.routineListListeners.delete(listener);
	}

	notifyRoutineListChanged(): void {
		for (const listener of this.routineListListeners) listener();
	}

	private isInRoutinesFolder(path: string): boolean {
		return path.startsWith(
			normalizeFolder(this.settings.routinesFolder) + "/",
		);
	}

	/**
	 * Resolve a rotina em cascata: selecionada → primeira da pasta →
	 * Rotina.md legado → sample embutido.
	 */
	async loadRoutine(notify: boolean): Promise<void> {
		const candidates: TFile[] = [];
		const active = this.settings.activeRoutinePath
			? this.app.vault.getAbstractFileByPath(this.settings.activeRoutinePath)
			: null;
		if (active instanceof TFile) candidates.push(active);
		candidates.push(...this.listRoutineFiles());
		const legacy = this.app.vault.getAbstractFileByPath(LEGACY_ROUTINE_PATH);
		if (legacy instanceof TFile) candidates.push(legacy);

		for (const file of candidates) {
			const content = await this.app.vault.cachedRead(file);
			const routine = parseRoutine(content, file.basename);
			if (!routine) continue;
			this.loadedRoutinePath = file.path;
			// Persiste a auto-seleção, mas nunca sobrescreve uma escolha
			// explícita do usuário (a rotina dele pode estar só
			// temporariamente inválida, no meio de uma edição).
			if (
				this.settings.activeRoutinePath === null &&
				file.path !== LEGACY_ROUTINE_PATH
			) {
				this.settings.activeRoutinePath = file.path;
				await this.saveSettings();
			}
			this.engine.setRoutine(routine);
			if (notify) {
				new Notice(
					`Rotina carregada: ${routine.name} (${routine.steps.length} passo(s))`,
				);
			}
			return;
		}

		this.loadedRoutinePath = null;
		this.engine.setRoutine(SAMPLE_ROUTINE);
		if (notify) {
			new Notice("Nenhuma rotina válida encontrada — usando exemplo");
		}
	}

	/** Anexa uma sessão ao arquivo de histórico, criando-o se preciso. */
	private async appendSessionToHistory(record: SessionRecord): Promise<void> {
		if (!this.settings.historyEnabled) return;
		const path = this.settings.historyFilePath;
		const entry = formatSessionEntry(record);
		try {
			await this.ensureParentFolders(path);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				await this.app.vault.process(file, (data) =>
					data.replace(/\n*$/, "\n") + entry,
				);
			} else {
				await this.app.vault.create(path, HISTORY_FILE_HEADER + entry);
			}
		} catch (error) {
			console.error("Brita Routines: falha ao gravar histórico", error);
			new Notice("Não foi possível gravar o histórico da rotina");
		}
	}

	private async ensureParentFolders(filePath: string): Promise<void> {
		const parts = filePath.split("/").slice(0, -1);
		let prefix = "";
		for (const part of parts) {
			prefix = prefix ? `${prefix}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(prefix)) {
				await this.app.vault.createFolder(prefix).catch(() => undefined);
			}
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_ROUTINE_TIMER);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_ROUTINE_TIMER, active: true });
		await workspace.revealLeaf(leaf);
	}
}
