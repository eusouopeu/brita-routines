import { ItemView, TAbstractFile, TFile, WorkspaceLeaf, moment, setIcon } from "obsidian";
import { appHasDailyNotesPluginLoaded } from "obsidian-daily-notes-interface";
import type BritaRoutinesPlugin from "../main";
import { formatDuration, totalDurationSec } from "./routine";
import { ScheduledEntry, formatMinutes, parseSchedule } from "./schedule";

export const VIEW_TYPE_DAY_PLANNER = "brita-day-planner";

/** Minutos desde a meia-noite, agora. */
function currentMinutes(): number {
	const d = new Date();
	return d.getHours() * 60 + d.getMinutes();
}

/**
 * Timeline do dia na barra lateral. Lê o plano da nota diária de hoje (via
 * Daily Notes core), desenha os compromissos ordenados por horário com uma
 * linha do "agora", e transforma cada rotina (inline ou referenciada) num
 * botão que carrega e inicia a rotina no engine.
 *
 * O conteúdo lido fica em cache (`content`); o vault só é relido quando a
 * nota de hoje muda ou o dia vira. O tick de 30 s apenas redesenha para
 * reposicionar a linha do "agora".
 */
export class DayPlannerView extends ItemView {
	private content: string | null = null;
	private file: TFile | null = null;
	private renderedDay = "";

	constructor(leaf: WorkspaceLeaf, private plugin: BritaRoutinesPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DAY_PLANNER;
	}

	getDisplayText(): string {
		return "Planner do dia";
	}

	getIcon(): string {
		return "calendar-clock";
	}

	async onOpen(): Promise<void> {
		// Modify dispara em qualquer nota; filtra pela nota de hoje. Create/
		// rename/delete podem criar ou renomear a nota de hoje, ou mexer numa
		// rotina referenciada — reler é barato.
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (this.file && f.path === this.file.path) void this.refresh();
			}),
		);
		this.registerEvent(this.app.vault.on("create", () => void this.refresh()));
		this.registerEvent(this.app.vault.on("delete", () => void this.refresh()));
		this.registerEvent(this.app.vault.on("rename", () => void this.refresh()));
		// Lista de rotinas mudou: uma referência "@Rotina" pode ter passado a
		// existir (ou deixado de existir). onRoutineListChanged devolve um
		// unsubscribe — registra-o como disposer do componente.
		this.register(this.plugin.onRoutineListChanged(() => this.draw()));
		this.registerInterval(
			window.setInterval(() => this.tickNow(), 30_000),
		);
		void this.refresh();
	}

	async onClose(): Promise<void> {
		this.content = null;
		this.file = null;
	}

	/** Relê a nota de hoje e redesenha. */
	private async refresh(): Promise<void> {
		this.file =
			appHasDailyNotesPluginLoaded() ? this.plugin.getTodayDailyNote() : null;
		this.content = this.file
			? await this.app.vault.cachedRead(this.file)
			: null;
		this.renderedDay = moment().format("YYYY-MM-DD");
		this.draw();
	}

	private tickNow(): void {
		// Virada de dia → nota diferente; senão só reposiciona a linha do agora.
		if (moment().format("YYYY-MM-DD") !== this.renderedDay) {
			void this.refresh();
		} else {
			this.draw();
		}
	}

	/** Reconstrói o DOM a partir do conteúdo já em cache. */
	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("brita-planner");

		this.renderHeader(root);

		if (!appHasDailyNotesPluginLoaded()) {
			this.renderEmpty(
				root,
				'Ative o plugin core "Daily notes" para ver o planner do dia.',
			);
			return;
		}
		if (!this.file) {
			this.renderEmpty(root, "Ainda não há nota diária para hoje.");
			return;
		}
		const entries = this.content ? parseSchedule(this.content) : [];
		if (entries.length === 0) {
			this.renderEmpty(
				root,
				"Nenhum compromisso no plano de hoje. Escreva linhas como “- 07:30 - @Rotina” na nota diária.",
			);
			return;
		}
		this.renderTimeline(root, entries);
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "brita-planner-header" });
		const titles = header.createDiv({ cls: "brita-planner-titles" });
		titles.createDiv({ cls: "brita-planner-title", text: "Hoje" });
		titles.createDiv({
			cls: "brita-planner-date",
			text: moment().format("DD/MM/YYYY"),
		});
		const open = header.createEl("button", {
			cls: "brita-icon-button clickable-icon",
			attr: { "aria-label": "Abrir nota diária de hoje" },
		});
		setIcon(open, "calendar-days");
		open.addEventListener("click", () => void this.plugin.openTodayDailyNote());
	}

	private renderEmpty(root: HTMLElement, text: string): void {
		root.createDiv({ cls: "brita-planner-empty", text });
	}

	private renderTimeline(root: HTMLElement, entries: ScheduledEntry[]): void {
		const list = root.createDiv({ cls: "brita-planner-list" });
		const nowMin = currentMinutes();
		let nowPlaced = false;
		for (const entry of entries) {
			if (!nowPlaced && entry.startMinutes > nowMin) {
				this.renderNowLine(list, nowMin);
				nowPlaced = true;
			}
			this.renderEntry(list, entry);
		}
		if (!nowPlaced) this.renderNowLine(list, nowMin);
	}

	private renderNowLine(list: HTMLElement, nowMin: number): void {
		const row = list.createDiv({ cls: "brita-now" });
		row.createSpan({ cls: "brita-now-label", text: "agora" });
		row.createSpan({ cls: "brita-now-time", text: formatMinutes(nowMin) });
	}

	private renderEntry(list: HTMLElement, entry: ScheduledEntry): void {
		const row = list.createDiv({
			cls: `brita-entry brita-entry-${entry.kind}`,
		});

		const time = row.createDiv({ cls: "brita-entry-time" });
		time.setText(
			entry.endMinutes !== null
				? `${formatMinutes(entry.startMinutes)}–${formatMinutes(entry.endMinutes)}`
				: formatMinutes(entry.startMinutes),
		);

		const body = row.createDiv({ cls: "brita-entry-body" });
		body.createDiv({ cls: "brita-entry-title", text: entry.title });
		const meta = this.entryMeta(entry);
		if (meta) body.createDiv({ cls: "brita-entry-meta", text: meta });

		if (entry.kind === "event") return;

		const missingRef =
			entry.kind === "routine-ref" &&
			!this.plugin.hasRoutineNamed(entry.routineName ?? entry.title);
		const play = row.createEl("button", {
			cls: "brita-entry-play clickable-icon",
			attr: { "aria-label": `Iniciar ${entry.title}`, title: "Iniciar rotina" },
		});
		setIcon(play, "play");
		if (missingRef) {
			play.disabled = true;
		} else {
			play.addEventListener(
				"click",
				() => void this.plugin.startScheduledEntry(entry),
			);
		}
	}

	private entryMeta(entry: ScheduledEntry): string | null {
		if (entry.kind === "inline-routine") {
			const total = formatDuration(
				totalDurationSec({ name: entry.title, steps: entry.steps }),
			);
			return `rotina · ${entry.steps.length} passo(s) · ${total}`;
		}
		if (entry.kind === "routine-ref") {
			return this.plugin.hasRoutineNamed(entry.routineName ?? entry.title)
				? "abre rotina"
				: "rotina não encontrada";
		}
		return null;
	}
}
