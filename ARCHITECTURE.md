# Architecture

How `rule` is put together: what happens when you type, the rules the code keeps, every file and
what it holds, and where to make a given change. `test/architecture.test.ts` fails when a file is
added, moved or deleted without this page following, so the map below is always complete.

## A turn, end to end

```mermaid
flowchart TD
  key[keys] --> editor["useLineEditor<br/>components/live.tsx"]
  editor --> app["AgentApp<br/>agent/AgentApp.tsx"]
  app -- "first message" --> session["openSession<br/>agent/backend.ts"]
  session --> sdk["Claude Agent SDK, Cortex Agent SDK,<br/>or Codex's app-server (agent/codex.ts)"]
  sdk -- "messages" --> events["normalize (agent/events.ts),<br/>or codex.ts for Codex"]
  events -- "AgentEvent" --> app
  sdk -- "may I run this?" --> gate["permissionGate<br/>agent/backend.ts"]
  gate -- "reads: yes at once<br/>everything else" --> app
  sdk -- "ds tool call" --> server["ds tools, in process: an MCP server for the SDKs,<br/>dynamic tools for Codex"]
  server --> tools["ds-next's tools<br/>ds/tools.ts"]
  tools --> kb["canon, skills, scaffolds,<br/>reconcile, code<br/>ds/*.ts"]
  kb --> disk[("canon and skills-os<br/>on disk")]
  app -- "what happened" --> look["the look: Rule or Rail<br/>agent/looks.tsx"]
  look -- "rows of spans" --> screen["transcript, written once<br/>footing, redrawn<br/>components/*"]
  screen --> theme["roles to colours<br/>theme.ts"]
  theme --> ink[Ink, the terminal]
```

1. **You type.** `useLineEditor` keeps the line and the `/` menu. Enter hands the line to `AgentApp.run`.
2. **Local or agent.** `/status`, `/model`, `/last`, `/clear`, `/help`, `/exit` and `?` are answered
   locally. Anything else, unknown `/commands` included, goes to the agent.
3. **The session.** The first message opens a session (`openSession`). It picks the agent, serves it
   ds-next's 17 tools plus `rule_spec` in process, attaches the code graph and Serena when they're
   installed, and starts streaming. The Claude and Cortex SDKs take the tools as an MCP server; Codex
   runs as `codex app-server` and takes them as dynamic tools (`agent/codex.ts`). Later messages
   reuse the session; after a crash or a stall the next message resumes it.
4. **Events.** The two SDKs emit the same message shapes, which `normalize` reduces to a few
   `AgentEvent`s: init, thinking, text, tool, toolResult, result, error, note. `codex.ts` reduces
   Codex's thread items and turn notifications to the same events.
5. **Asking.** Before a tool runs, the SDK calls `permissionGate`; Codex sends an approval request,
   or calls the ds tool, and `codex.ts` puts it through the same gate. Reads in the allowlist pass at
   once; anything else goes to `AgentApp.askPerson`, one question at a time, and the look draws it.
6. **Drawing.** For each event `AgentApp` asks the look for rows (`text`, `toolStart`, `toolEnd`,
   `ending`...) and prints them to the transcript. Only the running tools, the spinner and the box
   redraw.
7. **Colour.** Rows carry roles (`accent`, `muted`, `warn`...), not colours. `theme.ts` turns a role into
   a colour for the look, the theme (dark or light) and what the terminal supports.

## Rules the code keeps

- **A line is data.** A `Row` is a list of `Span`s, each with a colour role (`text.ts`). Builders return
  rows; components only render them. Tests measure every row without a terminal.
- **Colour is a role, never a hex value in a builder.** Palettes live in `tokens.ts` (Rule) and
  `rail/tokens.ts` (Rail); `theme.ts` resolves them at truecolor, ANSI-16 or no colour.
- **Nothing printed is reprinted.** The transcript goes through Ink's `<Static>` (`components/transcript.tsx`);
  only the footing redraws. This is [[terminal-design]]'s "append, don't reflow".
- **The look owns all drawing in `rule agent`.** `AgentApp` never builds a row itself; it calls the
  `AgentLook` (`agent/looks.tsx`). Session, queue, watchdog and commands are shared by both looks.
