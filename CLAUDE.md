# Brita Routines — plugin do Obsidian

Replica a funcionalidade de rotinas do app Brita: rotinas com passos ordenados,
cada passo com temporizador, e execução guiada (countdown por passo, auto-avanço,
pausa, som/Notice ao concluir). Suporta múltiplas rotinas (pasta configurável
do vault, seletor no painel) e histórico de execuções (log markdown
Dataview-friendly com duração real por passo).

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
  Obsidian: recebe callbacks (`onStepComplete`, `onRoutineComplete`,
  `onSessionEnd`) e expõe `subscribe()` + `getSnapshot()` para quem quiser
  renderizar. Rastreia a sessão para o histórico: `StepRecord` (duração real
  por passo, **pausas excluídas**; catch-up pós-suspensão registra real =
  planejado) e `SessionRecord` (início/fim em epoch ms, `activeSec`,
  `outcome: completed | abandoned`).
- **Histórico** (`src/history.ts`) — formatação pura (sem Obsidian) de
  `SessionRecord` em markdown com inline fields do Dataview. Quem escreve no
  vault é o plugin (`appendSessionToHistory` em `main.ts`, via
  `vault.process`/`vault.create`).
- **Settings** (`src/settings.ts`) — `BritaSettings` + `DEFAULT_SETTINGS` +
  `BritaSettingTab` (pasta de rotinas, arquivo de histórico, toggle de
  registro). Persistência via `loadData`/`saveData` do plugin.
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
rotina **silenciosamente** (sem `onRoutineComplete`), mas a sessão conta como
`completed` no histórico (o passo fica `skipped`). O `AudioContext` é
retomado se estiver suspenso e fechado em `onunload()` (`closeAudio()`).

## Rotinas: descoberta e seleção

Toda nota `.md` **direta** da pasta de rotinas (`settings.routinesFolder`,
default `Rotinas`; o arquivo de histórico é excluído) é uma rotina; o nome é
o basename. O dropdown no header da view lista `listRoutineFiles()` e troca
via `setActiveRoutine()` (persiste em `settings.activeRoutinePath`; trocar
reseta o timer, com `confirm()` se running/paused). Resolução em cascata em
`loadRoutine()`: selecionada → primeira válida da pasta → `Rotina.md` legado
na raiz (`LEGACY_ROUTINE_PATH`, compat com a versão de arquivo único) →
`SAMPLE_ROUTINE`. A cascata só persiste auto-seleção quando
`activeRoutinePath` é `null` — nunca sobrescreve escolha explícita (a nota
pode estar só temporariamente inválida no meio de uma edição).

Eventos do vault em `main.ts`: `modify` da rotina carregada/selecionada
recarrega **só com timer `idle`**; `create`/`delete`/`rename` na pasta
notificam a view (`onRoutineListChanged`, canal mínimo de listeners no
plugin) para reconstruir o dropdown; `rename` da ativa atualiza o path
persistido; `delete` da ativa limpa a seleção.

## Formato do arquivo de rotina

Cada passo é uma linha de checklist:

```markdown
- [ ] Nome do passo - HH:MM:SS
```

Regras do parser (`STEP_LINE` em `src/routine.ts`):

- Só linhas `- [x] Nome - HH:MM:SS` contam (qualquer caractere dentro dos
  colchetes); todo o resto do arquivo é ignorado.
- O separador é o **último** ` - ` antes da duração; o nome pode conter hífens.
- Duração `00:00:00`, inválida, ou com minutos/segundos ≥ 60 ⇒ linha ignorada.
- Sem passos válidos ⇒ a cascata de `loadRoutine()` segue para o próximo
  candidato (e por fim `SAMPLE_ROUTINE`).

O botão de recarregar no cabeçalho da view relê o arquivo (e reseta o timer,
porque `setRoutine()` reseta). Com rotina em andamento (running/paused), pede
confirmação (`confirm()`) antes — mesmo padrão do dropdown de troca.

Comandos: `open-timer-panel` (abre o painel) e `toggle-timer`
(iniciar/pausar pela paleta, sem precisar do painel).

## Histórico de execuções

Gravado em `settings.historyFilePath` (default `Histórico de Rotinas.md`),
se `settings.historyEnabled`. Uma entrada por sessão: item de lista com
inline fields do Dataview, passos como sub-itens — o Dataview indexa listas
(`file.lists` com `children`), viabilizando dashboards/calendário:

```markdown
- [rotina:: Rotina da Manhã] [inicio:: 2026-07-18T07:30:12] [fim:: 2026-07-18T07:53:40] [ativo:: 00:22:28] [resultado:: concluída]
    - [passo:: Alongar] [planejado:: 00:05:00] [real:: 00:05:07] [pulado:: não]
```

Regras (implementadas no engine, formatadas em `src/history.ts`):

- `ativo`/`real` **excluem pausas**; tempo pausado = `fim - inicio - ativo`.
- Datas em ISO **local** sem timezone (`formatLocalIso`); durações sempre
  `HH:MM:SS` (`formatDurationLong` — difere do `formatDuration` da UI).
- `resultado`: `concluída` (fim natural ou skip do último passo) ou
  `abandonada` (reset/troca de rotina com ≥1 passo encerrado). Reset antes de
  qualquer passo terminar não registra nada (ruído). Recarregar o Obsidian no
  meio também não registra (estado do timer não é persistido).
- Passos dormidos (catch-up pós-suspensão) registram `real == planejado`.
- O auto-reload não reage ao log: o handler de `modify` só olha a rotina
  ativa, e `listRoutineFiles()` exclui o arquivo de histórico.

## Convenções

- Classes em PascalCase (`TimerEngine`), métodos/variáveis em camelCase,
  constantes module-level em SCREAMING_SNAKE (`LEGACY_ROUTINE_PATH`).
- Arquivos de `src/` em minúsculas, um conceito por arquivo.
- Classes CSS com prefixo `brita-`; estados como `is-current`/`is-done`.
  Cores e espaçamentos sempre via variáveis CSS do Obsidian (`--text-accent`,
  `--size-4-*`), nunca hardcoded.
- Tipo da view: `brita-routine-timer` (`VIEW_TYPE_ROUTINE_TIMER`).
- Strings de UI em português; código e identificadores em inglês.
- Durações: segundos inteiros no modelo (`durationSec`); milissegundos só
  dentro do engine.

## Fora de escopo por enquanto (decidido, não esquecido)

- **Persistir o estado do timer** entre recargas do Obsidian (sessão em
  andamento se perde, sem entrada no histórico).
- **Templates** de rotina.
- **Settings de som** (on/off, volume) e auto-início opcional do próximo
  passo.
- Editar a rotina pela view (hoje é só leitura do markdown).
- Dashboards embutidos no plugin (o histórico markdown é a base; a
  visualização fica com Dataview/plugins de calendário do usuário).
- Rotação/arquivamento do log (cresce indefinidamente; caminho configurável,
  arquivar é manual).
- `confirm()` nativo nas confirmações (migrar para `Modal` do Obsidian, um
  dia).
