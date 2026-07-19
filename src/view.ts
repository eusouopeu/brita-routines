import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type BritaRoutinesPlugin from "../main";
import { EngineSnapshot, EngineStatus } from "./engine";
import { Routine, formatDuration, totalDurationSec } from "./routine";

export const VIEW_TYPE_ROUTINE_TIMER = "brita-routine-timer";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Geometria do anel de progresso (viewBox 120×120, raio 54). */
const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Horário local HH:MM daqui a `secFromNow` segundos. */
function formatClock(secFromNow: number): string {
	const d = new Date(Date.now() + secFromNow * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
	private stepEtaEl: HTMLElement | null = null;
	private routineEtaEl: HTMLElement | null = null;
	private ringProgressEl: SVGCircleElement | null = null;
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
		this.stepEtaEl?.setText(
			snapshot.currentStep
				? `termina às ${formatClock(snapshot.stepRemainingSec)}`
				: "",
		);
		this.routineEtaEl?.setText(
			snapshot.status === "finished"
				? ""
				: `Tudo acaba às ${formatClock(snapshot.totalRemainingSec)}`,
		);
		if (this.ringProgressEl) {
			// O arco cresce conforme o passo avança (offset = fração restante).
			const dur = snapshot.currentStep?.durationSec ?? 0;
			const frac =
				dur > 0
					? Math.min(1, Math.max(0, snapshot.stepRemainingSec / dur))
					: 0;
			this.ringProgressEl.style.strokeDashoffset = String(
				RING_CIRCUMFERENCE * frac,
			);
		}
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
		const wrap = box.createDiv({ cls: "brita-ring-wrap" });
		this.renderRing(wrap);
		const content = wrap.createDiv({ cls: "brita-ring-content" });
		if (snapshot.status === "finished") {
			this.stepNameEl = null;
			this.stepTimeEl = null;
			this.stepEtaEl = null;
			content.createDiv({
				cls: "brita-step-name",
				text: "Rotina concluída 🎉",
			});
			content.createDiv({ cls: "brita-step-time", text: "00:00" });
		} else {
			// aria-live no nome (não no relógio, que muda a cada segundo):
			// leitores de tela anunciam a troca de passo.
			this.stepNameEl = content.createDiv({
				cls: "brita-step-name",
				attr: { "aria-live": "polite" },
			});
			this.stepTimeEl = content.createDiv({ cls: "brita-step-time" });
			this.stepEtaEl = content.createDiv({ cls: "brita-step-eta" });
		}
		this.routineEtaEl = box.createDiv({ cls: "brita-routine-eta" });
	}

	/**
	 * Anel de progresso em SVG: trilha + arco com stroke em degradê. O
	 * update() só mexe no stroke-dashoffset do arco, sem reconstruir nada.
	 */
	private renderRing(wrap: HTMLElement): void {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "0 0 120 120");
		svg.classList.add("brita-ring");

		const defs = document.createElementNS(SVG_NS, "defs");
		const grad = document.createElementNS(SVG_NS, "linearGradient");
		grad.setAttribute("id", "brita-ring-grad");
		grad.setAttribute("x1", "0");
		grad.setAttribute("y1", "0");
		grad.setAttribute("x2", "1");
		grad.setAttribute("y2", "1");
		for (const [offset, cssVar] of [
			["0%", "--brita-accent-1"],
			["100%", "--brita-accent-2"],
		]) {
			const stop = document.createElementNS(SVG_NS, "stop");
			stop.setAttribute("offset", offset);
			stop.setAttribute("stop-color", `var(${cssVar})`);
			grad.appendChild(stop);
		}
		defs.appendChild(grad);
		svg.appendChild(defs);

		const circle = (cls: string): SVGCircleElement => {
			const el = document.createElementNS(SVG_NS, "circle");
			el.setAttribute("cx", "60");
			el.setAttribute("cy", "60");
			el.setAttribute("r", String(RING_RADIUS));
			el.setAttribute("fill", "none");
			el.classList.add(cls);
			svg.appendChild(el);
			return el;
		};
		circle("brita-ring-track");
		this.ringProgressEl = circle("brita-ring-progress");
		this.ringProgressEl.setAttribute("stroke", "url(#brita-ring-grad)");
		this.ringProgressEl.setAttribute(
			"stroke-dasharray",
			String(RING_CIRCUMFERENCE),
		);
		// Começa no topo, sentido horário.
		this.ringProgressEl.setAttribute("transform", "rotate(-90 60 60)");
		wrap.appendChild(svg);
	}

	private renderControls(root: HTMLElement, snapshot: EngineSnapshot): void {
		const controls = root.createDiv({ cls: "brita-controls" });
		const engine = this.plugin.engine;

		const iconButton = (
			icon: string,
			label: string,
			onClick: () => void,
			opts: { main?: boolean; disabled?: boolean } = {},
		): HTMLButtonElement => {
			const el = controls.createEl("button", {
				cls: opts.main ? "brita-ctrl brita-ctrl-main" : "brita-ctrl",
				attr: { "aria-label": label, title: label },
			});
			setIcon(el, icon);
			if (opts.disabled) el.disabled = true;
			el.addEventListener("click", onClick);
			return el;
		};

		const inProgress =
			snapshot.status === "running" || snapshot.status === "paused";

		iconButton("skip-back", "Voltar ao passo anterior", () => engine.back(), {
			disabled: !inProgress,
		});
		if (snapshot.status === "running") {
			iconButton("pause", "Pausar", () => engine.pause(), { main: true });
		} else {
			const label =
				snapshot.status === "paused"
					? "Retomar"
					: snapshot.status === "finished"
						? "Recomeçar"
						: "Iniciar";
			iconButton("play", label, () => engine.start(), { main: true });
		}
		iconButton("skip-forward", "Pular passo", () => engine.skip(), {
			disabled: !inProgress,
		});
		iconButton("rotate-ccw", "Resetar rotina", () => engine.reset(), {
			disabled: snapshot.status === "idle",
		});
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
		const total = root.createDiv({ cls: "brita-steps-total" });
		total.createSpan({ text: "Duração total" });
		total.createSpan({
			cls: "brita-step-duration",
			text: formatDuration(totalDurationSec(snapshot.routine)),
		});
	}
}
