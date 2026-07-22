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
	/** Ao concluir uma rotina, escreve um callout de resumo na nota diária. */
	dailyLogEnabled: boolean;
	/** Título da seção da nota diária onde os callouts são inseridos. */
	dailyLogHeading: string;
	/**
	 * Propriedade multiselect do frontmatter da nota diária que recebe o nome
	 * de cada rotina concluída. Vazio = não escrever no frontmatter.
	 */
	dailyProperty: string;
	/** Cria a nota diária de hoje se ela ainda não existir, ao gravar. */
	createDailyNoteIfMissing: boolean;
}

export const DEFAULT_SETTINGS: BritaSettings = {
	routinesFolder: "Rotinas",
	activeRoutinePath: null,
	historyEnabled: true,
	historyFilePath: "Histórico de Rotinas.md",
	dailyLogEnabled: true,
	dailyLogHeading: "Rotinas",
	dailyProperty: "rotinas",
	createDailyNoteIfMissing: false,
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

		new Setting(containerEl).setName("Nota diária").setHeading();

		new Setting(containerEl)
			.setName("Resumo na nota diária")
			.setDesc(
				"Ao concluir uma rotina, insere um callout de resumo (legível, sem Dataview) na nota diária de hoje.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.dailyLogEnabled)
					.onChange(async (value) => {
						this.plugin.settings.dailyLogEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Seção do resumo")
			.setDesc(
				"Título (##) da seção da nota diária onde os callouts são inseridos. Criada se não existir.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.dailyLogHeading)
					.setValue(this.plugin.settings.dailyLogHeading)
					.onChange(async (value) => {
						this.plugin.settings.dailyLogHeading =
							value.trim() || DEFAULT_SETTINGS.dailyLogHeading;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Propriedade de rotinas concluídas")
			.setDesc(
				"Nome da propriedade multiselect do cabeçalho da nota diária que recebe cada rotina concluída. Deixe vazio para não escrever no frontmatter.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.dailyProperty)
					.setValue(this.plugin.settings.dailyProperty)
					.onChange(async (value) => {
						this.plugin.settings.dailyProperty = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Criar nota diária se faltar")
			.setDesc(
				"Cria a nota diária de hoje (com o template configurado) caso ela não exista ao concluir uma rotina.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.createDailyNoteIfMissing)
					.onChange(async (value) => {
						this.plugin.settings.createDailyNoteIfMissing = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
