import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type BritaRoutinesPlugin from "../main";
import { EngineSnapshot } from "./engine";
import { formatDuration } from "./routine";

export const VIEW_TYPE_ROUTINE_TIMER = "brita-routine-timer";

/**
 * Renderizador puro do estado do TimerEngine. Não guarda estado próprio:
 * ao abrir se inscreve no engine (que vive no plugin) e redesenha a cada
 * mudança; ao fechar só cancela a inscrição.
 */
export class RoutineTimerView extends ItemView {
	private unsubscribe: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: BritaRoutinesPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_ROUTINE_TIMER;
	}

	getDisplayText(): string {
		return "Brita Routines";
	}

	getIcon(): string {
		return "timer";
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.plugin.engine.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private render(): void {
		const snapshot = this.plugin.engine.getSnapshot();
		const root = this.contentEl;
		root.empty();
		root.addClass("brita-timer");

		this.renderHeader(root, snapshot);
		this.renderCountdown(root, snapshot);
		this.renderControls(root, snapshot);
		this.renderStepList(root, snapshot);
	}

	private renderHeader(root: HTMLElement, snapshot: EngineSnapshot): void {
		const header = root.createDiv({ cls: "brita-header" });
		header.createEl("h4", {
			text: snapshot.routine.name,
			cls: "brita-routine-name",
		});
		const reload = header.createEl("button", {
			cls: "brita-icon-button clickable-icon",
			attr: { "aria-label": "Recarregar rotina do arquivo" },
		});
		setIcon(reload, "refresh-cw");
		reload.addEventListener("click", () => void this.plugin.loadRoutine(true));
	}

	private renderCountdown(root: HTMLElement, snapshot: EngineSnapshot): void {
		const box = root.createDiv({ cls: "brita-countdown" });
		if (snapshot.status === "finished") {
			box.createDiv({ cls: "brita-step-name", text: "Rotina concluída 🎉" });
			box.createDiv({ cls: "brita-step-time", text: "00:00" });
		} else {
			box.createDiv({
				cls: "brita-step-name",
				text: snapshot.currentStep?.name ?? "—",
			});
			box.createDiv({
				cls: "brita-step-time",
				text: formatDuration(snapshot.stepRemainingSec),
			});
		}
		box.createDiv({
			cls: "brita-total-time",
			text: `Total restante: ${formatDuration(snapshot.totalRemainingSec)}`,
		});
	}

	private renderControls(root: HTMLElement, snapshot: EngineSnapshot): void {
		const controls = root.createDiv({ cls: "brita-controls" });
		const engine = this.plugin.engine;

		const button = (
			label: string,
			onClick: () => void,
			primary = false,
		): HTMLButtonElement => {
			const el = controls.createEl("button", { text: label });
			if (primary) el.addClass("mod-cta");
			el.addEventListener("click", onClick);
			return el;
		};

		switch (snapshot.status) {
			case "idle":
				button("Iniciar", () => engine.start(), true);
				break;
			case "running":
				button("Pausar", () => engine.pause(), true);
				button("Pular", () => engine.skip());
				break;
			case "paused":
				button("Retomar", () => engine.resume(), true);
				button("Pular", () => engine.skip());
				break;
			case "finished":
				button("Recomeçar", () => engine.start(), true);
				break;
		}
		if (snapshot.status !== "idle") {
			button("Resetar", () => engine.reset());
		}
	}

	private renderStepList(root: HTMLElement, snapshot: EngineSnapshot): void {
		const list = root.createEl("ol", { cls: "brita-steps" });
		snapshot.routine.steps.forEach((step, index) => {
			const item = list.createEl("li", { cls: "brita-step" });
			const done =
				snapshot.status === "finished" || index < snapshot.stepIndex;
			if (done) item.addClass("is-done");
			if (snapshot.status !== "finished" && index === snapshot.stepIndex) {
				item.addClass("is-current");
			}
			item.createSpan({ cls: "brita-step-label", text: step.name });
			item.createSpan({
				cls: "brita-step-duration",
				text: formatDuration(step.durationSec),
			});
		});
	}
}
