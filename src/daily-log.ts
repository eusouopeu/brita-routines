import { SessionRecord, StepRecord } from "./engine";
import { formatDuration } from "./routine";

/**
 * Formata uma sessão concluída como callout do Obsidian, legível a olho nu
 * (sem inline fields do Dataview). Colapsado por padrão ("[!success]-") para
 * não inflar a nota diária; o ícone verde do callout já sinaliza a conclusão.
 */
export function formatSessionCallout(record: SessionRecord): string {
	const start = formatClock(record.startedAt);
	const end = formatClock(record.endedAt);
	const active = formatHuman(record.activeSec);
	const lines = [
		`> [!success]- ${record.routineName} — ${start}→${end} · ${active} ativos`,
	];
	for (const step of record.steps) {
		lines.push(`> - ${formatStep(step)}`);
	}
	return lines.join("\n") + "\n";
}

function formatStep(step: StepRecord): string {
	if (step.skipped) return `~~${step.name}~~ — pulado`;
	return `${step.name} — ${formatDuration(step.actualSec)}`;
}

/**
 * Insere um bloco na seção "## heading" do conteúdo, ao final dela (antes do
 * próximo título de nível 1–2 ou do fim do arquivo). Cria a seção no fim se
 * ela não existir. Garante uma linha em branco antes do bloco — sem ela,
 * callouts consecutivos se fundiriam num só.
 */
export function insertIntoSection(
	content: string,
	block: string,
	heading: string,
): string {
	const headingLine = `## ${heading}`;
	const trimmedBlock = block.replace(/\n+$/, "");
	const lines = content.split(/\r?\n/);
	const headingIdx = lines.findIndex(
		(l) => l.trim().toLowerCase() === headingLine.toLowerCase(),
	);

	if (headingIdx === -1) {
		const base = content.replace(/\s*$/, "");
		const prefix = base.length > 0 ? `${base}\n\n` : "";
		return `${prefix}${headingLine}\n\n${trimmedBlock}\n`;
	}

	// Fim da seção: próximo título "# " ou "## ", ou o fim do arquivo.
	let end = lines.length;
	for (let i = headingIdx + 1; i < lines.length; i++) {
		if (/^#{1,2}\s/.test(lines[i])) {
			end = i;
			break;
		}
	}
	// Recua sobre as linhas em branco finais da seção para colar o bloco logo
	// após o último conteúdo real.
	let insertAt = end;
	while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === "") {
		insertAt--;
	}
	const before = lines.slice(0, insertAt);
	const after = lines.slice(insertAt);
	const needsBlank =
		before.length > 0 && before[before.length - 1].trim() !== "";
	const merged = [
		...before,
		...(needsBlank ? [""] : []),
		...trimmedBlock.split("\n"),
		...after,
	];
	return merged.join("\n");
}

function formatClock(epochMs: number): string {
	const d = new Date(epochMs);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Duração amigável para o título do callout: "1 h 05 min", "22 min", "45 s". */
function formatHuman(totalSec: number): string {
	const sec = Math.max(0, Math.round(totalSec));
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
	if (m > 0) return `${m} min`;
	return `${s} s`;
}
