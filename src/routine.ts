export interface RoutineStep {
	name: string;
	durationSec: number;
}

export interface Routine {
	name: string;
	steps: RoutineStep[];
}

/** Uma linha de passo: "- [ ] Nome do passo - HH:MM:SS" */
const STEP_LINE = /^-\s*\[.\]\s*(.+?)\s*-\s*(\d{1,2}):(\d{2}):(\d{2})\s*$/;

export function parseRoutine(markdown: string, name: string): Routine | null {
	const steps: RoutineStep[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const m = line.match(STEP_LINE);
		if (!m) continue;
		const hours = Number(m[2]);
		const minutes = Number(m[3]);
		const seconds = Number(m[4]);
		if (minutes >= 60 || seconds >= 60) continue;
		const durationSec = hours * 3600 + minutes * 60 + seconds;
		if (durationSec <= 0) continue;
		steps.push({ name: m[1], durationSec });
	}
	if (steps.length === 0) return null;
	return { name, steps };
}

export const SAMPLE_ROUTINE: Routine = {
	name: "Rotina de exemplo",
	steps: [
		{ name: "Alongar", durationSec: 15 },
		{ name: "Beber água", durationSec: 10 },
		{ name: "Respirar fundo", durationSec: 20 },
	],
};

export function totalDurationSec(routine: Routine): number {
	return routine.steps.reduce((sum, s) => sum + s.durationSec, 0);
}

export function formatDuration(totalSec: number): string {
	const sec = Math.max(0, Math.round(totalSec));
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	const mm = String(m).padStart(2, "0");
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
