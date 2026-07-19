import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type BritaRoutinesPlugin from "../main";
import { EngineSnapshot, EngineStatus } from "./engine";
import { Routine, formatDuration } from "./routine";

export const VIEW_TYPE_ROUTINE_TIMER = "brita-routine-timer";

/**
 * Renderizador do estado do TimerEngine. Não guarda estado de timer:
 * ao abrir se inscreve no engine (que vive no plugin) e redesenha a cada
 * mudança; ao fechar só cancela a inscrição.
 *
 * O DOM só é reconstruído quando status ou rotina mudam (os controles e a
 * lista dependem deles). Nos demais ticks, apenas os textos do countdown e
 * as classes da lista são atualizados no lugar — assim foco de teclado e
 * cliques não são destruídos com o timer rodando, e a região aria-live do
 * nome do passo persiste para anunciar trocas de passo.
 */
export class RoutineTimerView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	private unsubscribeList: (() => void) | null = null;
	private builtStatus: EngineStatus | null = null;
	private builtRoutine: Routine | null = null;
	private stepNameEl: HTMLElement | null = null;
	private stepTimeEl: HTMLElement | null = null;
	private totalTimeEl: HTMLElement | null = null;
	private stepItems: HTMLElement[] = [];

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
		// Lista de rotinas mudou (nota criada/renomeada/apagada na pasta):
		// força um build() para reconstruir o dropdown do header.
		this.unsubscribeList = this.plugin.onRoutineListChanged(() => {
			this.builtRoutine = null;
			this.render();
		});
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.unsubscribeList?.();
		this.unsubscribeList = null;
		this.builtStatus = null;
		this.builtRoutine = null;
	}

	private render(): void {
		const snapshot = this.plugin.engine.getSnapshot();
		if (
			snapshot.status !== this.builtStatus ||
			snapshot.routine !== this.builtRoutine
		) {
			this.build(snapshot);
		}
		this.update(snapshot);
	}

	/** Reconstrói o DOM inteiro (mudança de status ou de rotina). */
	private build(snapshot: EngineSnapshot): void {
		this.builtStatus = snapshot.status;
		this.builtRoutine = snapshot.routine;
		const root = this.contentEl;
		root.empty();
		root.addClass("brita-timer");

		this.renderHeader(root, snapshot);
		this.renderCountdown(root, snapshot);
		this.renderControls(root, snapshot);
		this.renderStepList(root, snapshot);
	}

	/** Atualiza no lugar o que muda a cada tick/passo, sem reconstruir. */
	private update(snapshot: EngineSnapshot): void {
		this.stepNameEl?.setText(snapshot.currentStep?.name ?? "—");
		this.stepTimeEl?.setText(formatDuration(snapshot.stepRemainingSec));
		this.totalTimeEl?.setText(
			`Total restante: ${formatDuration(snapshot.totalRemainingSec)}`,
		);
		this.stepItems.forEach((item, index) => {
			item.toggleClass(
				"is-done",
				snapshot.status === "finished" || index < snapshot.stepIndex,
			);
			item.toggleClass(
				"is-current",
				snapshot.status !== "finished" && index === snapshot.stepIndex,
			);
		});
	}

	private renderHeader(root: HTMLElement, snapshot: EngineSnapshot): void {
		const header = root.createDiv({ cls: "brita-header" });
		this.renderRoutineSelect(header, snapshot);
		const reload = header.createEl("button", {
			cls: "brita-icon-button clickable-icon",
			attr: { "aria-label": "Recarregar rotina do arquivo" },
		});
		setIcon(reload, "refresh-cw");
		reload.addEventListener("click", () => {
			const status = this.plugin.engine.getSnapshot().status;
			const inProgress = status === "running" || status === "paused";
			if (
				inProgress &&
				!confirm(
					"A rotina está em andamento. Recarregar o arquivo reseta o timer. Continuar?",
				)
			) {
				return;
			}
			void this.plugin.loadRoutine(true);
		});
	}

	/**
	 * Dropdown com as rotinas da pasta configurada. Quando a rotina em uso
	 * não está na lista (Rotina.md legado ou sample embutido), ela entra
	 * como opção extra selecionada, para o header sempre mostrar o nome.
	 */
	private renderRoutineSelect(
		header: HTMLElement,
		snapshot: EngineSnapshot,
	): void {
		const files = this.plugin.listRoutineFiles();
		const activePath = this.plugin.settings.activeRoutinePath;
		const select = header.createEl("select", {
			cls: "dropdown brita-routine-select",
			attr: { "aria-label": "Escolher rotina" },
		});
		const inList =
			activePath !== null && files.some((f) => f.path === activePath);
		if (!inList) {
			select.createEl("option", {
				text: snapshot.routine.name,
				attr: { value: "" },
			});
		}
		for (const file of files) {
			select.createEl("option", {
				text: file.basename,
				attr: { value: file.path },
			});
		}
		select.value = inList && activePath !== null ? activePath : "";
		const previous = select.value;
		select.addEventListener("change", () => {
			const status = this.plugin.engine.getSnapshot().status;
			const inProgress = status === "running" || status === "paused";
			if (
				inProgress &&
				!confirm(
					"A rotina está em andamento. Trocar a rotina reseta o timer. Continuar?",
				)
			) {
				select.value = previous;
				return;
			}
			void this.plugin.setActiveRoutine(select.value || null, true);
		});
	}

	private renderCountdown(root: HTMLElement, snapshot: EngineSnapshot): void {
		const box = root.createDiv({ cls: "brita-countdown" });
		if (snapshot.status === "finished") {
			this.stepNameEl = null;
			this.stepTimeEl = null;
			box.createDiv({ cls: "brita-step-name", text: "Rotina concluída 🎉" });
			box.createDiv({ cls: "brita-step-time", text: "00:00" });
		} else {
			// aria-live no nome (não no relógio, que muda a cada segundo):
			// leitores de tela anunciam a troca de passo.
			this.stepNameEl = box.createDiv({
				cls: "brita-step-name",
				attr: { "aria-live": "polite" },
			});
			this.stepTimeEl = box.createDiv({ cls: "brita-step-time" });
		}
		this.totalTimeEl = box.createDiv({ cls: "brita-total-time" });
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
		this.stepItems = snapshot.routine.steps.map((step) => {
			const item = list.createEl("li", { cls: "brita-step" });
			item.createSpan({ cls: "brita-step-label", text: step.name });
			item.createSpan({
				cls: "brita-step-duration",
				text: formatDuration(step.durationSec),
			});
			return item;
		});
	}
}