- **The grid.** Frames are exactly the width they're given; other rows fit inside it. Rule draws at the
  terminal's width (60 at least); Rail draws its transcript at 60 to 80 and its box and toolbar at the
  terminal's width, as ds-next does.
- **Keys read state from refs.** A key can reach a handler from an older render. The line editor, the
  dialog and the Rail approval keep what was typed in a ref every key updates at once.
- **Two files know the agent.** `agent/backend.ts` loads the Claude or Cortex SDK; `agent/codex.ts`
  drives Codex. The rest sees `AgentEvent`s and an `AgentSession`.
- **The ds tools are ds-next's.** `ds/` is a port of ds-next's Python with the same tool names,
  descriptions, arguments and outputs. `test/parity/run.sh` runs both through 229 steps on a real
  canon and compares everything. Reads never ask; writes always do.
- **Missing pieces never crash.** No canon: each tool says what to set up. No graph or Serena: not
  offered. No Cortex CLI: said at once, since its SDK would hang.

## Every file

### Entry point and the design-system core

| File | Holds |
|---|---|
| `src/cli.tsx` | The `rule` command: argument parsing, `--look`, `--theme`, `--color`, and the commands `tour`, `chapters`, `screen`, `spec`, `html`, `demo`, `agent` |
| `src/text.ts` | The row model: `Span`, `Row`, `s`, `bold`, `row`, width, truncate, fit, split and word wrap that keep each span's style |
| `src/tokens.ts` | Rule's tokens: palette (dark, light, ANSI-16), glyphs, spinner, verbs, grid, the canoe; the `Role` and `LookName` types |
| `src/theme.ts` | `Theme` (look, dark or light, colour depth, ground painting), `colour`, `resolve`, `ThemeContext` |
| `src/builders.ts` | Rule's message types as row builders: turn rule, you, agent, tool, result, thinking, outcome, facts, frame, dialog, input box, status row, popup, banner |

### Rule's walkthrough

| File | Holds |
|---|---|
| `src/spec.ts` | Rule's spec as data: principles, colour roles, glyphs, grid, motion, mascot, code map, screens, known gaps |
| `src/screens.ts` | Rule's seven screens and the spec page's mockups, built from `builders.ts` |
| `src/tour/chapters.tsx` | The 19 chapters of `rule tour` |
| `src/tour/Tour.tsx` | The pager (enter for the next chapter, q quits) and `ChapterView` |
| `src/tour/doc.tsx` | Prose pieces: headers, paragraphs, label/value pairs, tables, mockups in dark and light |
| `src/tour/rail.tsx` | `RailScreen`: one Rail screen with its note, for `rule screen --look rail` |
| `src/html.ts` | `rule html`: the tour as one page (`build`), or Rail's screens (`buildRail`) |
| `src/html-page.ts` | The two page templates: Rule's Modernist chrome and Rail's |

### Components

| File | Holds |
|---|---|
| `src/components/Lines.tsx` | `Line` and `Lines` (rows to Ink `<Text>`), and `Mock`, a mockup painted on its theme's ground |
| `src/components/rule.tsx` | Rule's static components, each a thin wrapper over a builder |
| `src/components/live.tsx` | What redraws: `Working` (spinner line), `useLineEditor`, `InputBox`, `Footing`, `DialogPicker` |
| `src/components/transcript.tsx` | `useTranscript` and `Transcript`: the write-once log on `<Static>` |
| `src/components/LiveTurn.tsx` | Rule demo's faked turn: thinking streams, tools run and land |

### Demos

| File | Holds |
|---|---|
| `src/demo/Demo.tsx` | `rule demo` in Rule: the faked session with the closed box, popup, live turn and dialog |
| `src/demo/scripted.ts` | The scripted agent behind `rule demo --look rail`, played through the real `AgentApp` |

### The agent terminal

