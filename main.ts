import { Plugin } from "obsidian";

export default class BritaRoutinesPlugin extends Plugin {
	async onload() {
		console.log("Brita Routines: loaded");
	}

	onunload() {
		console.log("Brita Routines: unloaded");
	}
}
