import { Routine, RoutineStep, SAMPLE_ROUTINE } from "./routine";

export type EngineStatus = "idle" | "running" | "paused" | "finished";

export interface EngineSnapshot {
	status: EngineStatus;
	routine: Routine;
	stepIndex: number;
	currentStep: RoutineStep | null;
	stepRemainingSec: number;
	totalRemainingSec: number;
}

/** Um passo encerrado dentro de uma sessão (concluído ou pulado). */
export interface StepRecord {
	name: string;
	plannedSec: number;
	/** Tempo ativo no passo, excluindo pausas. */
	actualSec: number;
	skipped: boolean;
}

export type SessionOutcome = "completed" | "abandoned";

/** Uma execução de rotina, do start() ao fim (ou abandono via reset). */
export interface SessionRecord {
	routineName: string;
	/** Epoch ms. */
	startedAt: number;
	/** Epoch ms. Tempo pausado = endedAt - startedAt - activeSec*1000. */
	endedAt: number;
	/** Soma dos actualSec dos passos (pausas excluídas). */
	activeSec: number;
	outcome: SessionOutcome;
	/** Só passos que terminaram (concluídos ou pulados). */
	steps: StepRecord[];
}

export interface EngineCallbacks {
	/** isLast: true quando o passo concluído é o último (onRoutineComplete vem em seguida). */
	onStepComplete: (step: RoutineStep, index: number, isLast: boolean) => void;
	onRoutineComplete: (routine: Routine) => void;
	/**
	 * Fim de sessão: rotina concluída (mesmo com o último passo pulado) ou
	 * abandonada (reset/troca de rotina com ≥1 passo já encerrado). Reset
	 * antes de qualquer passo terminar não emite — é ruído, não sessão.
	 */
	onSessionEnd?: (record: SessionRecord) => void;
}

/**
 * Máquina de estados do countdown. Vive no plugin (não na view), então
 * fechar/reabrir o painel não afeta a execução. Quando rodando, guarda
 * o timestamp absoluto de término do passo (stepEndsAt) e recalcula o
 * restante a partir de Date.now() a cada tick — sem drift acumulado.
 */
export class TimerEngine {
	private routine: Routine = SAMPLE_ROUTINE;
	private status: EngineStatus = "idle";
	private stepIndex = 0;
	private stepRemainingMs = 0;
	private stepEndsAt = 0;
	private lastEmittedSec = -1;
	private listeners = new Set<() => void>();

	// Rastreio de sessão para o histórico. stepActiveMs acumula o tempo
	// ativo do passo atual entre pausas; segmentStartedAt marca o início
	// do trecho running corrente.
	private sessionActive = false;
	private sessionStartedAt = 0;
	private stepActiveMs = 0;
	private segmentStartedAt = 0;
	private stepRecords: StepRecord[] = [];

	constructor(private callbacks: EngineCallbacks) {
		this.resetToStep(0);
	}

	setRoutine(routine: Routine): void {
		this.routine = routine;
		this.reset();
	}

	getSnapshot(): EngineSnapshot {
		const stepRemainingSec = Math.ceil(this.currentRemainingMs() / 1000);
		const futureSec = this.routine.steps
			.slice(this.stepIndex + 1)
			.reduce((sum, s) => sum + s.durationSec, 0);
		return {
			status: this.status,
			routine: this.routine,
			stepIndex: this.stepIndex,
			currentStep:
				this.status === "finished"
					? null
					: this.routine.steps[this.stepIndex] ?? null,
			stepRemainingSec,
			totalRemainingSec:
				this.status === "finished" ? 0 : stepRemainingSec + futureSec,
		};
	}

	start(): void {
		if (this.status === "running") return;
		if (this.status === "finished") this.resetToStep(0);
		// Abre sessão só vindo de idle/finished — resume() também passa
		// por aqui e não deve reabrir a sessão em andamento.
		if (this.status !== "paused") {
			this.sessionActive = true;
			this.sessionStartedAt = Date.now();
			this.stepRecords = [];
			this.stepActiveMs = 0;
		}
		this.segmentStartedAt = Date.now();
		this.stepEndsAt = Date.now() + this.stepRemainingMs;
		this.status = "running";
		this.emit();
	}

	pause(): void {
		if (this.status !== "running") return;
		this.stepActiveMs += Date.now() - this.segmentStartedAt;
		this.stepRemainingMs = Math.max(0, this.stepEndsAt - Date.now());
		this.status = "paused";
		this.emit();
	}