| File | Holds |
|---|---|
| `src/agent/AgentApp.tsx` | `rule agent`: the session, local commands, the queue, interrupts, the stall watchdog, approvals one at a time |
| `src/agent/backend.ts` | Which agent (`chooseBackend`), loading its SDK, the permission gate, the in-process `ds` server, `rule_spec`, the system prompt, `openSession` |
| `src/agent/codex.ts` | Codex: `codex app-server` over JSON-RPC, ds-next's tools as dynamic tools, approvals through the gate, Codex's items as `AgentEvent`s |
| `src/agent/mcp.ts` | `rule mcp`: ds-next's tools and `rule_spec` as a stdio MCP server, for an agent run on its own |
| `src/agent/events.ts` | `AgentEvent` and `normalize`: SDK messages from either agent reduced to a few events |
| `src/agent/looks.tsx` | `AgentLook` and its two implementations, `RULE` and `RAIL`: everything that differs between the looks |
| `src/agent/markdown.ts` | Agent Markdown as lines (`markdownLines`), and Rule's framing of it (`agentRows`) |
| `src/agent/present.ts` | How Rule names a tool, its argument, its result as a fact, and its approval dialog |
| `src/agent/desk.ts` | What this machine has (canon, skills-os, docs-ds) for the banner, and where the repo stands for Rail's toolbar |

### Rail

| File | Holds |
|---|---|
| `src/rail/tokens.ts` | Rail's tokens, ds-next's `ui_style.py` values: palette, ANSI-16, glyphs, spinner, grid, the dog and the cat |
| `src/rail/builders.ts` | ds-next's line builders ported: run, result, outcome, footer, frame, approval, banner, prompt box, menu, toolbar |
| `src/rail/screens.ts` | Rail's ten screens, built from the same `RAIL` look `rule agent` uses |

### ds-next's tools, ported

| File | Holds |
|---|---|
| `src/ds/tools.ts` | The 17 agent tools (names, descriptions, arguments), `runTool`, ds-next's system prompt |
| `src/ds/kb.ts` | `Canon` (standards, scaffolds, blocks, code index from `index.json`) and `Skills`; where they're found |
| `src/ds/scaffold.ts` | New projects from a scaffold, adopting a repo, adding a block, the pre-push hook |
| `src/ds/reconcile.ts` | `check`: a repo's manifest against the canon (adopted, declined, pending, errors) |
| `src/ds/code.ts` | `code_search`, `code_get`, `code_add`, through the Python helper |
| `src/ds/codetools.ts` | The code graph and Serena as MCP servers, their read-only tools, refreshing the graph, `cortex search` |
| `src/ds/py.ts` | The bits of Python behaviour the port depends on: repr, json.dumps, path resolution, shlex, which |
| `python/code_cut.py` | ds-next's code-cutting functions, unchanged: a canon module cut down to the symbols asked for, with Python's own parser |

### Scripts

| File | Holds |
|---|---|
| `scripts/index.mjs` | `npm run index`: build or refresh the code graph for this repo |

### Tests

| File | Covers |
|---|---|
| `test/rows.test.ts` | Rule's grid: every row fits, every frame is exact, the box wraps closed, the spec is complete |
| `test/live.test.tsx` | Rule's demo and tour driven by keystrokes |
| `test/agent.test.tsx` | `rule agent` in Rule with a scripted agent, events, how tools read, the permission gate, both SDKs build every tool |
| `test/rail.test.tsx` | Rail's tokens against ds-next's `ui_style.py`, its grid, its screens and page, `rule agent` and its demo in Rail |
| `test/ds.test.ts` | The ds port on a small canon: render, write, reconcile, blocks, code, tools |
| `test/codetools.test.ts` | How the code graph and Serena are attached, with fake binaries |
| `test/codex.test.tsx` | Codex against a stand-in app-server, drawn in Rail, and end to end with the real app-server and a stand-in model; `rule mcp` |
| `test/fixtures/fake-codex.mjs` | A stand-in for `codex app-server`: one scripted turn with a ds tool call and a command approval |
| `test/fixtures/fake-model.ts` | A stand-in for the model API Codex calls, so the real app-server plays a turn with no account |
| `test/architecture.test.ts` | That this page names every file, and names no file that is gone |
| `test/helpers.ts` | Shared: waiting for a frame, waiting for the input hooks, a scripted agent session |
| `test/parity/run.sh` | The parity check with ds-next's Python (needs a ds-next checkout, the canon and skills-os) |
| `test/parity/gen_scenarios.py` | The 229 steps, generated from the canon |
| `test/parity/run_py.py` | Runs the steps through ds-next's Python |
| `test/parity/run_ts.mts` | Runs the steps through the port |
| `test/parity/compare.py` | Compares the two runs, every output and file |

## Where to change what

