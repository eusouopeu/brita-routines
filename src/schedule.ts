import { Routine, RoutineStep } from "./routine";

export type ScheduledKind = "event" | "inline-routine" | "routine-ref";

/** Um compromisso do plano do dia, lido da nota diária. */
export interface ScheduledEntry {
	/** Minutos desde a meia-noite (0–1439). */
	startMinutes: number;
	/** Minutos desde a meia-noite, ou null quando não há hora de fim. */
	endMinutes: number | null;
	/** Texto exibido (nome do evento ou da rotina). */
	title: string;
	kind: ScheduledKind;
	/** Nome da rotina referenciada (só em kind "routine-ref"). */
	routineName?: string;
	/** Passos da rotina inline (só em kind "inline-routine"); vazio nos demais. */
	steps: RoutineStep[];
	/** Índice 0-based da linha de origem na nota (para navegação futura). */
	line: number;
}

/** Compromisso: "- HH:MM - resto" (checkbox opcional). O resto define o tipo. */
const ENTRY_LINE = /^(\s*)-\s*(?:\[.\]\s*)?(\d{1,2}):(\d{2})\s*-\s*(.+?)\s*$/;

/** Resto que começa por hora de fim: "HH:MM Título" ⇒ evento com janela. */
const END_TIME = /^(\d{1,2}):(\d{2})\s+(.+?)\s*$/;

/** Passo-filho: "- Nome - MM:SS" ou "- Nome - HH:MM:SS" (checkbox opcional). */
const STEP_LINE =
	/^(\s*)-\s*(?:\[.\]\s*)?(.+?)\s*-\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/;

/** Largura de indentação comparável (tab conta como avanço maior). */
function indentWidth(indent: string): number {
	let width = 0;
	for (const ch of indent) width += ch === "\t" ? 4 : 1;
	return width;
}

/** Minutos desde a meia-noite, ou null se hora/minuto forem inválidos. */
function toMinutes(h: number, m: number): number | null {
	if (h > 23 || m > 59) return null;
	return h * 60 + m;
}

function parseStep(m: RegExpExecArray): RoutineStep | null {
	const name = m[2];
	const hasHours = m[5] !== undefined;
	const hours = hasHours ? Number(m[3]) : 0;
	const minutes = hasHours ? Number(m[4]) : Number(m[3]);
	const seconds = hasHours ? Number(m[5]) : Number(m[4]);
	if (minutes >= 60 || seconds >= 60) return null;
	const durationSec = hours * 3600 + minutes * 60 + seconds;
	if (durationSec <= 0) return null;
	return { name, durationSec };
}

function classifyEntry(
	start: number,
	rest: string,
	line: number,
): ScheduledEntry {
	const endMatch = END_TIME.exec(rest);
	if (endMatch) {
		const end = toMinutes(Number(endMatch[1]), Number(endMatch[2]));
		if (end !== null) {
			return {
				startMinutes: start,
				endMinutes: end,
				title: endMatch[3].trim(),
				kind: "event",
				steps: [],
				line,
			};
		}
	}
	if (rest.startsWith("@")) {
		const name = rest.slice(1).trim();
		return {
			startMinutes: start,
			endMinutes: null,
			title: name,
			kind: "routine-ref",
			routineName: name,
			steps: [],
			line,
		};
	}
	// Sem hora de fim e sem "@": evento simples, que vira rotina inline se
	// tiver passos-filho.
	return {
		startMinutes: start,
		endMinutes: null,
		title: rest,
		kind: "event",
		steps: [],
		line,
	};
}

/**
 * Parseia o plano do dia escrito na nota diária. Cada compromisso é um item
 * de lista "- HH:MM - ...". Três formas:
 *   - "- HH:MM - HH:MM Evento"    → evento com janela (kind "event")
 *   - "- HH:MM - @Rotina"         → referência a uma rotina (kind "routine-ref")
 *   - "- HH:MM - Evento" + filhos → rotina inline (kind "inline-routine")
 * Passos-filho ("- Nome - MM:SS", mais indentados que o compromisso) definem
 * a rotina inline. Linhas fora desse formato são ignoradas. O resultado sai
 * ordenado por hora de início.
 */
export function parseSchedule(markdown: string): ScheduledEntry[] {
	const entries: ScheduledEntry[] = [];
	let current: { entry: ScheduledEntry; indent: number } | null = null;

	markdown.split(/\r?\n/).forEach((line, index) => {
		const entryMatch = ENTRY_LINE.exec(line);
		if (entryMatch) {
			const start = toMinutes(Number(entryMatch[2]), Number(entryMatch[3]));
			if (start === null) {
				current = null;
				return;
			}
			const entry = classifyEntry(start, entryMatch[4].trim(), index);
			entries.push(entry);
			current = { entry, indent: indentWidth(entryMatch[1]) };
			return;
		}

		const stepMatch = STEP_LINE.exec(line);
		if (stepMatch && current && indentWidth(stepMatch[1]) > current.indent) {
			const step = parseStep(stepMatch);
			if (step) {
				current.entry.steps.push(step);
				// Evento simples com passos-filho é, na verdade, rotina inline.
				if (
					current.entry.kind === "event" &&
					current.entry.endMinutes === null
				) {
					current.entry.kind = "inline-routine";
				}
			}
			return;
		}

		// Outro item de lista ou título encerra a coleta de passos-filho.
		if (/^\s*-\s/.test(line) || /^#/.test(line)) current = null;
	});

	return entries.sort((a, b) => a.startMinutes - b.startMinutes);
}

/** Constrói a Routine de um compromisso inline (null se não for inline válido). */
export function entryToRoutine(entry: ScheduledEntry): Routine | null {
	if (entry.kind !== "inline-routine" || entry.steps.length === 0) return null;
	return { name: entry.title, steps: entry.steps };
}

/** HH:MM a partir de minutos desde a meia-noite. */
export function formatMinutes(min: number): string {
	const clamped = ((Math.round(min) % 1440) + 1440) % 1440;
	const h = Math.floor(clamped / 60);
	const m = clamped % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
