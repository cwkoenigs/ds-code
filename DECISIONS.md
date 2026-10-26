# Decisions

<!-- ds:local adopted 2026-10-26 -->
Local decisions for this repo, numbered local-001 upward. Team-wide decisions belong in the
canon as standards; this file links them with `[[id]]` rather than restating them.

local-001 to local-008 were recorded on 2026-10-26 from the conversation that built this CLI and
from its git history. Each is dated when it was made.

## local-001: TypeScript and Ink for the reference CLI

- **Status:** Accepted
- **Date:** 2026-10-24
- **Context:** The first reference CLI for Rule was Python and Rich (`rule-cli`, still in ds-next).
  The owner asked whether another language would serve the team better, and said the AI would write
  most of it, so the choice was open. Every team machine runs Node, split between Mac and Windows.
  The CLI has to call other tools and scaffold Python templates.
- **Options considered:**
  1. **Python with Rich and prompt_toolkit**: built first, and kept. prompt_toolkit could not keep
     the input box closed on all four sides while typing, and installing meant a virtual environment
     to activate.
  2. **Go with Bubble Tea**: discussed. A single binary, but neither agent SDK this CLI now uses
     (Claude's, Cortex's) is published for Go.
  3. **TypeScript with Ink**: chosen. Node is already on every machine, `npm link` puts `rule` on the
     PATH with nothing to activate, and both agent SDKs are on npm.
- **Decision:** The Node CLI is the reference ("the prototype should be my example"). It can still
  write Python templates; scaffolding is file writing.
- **Consequences:** Two implementations exist until the Node one is confirmed on Mac and Windows;
  then the Python one can go. Ink renders with React, so the design system is a set of components.
- **Validation:** `rule demo --look rail` ran on the owner's Mac on 2026-10-26. Windows is not yet
  checked.
- **Review date:** when Windows Terminal is checked.

## local-002: A line on screen is data

- **Status:** Accepted
- **Date:** 2026-10-24
- **Context:** The design system is a grid: frames exactly 80 wide, results at column 5, labels at
  16. Tests need to check those columns, and the tour, the mockups and the web page draw the same
  screens.
- **Options considered:**
  1. **Style inside Ink components**: the widths only exist once rendered, so a test needs a terminal.
  2. **Rows of styled spans**: chosen. Builders return `Row`s (`src/text.ts`); components only render
     them.
- **Decision:** Every builder returns rows whose spans carry colour roles, never colours.
- **Consequences:** Tests measure every row of every screen without a terminal. The same rows become
  Ink lines, mockups painted on their own ground, and HTML for `rule html`. A second look meant new
  builders and palettes, not new components.
- **Validation:** The grid tests in `test/rows.test.ts` and `test/rail.test.tsx`.
- **Review date:** 2027-01-26

## local-003: The agent runs through the agents' own SDKs, with ds-next's tools ported

- **Status:** Accepted
- **Date:** 2026-10-25
- **Context:** The owner asked for ds-next's agent to work in the Node CLI, then said yes to porting
  ds-next's tools. ds-next drives Cortex Code through its Python SDK, with its knowledge-base tools
  served in process.
- **Options considered:**
  1. **Run ds-next's Python for the tools**: needs ds-next and its environment on every machine,
     and a second process per session.
  2. **Port the tools to TypeScript and serve them in process**: chosen.
- **Decision:** `rule agent` uses the Claude Agent SDK or the Cortex Agent SDK directly, chosen the
  way ds-next chooses. The 17 tools in `src/ds/` keep ds-next's names, descriptions, arguments and
  outputs. Code cutting is the exception: it runs ds-next's own functions (`python/code_cut.py`),
  because it needs Python's parser.