| To change | Go to |
|---|---|
| A Rail colour, glyph or the spinner | `src/rail/tokens.ts` (keep it equal to ds-next's `ui_style.py`; `test/rail.test.tsx` checks) |
| A Rule colour or glyph | `src/tokens.ts` |
| How a turn reads in one look | That look in `src/agent/looks.tsx` (Rail's rows come from `src/rail/builders.ts`) |
| A third look | A new `AgentLook` in `src/agent/looks.tsx`, its tokens in `src/theme.ts`'s `INKS`, its name in `LOOKS` in `src/tokens.ts` |
| A local command (`/something`) | `COMMANDS` and `run` in `src/agent/AgentApp.tsx` |
| A key | `useLineEditor` in `src/components/live.tsx` for editing; the `useInput` in `src/agent/AgentApp.tsx` for the rest |
| Which tools never ask | `READ_ONLY` and `readOnlyIds` in `src/agent/backend.ts`; a ds tool's `readOnly` in `src/ds/tools.ts`; graph and Serena reads in `src/ds/codetools.ts` |
| An agent tool | `src/ds/tools.ts` (port it from ds-next first; add it to `test/parity/` when it reads the canon) |
| What the agent is told | `systemPrompt` in `src/agent/backend.ts` and `src/ds/tools.ts` |
| A new agent (SDK) | `src/agent/backend.ts` (`Backend`, `chooseBackend`, `load`, `openSession`), then `normalize` in `src/agent/events.ts` if its messages differ; `src/agent/codex.ts` is the pattern for an agent with its own protocol |
| What Codex may do without asking | The thread's `approvalPolicy` and `sandbox` in `src/agent/codex.ts` |
| What `rule mcp` serves | `src/agent/mcp.ts`; its tools are the same list `rule agent` serves |
| The banner's facts | `banner` in each look in `src/agent/looks.tsx`; what the machine has in `src/agent/desk.ts` |
| A CLI command or flag | `src/cli.tsx` and its `HELP` text |
| Rule's tour | `src/tour/chapters.tsx`, its data in `src/spec.ts`, its screens in `src/screens.ts` |

## The code graph and Serena

Two optional tools give an agent working in this repo more than text search. `rule agent` attaches
both when they're on your PATH; for Codex, Claude Code and Cortex sessions opened in this folder, the
repo carries their config, along with `ds`: ds-next's tools from `rule mcp` (needs `rule` on your
PATH, from `npm link`).

| Tool | What it answers | Install |
|---|---|---|
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Callers and callees, symbols, file outlines, from its own index (served read-only, `--tool-profile=analysis`) | Download the release for your machine, check it against the release's `checksums.txt`, put the binary on your PATH (`~/.local/bin`). Its own installer reconfigures every agent on the machine; skip it. ds-next was tested with 0.11.0 |
| [Serena](https://github.com/oraios/serena) | Definitions, references, implementations, diagnostics, from the TypeScript language server | `uv tool install serena-agent==2.1.0` |

- **Codex** reads `.codex/config.toml`, once you trust the project (Codex asks the first time you open
  it). Start Codex in this folder. `codex mcp list` shows `ds`, `graph` and `lsp`. When `rule agent`
  runs Codex, it switches the `ds` server off, since it serves the same tools itself.
- **Claude Code** reads `.mcp.json` and asks once before starting each server.
- **Cortex Code** isn't checked yet. Its SDK is a fork of Claude Code's and reads Claude Code's own
  config (`~/.claude.json`) besides Cortex's `mcp.json`, so it may pick up `.mcp.json` too. Check that
  `graph` and `lsp` show in Cortex's MCP list in this folder; if they don't, add the two servers from
  `.mcp.json` to Cortex's `mcp.json`.
- **The graph's index** is built by `npm run index`, and by `rule agent` when a session starts. Refresh
  it after pulling or after large changes.
- **Serena's settings** are in `.serena/project.yml`: TypeScript, and `agent_interface: tools`, so every
  agent sees one tool per operation (`find_symbol`, `find_referencing_symbols`...) rather than Serena
  2's single REPL tool.

## Keeping this page true

- Add, move or delete a file: update the map above in the same change. `npm test` fails until you do.
- Change how a turn flows or break one of the rules above: update that section, and record why in
  `DECISIONS.md`.
- Every change also gets a line in `CHANGELOG.md`. `AGENTS.md` says the same to any agent working here.
