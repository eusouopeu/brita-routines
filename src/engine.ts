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

export interface EngineCallbacks {
	/** isLast: true quando o passo concluído é o último (onRoutineComplete vem em seguida). */
	onStepComplete: (step: RoutineStep, index: number, isLast: boolean) => void;
	onRoutineComplete: (routine: Routine) => void;
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
		this.stepEndsAt = Date.now() + this.stepRemainingMs;
		this.status = "running";
		this.emit();
	}

	pause(): void {
		if (this.status !== "running") return;
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
			this.advance(true);
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

	/** Avança um passo. Quem chama é responsável por reancorar stepEndsAt. */
	private advance(completed: boolean): void {
		const step = this.routine.steps[this.stepIndex];
		const isLast = this.stepIndex + 1 >= this.routine.steps.length;
		if (completed && step) {
			this.callbacks.onStepComplete(step, this.stepIndex, isLast);
		}
		if (isLast) {
			this.status = "finished";
			this.stepRemainingMs = 0;
			if (completed) this.callbacks.onRoutineComplete(this.routine);
			return;
		}
		this.resetToStep(this.stepIndex + 1);
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