- **Consequences:** Two copies of the tools to keep in step. `test/parity/run.sh` runs both through
  229 steps on a real canon and compares everything; two differences are expected (a `KeyError`'s
  extra quotes, a TOML parser's wording). The port found that ds-next never registered `adopt_repo`;
  ds-next was fixed (ds-next PR #2).
- **Validation:** The parity run; `rule agent` with Claude Code completed a real turn on 2026-10-25.
  Cortex Code has not been run live.
- **Review date:** when ds-next's tools change.

## local-004: Check for the Cortex CLI before opening a session

- **Status:** Accepted
- **Date:** 2026-10-25
- **Context:** When the `cortex` CLI is missing, the Cortex SDK records the spawn error and never
  reports it: the session hangs with no message. Seen on 0.0.2, checked again on 0.0.3 on 2026-10-25.
- **Options considered:**
  1. **A timeout on the first event**: a slow start and a missing CLI look the same.
  2. **Look for the CLI first, the way the SDK will**: chosen.
- **Decision:** `openSession` looks at `CORTEX_CODE_CLI_PATH`, else `cortex` on the PATH, and says
  what is missing instead of starting.
- **Consequences:** A missing CLI is reported at once. If Snowflake changes where the SDK looks, the
  check must follow.
- **Validation:** `test/agent.test.tsx` ("says when the Cortex CLI is missing instead of hanging").
- **Review date:** each Cortex SDK upgrade.

## local-005: One CLI, two looks

- **Status:** Accepted
- **Date:** 2026-10-25
- **Context:** The owner asked for a Node version in "our dog/cat and blue design system": Rail,
  which ds-next ships and the canon's [[terminal-design]] standard describes.
- **Options considered:**
  1. **One CLI with `--look rule|rail`**: chosen by the owner.
  2. **A separate CLI for Rail**: the agent, tools and tests would be duplicated.
- **Decision:** `--look` (or `DS_LOOK`) picks the look; everything else is shared. Rail is drawn as
  ds-next ships it, including the owner's departures from the design handoff: the rounded box with the
  session tag, the brighter banner, ctrl-c twice to leave. Rule stays the default.
- **Consequences:** Everything that differs lives in `AgentLook` (`src/agent/looks.tsx`). Rail's tokens
  must stay equal to ds-next's `ui_style.py`; a test reads that file when a ds-next checkout is
  present.
- **Validation:** `test/rail.test.tsx`; the colours a real terminal received matched Rail's palette.
- **Review date:** when the team decides between Rule and Rail.

## local-006: Every dependency at its latest release, Node 22.22 or newer

- **Status:** Accepted
- **Date:** 2026-10-25
- **Context:** `npm audit` reported four advisories (two critical in vitest, one high in zod). The
  proposal was the two fixes alone, a two-week wait on new releases, and staying on Node 20. The owner
  asked why we wouldn't want the latest versions, and said the team runs Node 26.
- **Options considered:**
  1. **Patch the advisories only** (zod 4.6.7, vitest 4.1.12), keeping Node 20.
  2. **Everything at its latest release, Node 22.22 or newer**: chosen.
- **Decision:** All pins at their latest release: ink 8, TypeScript 7, vitest 5, chalk 6, and the
  rest. The minimum is Node 22.22, what Ink 8, chalk 6, vitest 5 and the Cortex SDK need. No waiting
  period for new releases.
- **Consequences:** `npm outdated` and `npm audit` came back empty, and no source changes were needed.
  Four packages were two days old when taken; supply-chain attacks tend to land in brand-new releases.
- **Validation:** 74 tests on Node 26 and on Node 22.22; the CLI driven in a terminal on Node 26.
- **Review date:** each dependency upgrade.

## local-007: Its own repo, with its own manifest

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** The CLI lived in ds-next, a Python repo tagged python, package and cli, so reconcile
  measured it against ds-next's manifest.
- **Options considered:**
  1. **A manifest for the CLI's folder inside ds-next**: small, but it stays in a Python repo.
  2. **Its own repo**: cleaner, but a move. The owner chose both at once: its own repo, with its own
     manifest.
- **Decision:** `cwkoenigs/rule-cli`, with the CLI's history carried over (`git subtree split`), adopted
  with ds-next's own adopt step, tagged node, typescript, cli, terminal, cortex, mcp and package.
- **Consequences:** 27 standards apply, each pending until the owner adopts or declines it. The
  parity script and the Rail token check now look for ds-next at `DS_NEXT`, else `~/Developer/ds-next`.
  The Rule design package and the Python CLI stay in ds-next.
- **Validation:** `ds-next reconcile` reads it as its own repo; 74 tests pass with ds-next present, and
  72 pass with the ds-next checks skipped without it.
- **Review date:** 2027-01-26

## local-008: Serena serves one tool per operation

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** Serena 2 serves a single REPL tool (`serena_repl`) by default. `rule agent` allows
  Serena's reads without asking by tool name, and Codex and Claude Code show tools by name.
- **Options considered:**
  1. **Serena 2's REPL interface**: one tool that runs Python against Serena; nothing to allow by
     name, so every call would ask.
  2. **One tool per operation** (`find_symbol`, `find_referencing_symbols`...): chosen.
- **Decision:** `.serena/project.yml` sets `agent_interface: tools`. `rule agent` passes
  `--agent-interface tools` when it finds Serena 2 or newer; Serena 1 has no such flag and would
  refuse it.
- **Consequences:** The same named tools in every agent. A Serena release that drops the tools
  interface would need this revisited.
- **Validation:** Serena 2.1.0 answered `find_symbol` and `find_referencing_symbols` for `AgentApp`
  over MCP with the repo's config; `test/codetools.test.ts`.
- **Review date:** each Serena upgrade.

## local-009: Codex through its app-server, with ds-next's tools as dynamic tools

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** The owner's work computer has Cortex Code and Codex, not Claude Code. `rule agent`
  needed Codex as a third agent, with the same approvals and the same ds-next tools.
- **Options considered:**
  1. **The Codex TypeScript SDK** (`@openai/codex-sdk`): it runs `codex exec`, which cannot ask before a
     command runs or a file changes, and takes no tools from the client.
  2. **`codex app-server`, ds tools over MCP from `rule mcp`**: approvals for commands and files work,
     but a ds write would be approved by Codex's own rules, not ours.
  3. **`codex app-server`, ds tools as dynamic tools**: chosen. Codex sends approval requests for
     commands and file changes, and calls the ds tools back on `rule`, where they run in process and
     go through the same gate as with the other agents.
- **Decision:** `rule agent --agent codex` starts the pinned `@openai/codex` package's `codex
  app-server` (or `CODEX_CLI_PATH`). Threads run with `approvalPolicy: untrusted` and the
  `workspace-write` sandbox. A "no" cancels the command or the ds tool and ends the turn, as with the
  other agents. Separately, `rule mcp` serves the same tools to Codex, Cortex or Claude Code run on
  their own; when `rule agent` runs Codex, it switches that server off so the tools aren't served
  twice.
- **Consequences:** The app-server and its dynamic tools are marked experimental, so `@openai/codex`
  is pinned and the tests run the real binary. Codex reports tokens, not dollars, so its turns end
  with a token count. Upgrading Codex means re-running those tests first.
- **Validation:** `test/codex.test.tsx`. The real app-server, its model calls going to a local
  stand-in, played full turns: a ds tool called back on `rule`; a command asked about, then run on a
  yes; on a no, the command was declined and the turn ended. Codex has not yet been run against a
  real model.
- **Review date:** each `@openai/codex` upgrade.
