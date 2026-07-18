# Brita Routines — plugin do Obsidian

Replica a funcionalidade de rotinas do app Brita: rotinas com passos ordenados,
cada passo com temporizador, e execução guiada (countdown por passo, auto-avanço,
pausa, som/Notice ao concluir). Este repositório está na fase de protótipo:
scaffold + painel de timer funcional.

## Build

- `npm run dev` — esbuild em watch mode (sourcemap inline).
- `npm run build` — `tsc -noEmit` (typecheck) + bundle de produção em `main.js`.
- `main.js` é gerado e está no `.gitignore`; nunca editar à mão.

## Arquitetura

Três camadas, com dependências só de cima para baixo:

- **Modelo** (`src/routine.ts`) — tipos puros `Routine`/`RoutineStep`, o parser
  do markdown, `SAMPLE_ROUTINE` (fallback embutido) e helpers de formatação.
  Sem dependência do Obsidian.
- **Engine** (`src/engine.ts`) — `TimerEngine`, a máquina de estados do
  countdown (`idle | running | paused | finished`). Também sem dependência do
  Obsidian: recebe callbacks (`onStepComplete`, `onRoutineComplete`) e expõe
  `subscribe()` + `getSnapshot()` para quem quiser renderizar.
- **View** (`src/view.ts`) — `RoutineTimerView` (ItemView na sidebar direita).
  Não guarda estado de timer; se inscreve no engine ao abrir. Só reconstrói o
  DOM quando **status ou rotina** mudam; nos demais ticks atualiza no lugar os
  textos do countdown e as classes `is-done`/`is-current` da lista (refs
  guardadas em `build()`). Isso preserva foco de teclado, cliques e a região
  `aria-live` do nome do passo (que anuncia trocas em leitores de tela).

**Onde vive o estado do timer**: no plugin (`main.ts`), que cria o
`TimerEngine` único em `onload()` e registra o tick (`setInterval` de 250 ms
via `registerInterval`). Fechar/reabrir o painel não pausa nem reseta nada —
a view só (des)inscreve o listener. O engine evita drift guardando o timestamp
absoluto de término do passo (`stepEndsAt`) quando rodando e `stepRemainingMs`
quando pausado; o tick recalcula a partir de `Date.now()`.

Detalhes do tick (`TimerEngine.tick()`):

- Só emite quando o **segundo exibido** muda (`lastEmittedSec`) ou um passo
  avança — não a cada intervalo de 250 ms.
- Tick atrasado (suspensão do sistema, aba congelada): um laço avança quantos
  passos couberem no tempo decorrido, ancorando o término de cada passo no
  término do anterior — o tempo dormido é contabilizado, não descartado.

O som (`src/sound.ts`) é um beep via Web Audio (oscilador), sem assets:
1 beep ao concluir um passo, 3 ao concluir a rotina. No último passo só toca
o som de rotina (`onStepComplete` recebe `isLast` e o plugin suprime o beep e
o Notice do passo). `skip()` avança sem som; pular o último passo encerra a
rotina **silenciosamente** (sem `onRoutineComplete`). O `AudioContext` é
retomado se estiver suspenso e fechado em `onunload()` (`closeAudio()`).

## Formato do arquivo de rotina

Lido de **`Rotina.md` na raiz do vault** (constante `ROUTINE_FILE_PATH` em
`main.ts`). O nome da rotina é o basename do arquivo. Cada passo é uma linha
de checklist:

```markdown
- [ ] Nome do passo - HH:MM:SS
```

Regras do parser (`STEP_LINE` em `src/routine.ts`):

- Só linhas `- [x] Nome - HH:MM:SS` contam (qualquer caractere dentro dos
  colchetes); todo o resto do arquivo é ignorado.
- O separador é o **último** ` - ` antes da duração; o nome pode conter hífens.
- Duração `00:00:00`, inválida, ou com minutos/segundos ≥ 60 ⇒ linha ignorada.
- Arquivo ausente ou sem passos válidos ⇒ usa `SAMPLE_ROUTINE`.

Recarga da rotina:

- O botão de recarregar no cabeçalho da view relê o arquivo (e reseta o
  timer, porque `setRoutine()` reseta). Com rotina em andamento
  (running/paused), pede confirmação (`confirm()`) antes.
- Editar `Rotina.md` recarrega automaticamente (`vault.on("modify")` em
  `main.ts`), mas **só com o timer em `idle`** — nunca reseta uma execução
  em andamento.

Comandos: `open-timer-panel` (abre o painel) e `toggle-timer`
(iniciar/pausar pela paleta, sem precisar do painel).

## Convenções

- Classes em PascalCase (`TimerEngine`), métodos/variáveis em camelCase,
  constantes module-level em SCREAMING_SNAKE (`ROUTINE_FILE_PATH`).
- Arquivos de `src/` em minúsculas, um conceito por arquivo.
- Classes CSS com prefixo `brita-`; estados como `is-current`/`is-done`.
  Cores e espaçamentos sempre via variáveis CSS do Obsidian (`--text-accent`,
  `--size-4-*`), nunca hardcoded.
- Tipo da view: `brita-routine-timer` (`VIEW_TYPE_ROUTINE_TIMER`).
- Strings de UI em português; código e identificadores em inglês.
- Durações: segundos inteiros no modelo (`durationSec`); milissegundos só
  dentro do engine.

## Fora de escopo por enquanto (decidido, não esquecido)

- **Logging/histórico** de execuções (o Brita registra sessões; aqui nada é
  persistido — nem o estado do timer sobrevive a recarregar o Obsidian).
- **Templates** de rotina e múltiplas rotinas (hoje é um único `Rotina.md`
  fixo; escolher rotina/arquivo virá com settings).
- **Settings tab** (caminho do arquivo, som on/off, volume, auto-início do
  próximo passo opcional).
- Editar a rotina pela view (hoje é só leitura do markdown).