	resume(): void {
		if (this.status !== "paused") return;
		this.start();
	}

	/**
	 * Pula o passo atual sem marcá-lo como concluído (sem som). Pular o
	 * último passo encerra a rotina silenciosamente (sem onRoutineComplete).
	 */
	skip(): void {
		if (this.status === "idle" || this.status === "finished") return;
		this.advance(false);
		if (this.status === "running") {
			this.stepEndsAt = Date.now() + this.stepRemainingMs;
		}
		this.emit();
	}

	reset(): void {
		// Abandono: só vira sessão se ao menos um passo terminou; resetar
		// segundos depois de iniciar é ruído, não histórico.
		if (this.sessionActive && this.stepRecords.length > 0) {
			this.endSession("abandoned", Date.now());
		}
		this.sessionActive = false;
		this.resetToStep(0);
		this.status = "idle";
		this.emit();
	}

	/**
	 * Chamado pelo intervalo registrado no plugin (~4x por segundo). Só
	 * emite quando o segundo exibido muda (a view redesenha a cada emissão).
	 * Se o tick chegar atrasado (suspensão do sistema, aba congelada), o
	 * laço avança quantos passos couberem no tempo decorrido, ancorando
	 * cada término no término do passo anterior — nada de tempo se perde.
	 */
	tick(): void {
		if (this.status !== "running") return;
		let advanced = false;
		while (this.status === "running" && Date.now() >= this.stepEndsAt) {
			const endedAt = this.stepEndsAt;
			this.advance(true, endedAt);
			if (this.status === "running") {
				this.stepEndsAt = endedAt + this.stepRemainingMs;
			}
			advanced = true;
		}
		const sec = Math.ceil(this.currentRemainingMs() / 1000);
		if (advanced || sec !== this.lastEmittedSec) this.emit();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Avança um passo. Quem chama é responsável por reancorar stepEndsAt.
	 * endedAtMs: instante de término efetivo — no catch-up pós-suspensão o
	 * tick passa o término teórico, e a duração real fica igual à planejada.
	 */
	private advance(completed: boolean, endedAtMs = Date.now()): void {
		const step = this.routine.steps[this.stepIndex];
		const isLast = this.stepIndex + 1 >= this.routine.steps.length;
		if (step && this.sessionActive) {
			const runningMs =
				this.status === "running" ? endedAtMs - this.segmentStartedAt : 0;
			this.stepRecords.push({
				name: step.name,
				plannedSec: step.durationSec,
				actualSec: Math.max(
					0,
					Math.round((this.stepActiveMs + runningMs) / 1000),
				),
				skipped: !completed,
			});
			this.stepActiveMs = 0;
			this.segmentStartedAt = endedAtMs;
		}
		if (completed && step) {
			this.callbacks.onStepComplete(step, this.stepIndex, isLast);
		}
		if (isLast) {
			this.status = "finished";
			this.stepRemainingMs = 0;
			if (completed) this.callbacks.onRoutineComplete(this.routine);
			// Pular o último passo também conclui a sessão: a rotina foi
			// percorrida até o fim (o passo fica marcado como pulado).
			if (this.sessionActive) this.endSession("completed", endedAtMs);
			this.sessionActive = false;
			return;
		}
		this.resetToStep(this.stepIndex + 1);
	}

	private endSession(outcome: SessionOutcome, endedAtMs: number): void {
		const steps = this.stepRecords;
		this.stepRecords = [];
		this.callbacks.onSessionEnd?.({
			routineName: this.routine.name,
			startedAt: this.sessionStartedAt,
			endedAt: endedAtMs,
			activeSec: steps.reduce((sum, s) => sum + s.actualSec, 0),
			outcome,
			steps,
		});
	}

	private resetToStep(index: number): void {
		this.stepIndex = index;
		const step = this.routine.steps[index];
		this.stepRemainingMs = (step ? step.durationSec : 0) * 1000;
	}

	private currentRemainingMs(): number {
		if (this.status === "running") {
			return Math.max(0, this.stepEndsAt - Date.now());
		}
		return this.stepRemainingMs;
	}

	private emit(): void {
		this.lastEmittedSec = Math.ceil(this.currentRemainingMs() / 1000);
		for (const listener of this.listeners) listener();
	}
}
