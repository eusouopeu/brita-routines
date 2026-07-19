import { App, PluginSettingTab, Setting } from "obsidian";
import type BritaRoutinesPlugin from "../main";

export interface BritaSettings {
	/** Pasta do vault cujas notas .md são as rotinas disponíveis. */
	routinesFolder: string;
	/** Path da rotina selecionada; null = escolher automaticamente. */
	activeRoutinePath: string | null;
	/** Grava cada sessão concluída/abandonada no arquivo de histórico. */
	historyEnabled: boolean;
	/** Arquivo markdown onde as sessões são registradas. */
	historyFilePath: string;
}

export const DEFAULT_SETTINGS: BritaSettings = {
	routinesFolder: "Rotinas",
	activeRoutinePath: null,
	historyEnabled: true,
	historyFilePath: "Histórico de Rotinas.md",
};

/** Remove barras nas pontas para comparar/combinar paths do vault. */
export function normalizeFolder(path: string): string {
	return path.replace(/^\/+|\/+$/g, "").trim();
}

export class BritaSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: BritaRoutinesPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Pasta de rotinas")
			.setDesc(
				"Toda nota .md nessa pasta vira uma rotina disponível no painel.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.routinesFolder)
					.setValue(this.plugin.settings.routinesFolder)
					.onChange(async (value) => {
						this.plugin.settings.routinesFolder =
							normalizeFolder(value) || DEFAULT_SETTINGS.routinesFolder;
						await this.plugin.saveSettings();
						this.plugin.notifyRoutineListChanged();
					}),
			);

		new Setting(containerEl)
			.setName("Registrar histórico")
			.setDesc(
				"Grava início, fim e duração real de cada sessão e passo no arquivo de histórico.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.historyEnabled)
					.onChange(async (value) => {
						this.plugin.settings.historyEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Arquivo de histórico")
			.setDesc(
				"Path da nota de log. Evite colocá-la dentro da pasta de rotinas.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.historyFilePath)
					.setValue(this.plugin.settings.historyFilePath)
					.onChange(async (value) => {
						this.plugin.settings.historyFilePath =
							value.trim() || DEFAULT_SETTINGS.historyFilePath;
						await this.plugin.saveSettings();
						this.plugin.notifyRoutineListChanged();
					}),
			);
	}
}
