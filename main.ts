import { Notice, Plugin, TFile } from "obsidian";
import { TimerEngine } from "./src/engine";
import { SAMPLE_ROUTINE, parseRoutine } from "./src/routine";
import { beep, closeAudio } from "./src/sound";
import { RoutineTimerView, VIEW_TYPE_ROUTINE_TIMER } from "./src/view";

/** Arquivo de rotina lido da raiz do vault (fallback: sample embutido). */
const ROUTINE_FILE_PATH = "Rotina.md";
const TICK_INTERVAL_MS = 250;

export default class BritaRoutinesPlugin extends Plugin {
	engine: TimerEngine;

	async onload() {
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
		});

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

		// Recarrega sozinho quando Rotina.md muda — mas só com o timer
		// parado, para não resetar uma execução em andamento.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file.path !== ROUTINE_FILE_PATH) return;
				if (this.engine.getSnapshot().status !== "idle") return;
				void this.loadRoutine(false);
			}),
		);

		// O índice do vault só está pronto após o layout carregar.
		this.app.workspace.onLayoutReady(() => void this.loadRoutine(false));
	}

	onunload(): void {
		closeAudio();
	}

	async loadRoutine(notify: boolean): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(ROUTINE_FILE_PATH);
		if (file instanceof TFile) {
			const content = await this.app.vault.cachedRead(file);
			const routine = parseRoutine(content, file.basename);
			if (routine) {
				this.engine.setRoutine(routine);
				if (notify) {
					new Notice(
						`Rotina recarregada: ${routine.steps.length} passo(s)`,
					);
				}
				return;
			}
			if (notify) {
				new Notice(
					`Nenhum passo válido em ${ROUTINE_FILE_PATH} — usando exemplo`,
				);
			}
		} else if (notify) {
			new Notice(`${ROUTINE_FILE_PATH} não encontrado — usando exemplo`);
		}
		this.engine.setRoutine(SAMPLE_ROUTINE);
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
