let audioContext: AudioContext | null = null;

/**
 * Beep simples via Web Audio — sem arquivos de áudio. `times` toca
 * beeps encadeados (1 para fim de passo, 3 para fim de rotina).
 */
export function beep(times = 1): void {
	try {
		audioContext = audioContext ?? new AudioContext();
		const ctx = audioContext;
		// O beep é disparado por timer, não por gesto do usuário — em
		// algumas configurações o contexto nasce/fica suspenso.
		if (ctx.state === "suspended") void ctx.resume();
		for (let i = 0; i < times; i++) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = 880;
			osc.connect(gain);
			gain.connect(ctx.destination);
			const t = ctx.currentTime + i * 0.28;
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
			osc.start(t);
			osc.stop(t + 0.25);
		}
	} catch {
		// Áudio indisponível — o Notice ainda avisa.
	}
}

/** Libera o AudioContext. Chamado no onunload() do plugin. */
export function closeAudio(): void {
	if (audioContext) {
		void audioContext.close().catch(() => {});
		audioContext = null;
	}
}
