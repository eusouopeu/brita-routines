import { SessionRecord } from "./engine";

/** Cabeçalho usado quando o arquivo de histórico é criado do zero. */
export const HISTORY_FILE_HEADER = "# Histórico de Rotinas\n\n";

/**
 * Formata uma sessão como item de lista com inline fields do Dataview
 * (passos como sub-itens). Listas são indexadas pelo Dataview
 * (file.lists, com children), o que permite agrupar por dia e montar
 * dashboards de calendário — tabelas e callouts não são.
 */
export function formatSessionEntry(record: SessionRecord): string {
	const outcome = record.outcome === "completed" ? "concluída" : "abandonada";
	const lines = [
		`- [rotina:: ${record.routineName}]` +
			` [inicio:: ${formatLocalIso(record.startedAt)}]` +
			` [fim:: ${formatLocalIso(record.endedAt)}]` +
			` [ativo:: ${formatDurationLong(record.activeSec)}]` +
			` [resultado:: ${outcome}]`,
	];
	for (const step of record.steps) {
		lines.push(
			`    - [passo:: ${step.name}]` +
				` [planejado:: ${formatDurationLong(step.plannedSec)}]` +
				` [real:: ${formatDurationLong(step.actualSec)}]` +
				` [pulado:: ${step.skipped ? "sim" : "não"}]`,
		);
	}
	return lines.join("\n") + "\n";
}

/** Sempre HH:MM:SS, para consistência de log (difere do formatDuration da UI). */
export function formatDurationLong(totalSec: number): string {
	const sec = Math.max(0, Math.round(totalSec));
	const h = String(Math.floor(sec / 3600)).padStart(2, "0");
	const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
	const s = String(sec % 60).padStart(2, "0");
	return `${h}:${m}:${s}`;
}

/** ISO local (sem timezone/Z), parseável direto pelo Dataview como data-hora. */
export function formatLocalIso(epochMs: number): string {
	const d = new Date(epochMs);
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}
