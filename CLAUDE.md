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
  Renderizador puro: não guarda estado próprio; se inscreve no engine ao abrir
  e redesenha o snapshot inteiro a cada mudança.

**Onde vive o estado do timer**: no plugin (`main.ts`), que cria o
`TimerEngine` único em `onload()` e registra o tick (`setInterval` de 250 ms
via `registerInterval`). Fechar/reabrir o painel não pausa nem reseta nada —
a view só (des)inscreve o listener. O engine evita drift guardando o timestamp
absoluto de término do passo (`stepEndsAt`) quando rodando e `stepRemainingMs`
quando pausado; o tick recalcula a partir de `Date.now()`.

O som (`src/sound.ts`) é um beep via Web Audio (oscilador), sem assets:
1 beep ao concluir um passo, 3 ao concluir a rotina. `skip()` avança sem som.

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
- Duração `00:00:00` ou inválida ⇒ linha ignorada.
- Arquivo ausente ou sem passos válidos ⇒ usa `SAMPLE_ROUTINE`.

O botão de recarregar no cabeçalho da view relê o arquivo (e reseta o timer,
porque `setRoutine()` reseta).

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
