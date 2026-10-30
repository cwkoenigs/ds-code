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

- **Status:** Superseded by local-010 on 2026-10-26: Serena is no longer used.
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

## local-010: The code tools run on language servers rule ships

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** The owner's work machine takes software only through Nexus (its npm and PyPI
  mirrors), and the work holds PHI, so every tool has to be defensible to security. Of the two tools
  ds-next attached, Serena could come through Nexus but is GPL-3.0 and reports its use to its maker on
  every start; codebase-memory-mcp could not, since its npm and PyPI packages download the real
  binary from GitHub. Snowflake's own semantic search (tgrep) does not work on the owner's account.
- **Options considered:**
  1. **Serena alone, the graph dropped**: installable through Nexus, but the licence and the usage
     report are questions for security, and its one-tool-per-operation mode needs a flag (local-008).
  2. **Another third-party code graph**: the same small-maintainer or hosted-service problem.
  3. **The lookups built into rule, on Microsoft's TypeScript 7 server and Pyright**: chosen. Both are
     npm packages (Apache-2.0 and MIT), both work offline, and `typescript` was already a dependency.
- **Decision:** `src/code/` is a small LSP client and eight read-only tools (`find_symbol`,
  `references`, `callers`, `callees`, `file_symbols`, `definition`, `repo_overview`, `change_impact`),
  served in process as `code` by `rule agent` and by `rule mcp`, and to Codex as dynamic tools. The
  servers start on the first call that needs one, from rule's own `node_modules`, and stop with the
  session. Serena, codebase-memory-mcp, `.serena/`, `npm run index` and their config are removed.
- **Consequences:** Nothing to install or approve beyond `npm install`, and the same tools in every
  agent. `typescript` moves from devDependencies to dependencies (its native server, about 24 MB) and
  `pyright` is added (about 38 MB). TypeScript's server finds cross-file references only inside the
  nearest `tsconfig.json`'s include; Pyright resolves installed packages only with a `.venv`, a `venv`
  or `python` on the PATH. A third language means a server that speaks LSP over stdio and installs
  from npm.
- **Validation:** `test/code.test.ts` runs the real servers on two small projects, a git repo with
  uncommitted changes, and this repo; the Codex end-to-end test calls a code tool through the real
  app-server. 103 tests pass on Node 22.22 and 26.
- **Review date:** each `typescript` or `pyright` upgrade.

## local-011: Pyright gets a venv's package folders, never its python

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** An adversarial review found that `serverSpec` handed Pyright the repo's own
  `.venv/bin/python` as `python.pythonPath`, and Pyright runs the interpreter it is given to learn
  its search paths and version. Every code tool passes the permission gate without asking, so a
  cloned repo that carries an executable `.venv/bin/python` ran its own code the first time an agent
  looked up a Python symbol. `test/code.test.ts` reproduced it: the stand-in interpreter wrote its
  marker file.
- **Options considered:**
  1. **Keep `pythonPath`, but only when it links to an interpreter outside the repo**: still runs
     that interpreter with the repo's `site-packages`, whose `.pth` files may hold `import` lines,
     which Python runs at start.
  2. **Drop the venv**: nothing runs, but Pyright loses the project's installed packages, the
     reason the venv was used (local-010).
  3. **Give Pyright the venv's `site-packages` and the folders its `.pth` files add, as
     `python.analysis.extraPaths`**: chosen. Pyright reads them; nothing in the repo runs.
- **Decision:** `packagesIn` finds `lib/python*/site-packages` (or `Lib/site-packages` on
  Windows) under `.venv` or `venv`, adds the path lines of its `.pth` files (editable installs) and
  skips their `import` lines. Pyright gets no `pythonPath`, so for the standard library it runs
  `python3` or `python` from the PATH, the person's own, with a script that drops the working
  directory from `sys.path` before it imports anything.
- **Consequences:** Imports resolve from the venv as before. Pyright now takes the Python version
  from the PATH's interpreter, not the venv's, which matters only for version-gated stubs. A `.pth`
  file's `import` lines (setuptools' editable finders) add nothing.
- **Validation:** `test/code.test.ts` builds a project whose `.venv/bin/python` writes a marker:
  imports from its `site-packages` resolve and the marker is never written. The same test fails on
  the code before this change.
- **Review date:** each `pyright` upgrade.

## local-012: The first Pyright call waits for Pyright to find the repo

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** Pyright answers requests made before it has found the repo's files from the open
  files alone. A first `find_symbol` said "no symbol named greet", and `references` missed the
  uses in files not yet open; `test/code.test.ts` failed on every run on the owner's Mac.
  TypeScript's server loads its project while opening the first file, so its answers are whole at
  once.
- **Options considered:**
  1. **Retry until an answer is non-empty**: an empty answer can be true, and a short list of
     references is not empty.
  2. **Wait for Pyright's progress notifications**: Pyright reports analysis progress, not the end
     of finding files, and only when the client shows progress.
  3. **Wait for the first diagnostics of the file opened at start**: chosen. Pyright publishes them
     after it has logged "Found N source files", even for a file in an excluded folder.
- **Decision:** `ServerSpec.settlesOnDiagnostics` marks Pyright; `CodeIntel.server` waits on
  `LanguageServer.diagnosed`, at most 30 s, before the first answer: for the first diagnostics of any
  file, since the anchor is the one file open and Pyright checks only open files. Not the anchor's
  URI: on Windows Pyright spells it its own way (`file:///c%3A/...`), and the wait ran the full 30 s.
  A server that stops ends the wait.
- **Consequences:** The first Python call takes as long as Pyright needs to find the repo's files
  (about a quarter of a second for the fixture). If Pyright never publishes, the call waits 30 s and
  then answers as it can.
- **Validation:** `test/code.test.ts`'s Pyright test passes three runs in three, and failed three in
  three before.
- **Review date:** each `pyright` upgrade.

## local-013: Control characters are drawn, not obeyed, where spans are made

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** The review's Codex pass showed that Ink passes SGR codes through: a command holding
  `ESC[8m … ESC[28m` showed in the approval dialog as only what came before the conceal. Ink
  already drops carriage returns, erase-line and the clipboard and title OSC sequences; it keeps
  styles (SGR) and OSC 8 links.
  Nothing in rule writes an escape code into a row: colour is a role, resolved by `theme.ts`.
- **Options considered:**
  1. **Strip control characters in the components, at render**: the rows' widths were measured
     before, so frames would break wherever a span lost characters.
  2. **Clean each untrusted source (model text, tool output, approval inputs)**: many entry points,
     and a new one would be missed.
  3. **Draw them as symbols in `s()` and `row()`, where every span is made**: chosen. Every builder
     goes through them, widths are measured after, and the person sees that something was there.
- **Decision:** `text.visible` turns C0 controls but tab and newline into Unicode control pictures
  (ESC as `␛`), DEL into `␡` and C1 controls into `�`; `s()` and `row()` apply it.
- **Consequences:** Model text, tool output and approvals can no longer style or move the terminal.
  A tool's own coloured output shows its codes as `␛[31m`, which is what it held.
- **Validation:** `test/agent.test.tsx` checks a concealing command in the dialog and an OSC 52 and
  C1 sequence in the transcript; both failed before.
- **Review date:** each Ink upgrade.

## local-014: The code tools show nothing outside the repo but libraries

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** The tools checked paths by their spelling. A file in the repo that is a link to one
  outside it (`src/leak.ts → ~/private.ts`) passed, and its lines and symbols came back from a tool
  that never asks; TypeScript's server also finds such files through the repo's `tsconfig.json`. The
  canon's gotcha-approvals asks that a read outside the project ask first.
- **Options considered:**
  1. **Check the path the model names, with its links followed**: closes the direct read, but the
     servers still return the file's symbols and lines from their own scan.
  2. **Ask before showing anything from outside the repo**: the code tools have no way to ask;
     they pass the gate as reads.
  3. **Treat a file reached through a link out of the repo as outside it, and show nothing from
     outside but libraries**: chosen. One rule in `external()`, which every answer already uses.
- **Decision:** `repo.realWithin` follows links on both sides. `listFiles` leaves out links that
  lead out; `abs` refuses them by name; `external` judges a location by its real path against the
  repo's real root, and a library by a real library folder, never by a name; `raw` reads no line
  from outside but `node_modules`, `site-packages` and the standard library; `locate` and
  `references` drop locations outside, and `callers` and `callees` count them without naming them.
- **Consequences:** References from files outside the repo, which a `tsconfig.json` could include,
  are no longer listed. Links inside the repo, and libraries wherever they are, are unchanged.
- **Validation:** `test/code.test.ts` links a file outside the repo into it: `definition` refuses it,
  and neither `find_symbol` nor `repo_overview` names it. The test failed before.
- **Review date:** when a third language server is added.

## local-015: Claude sessions run no hooks

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** Codex's review said a repo's `.claude/settings.json` permission rules could skip
  `canUseTool`. A live probe on the owner's Mac (Agent SDK 0.3.310, Haiku) found that a project
  `allow: ["Bash"]` still reached rule's gate, but a project `SessionStart` hook ran its command as
  the session started, with nothing asked. `settingSources` includes `'project'` so the repo's
  `CLAUDE.md` loads, and that loads the project's hooks too. Claude Code asks before trusting a
  folder; the SDK has no such prompt, and neither does rule.
- **Options considered:**
  1. **`settings: {disableAllHooks: true}`**: chosen. The flag tier outranks project settings and
     is not a policy tier, so an IT-managed tier does not drop it; managed hooks still run. The
     user's own hooks stop running in `rule agent` too.
  2. **Ask once per repo, as Claude Code does**: keeps the user's hooks, but needs a new prompt and
     a stored list of trusted folders.
  3. **Drop `'project'` from `settingSources`**: no project hooks, but no `CLAUDE.md`, project skills
     or commands either.
  4. **`managedSettings: {allowManagedHooksOnly: true}`**: worked in the probe, but the SDK drops
     an embedder's managed settings where an IT-managed tier exists, as on work machines, silently.
- **Decision:** the Claude session passes `settings: {disableAllHooks: true}`.
- **Consequences:** No hook from the user, the project or local settings runs in `rule agent`;
  `CLAUDE.md`, skills, commands and the permission gate are unchanged. Cortex Code runs a project's
  hooks too, and cannot be stopped the same way (local-016); Codex's did not run (local-016).
- **Validation:** `test/agent.test.tsx` starts the real Claude Code, with a home of its own, a fake
  key and a dead address, in a folder whose settings define a `SessionStart` hook; the hook does not
  run. On the code before this change it does.
- **Review date:** each `@anthropic-ai/claude-agent-sdk` upgrade, and if people miss their hooks
  (then option 2).

## local-016: Cortex Code asks before it starts where a repo defines hooks

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** A live probe (Cortex Code 1.2.18, Cortex agent SDK) in a folder whose
  `.cortex/settings.json` and `.claude/settings.json` define hooks: both `UserPromptSubmit` hooks
  ran on the first prompt, with nothing asked. Codex 0.164.0 ran no project hook in the same test,
  even with the project marked trusted and `codex_hooks` on; it keeps a per-hook trust store. A
  repo's own `.cortex` or `.claude` permission rules did not skip rule's gate.
- **Options considered:**
  1. **`settingSources: ['user']`**: tried. The hooks still ran, and Cortex no longer read the
     repo's `AGENTS.md` or `CLAUDE.md`.
  2. **`--config` with `disableAllHooks: true`** (through the SDK's `extraArgs`): tried. The hooks
     still ran.
  3. **Show the person every hook and ask before the session starts**: chosen. The canon's
     gotcha-approvals: commands always ask.
- **Decision:** before a Cortex session, `projectHooks` reads `.cortex/settings{,.local}.json` and
  `.claude/settings{,.local}.json` in the folder and at the repo's top. When any define hooks, the
  approval dialog shows each event and command, whole, and any hook with more than a command
  (`args`, an env) as its JSON. A no starts nothing and says to remove them or to use
  `--agent claude`; a yes lasts while rule runs, until a settings file's text changes.
- **Consequences:** Cortex in a repo with hooks costs one question per run of rule. A settings file
  that names hooks but is not JSON is shown whole. Hooks Cortex reads from anywhere else are not
  seen.
- **Validation:** `test/agent.test.tsx` opens a Cortex session where `.cortex/settings.json` defines
  a hook: the person is asked with the command, and a no starts nothing.
- **Review date:** each `@snowflake/cortex-agent-sdk` upgrade: switch to its off switch when it has one.

## local-017: No settings file lets a Claude tool skip the dialog

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** Offline, with the real Claude Code and a stand-in Messages API
  (`test/fixtures/fake-anthropic.ts`): with `permissions.allow: ["Bash"]` in the person's own
  settings, a `Bash` command ran and rule never asked. A "don't ask again" saved in Claude Code is the
  same kind of rule. The README, `AGENTS.md` and the canon's gotcha-approvals all say commands and
  writes ask.
- **Options considered:**
  1. **Honour the person's rules, and say so**: fewer questions, but rule's one promise breaks for
     anyone who has used Claude Code.
  2. **`managedSettings: {allowManagedPermissionRulesOnly: true}`**: the SDK drops it on machines
     with an IT-managed tier, as on work machines, silently.
  3. **Drop `'user'` from `settingSources`**: also drops the person's `CLAUDE.md` and skills.
  4. **A `PreToolUse` callback that answers "ask" for everything but Claude Code's reads**: chosen.
     It runs under `disableAllHooks`, since it is not a settings-file hook, and "ask" sends the call
     to `canUseTool`.
- **Decision:** `askFirst` leaves `Read`, `Glob`, `Grep` and Claude Code's other read, plan and
  hand-off tools as Claude Code decides, and rule's own read-only tools; every other tool, a new one
  included, goes to the dialog.
- **Consequences:** Allow rules in settings no longer save a question in `rule agent`; deny rules
  still apply. Reads in the project still pass, and reads outside it still ask.
- **Validation:** `test/agent.test.tsx`: with a user allow rule for `Bash`, the command asks and,
  declined, does not run (it ran before); a `Read` in the project still does not ask.
- **Review date:** each `@anthropic-ai/claude-agent-sdk` upgrade.

## local-018: A block's manifest table lists the files it wrote

- **Status:** Accepted
- **Date:** 2026-10-26
- **Context:** Codex's review (#8): `addBlock` and `code.add` checked for files in the way only on
  a first add, so an update that brought a new file replaced whatever was there. ds-next has the
  same code. Nothing recorded which files a block wrote, and the manifest format is shared.
- **Options considered:** compare contents (an older version's files are not in the canon); refuse
  every existing file on update (every update would fail); record the files, in both repos: chosen.
- **Decision:** as ds-next's local-002 (cwkoenigs/ds-next#6): each `[blocks.<id>]` table gains
  `files = [...]`; an update replaces only those, or for an older table the recorded module and the
  tests that import it (`scaffold.ownedFiles`).
- **Consequences:** the parity check needs ds-next with that change; a manifest from before keeps
  working, and its next update writes the list.
- **Validation:** `test/ds.test.ts` and ds-next's `tests/test_blocks.py` check the same cases with
  the same messages; parity against that branch: 0 unexpected differences, the `files` lines
  compared.
- **Review date:** when the manifest format next changes.

## local-019: rule-cli becomes ds-code, the code tools alone

- **Status:** Accepted
- **Date:** 2026-10-27
- **Context:** The owner has two agent terminals doing one job: ds-next (Python) and rule-cli (Node),
  kept equal by a parity test, and wants one. Every team machine has Python, uv and Node, so Node's
  advantage of needing nothing else installed (local-001) is gone, and atlas and the terminal design
  system (`ds-cli-design`) are Python. ds-next stays the terminal. The code tools (local-010 to
  local-014) were rule-cli's alone, and are worth keeping.
- **Options considered:**
  1. **Port the code tools to Python inside ds-next**: TypeScript's server and Pyright are npm
     packages, so the port would still run Node, and two copies would need a parity test.
  2. **A new repo for the code tools, rule-cli archived**: one more repo to know about.
  3. **rule-cli cut down to the code tools, renamed ds-code**: chosen. One implementation, served over
     MCP to any agent, keeping the history of the files it holds.
- **Decision:** The repo holds the eight code tools, `ds-code mcp` and their tests. The terminal, the
  looks, ds-next's ported tools, Codex and the Python helper go. ds-next attaches `ds-code mcp` as its
  `code` server. local-001 to local-009, local-013 and local-015 to local-018 were about the terminal;
  they stay as the record of how this repo got here, and ds-next takes what it adopts from them (Codex
  through its app-server, local-009, first).
- **Consequences:** Until ds-next drives Codex, `rule agent` on rule-cli's main is the only terminal
  for Codex, so main changes only when ds-next can. The repo is renamed on GitHub with this pull
  request; GitHub redirects the old name, so rule-cli's clones, remotes and links keep working.
  `references` and `callers` open the files that mention a name before asking TypeScript's server, so
  uses outside every `tsconfig.json` (tests, scripts) are found in any repo.
- **Validation:** `npm run typecheck` (source and tests); `npm test`, 27 tests, including the MCP
  server's tools and annotations and uses found in a file no tsconfig includes. Closing its stdin ends
  ds-code and its language server.
- **Review date:** when ds-next's `code` server is in use at work.


## local-020: The first release is 0.1.0, not 0.2.0

- **Status:** Accepted
- **Date:** 2026-10-29
- **Context:** Nothing in this repo had ever been tagged. canon and ds-next cut v0.2.0 on 2026-10-28 and
  bundled ds-code at whatever HEAD was, so the only name for the code they shipped was a commit hash.
  `package.json` has said 0.1.0 since the repo began.
- **Options considered:**
  1. **Tag v0.2.0 to match canon and ds-next**: reads as if the repos move together, which they do not;
     ds-code changes when the language servers or the tools do, not when the canon does.
  2. **Tag v0.1.0, as `package.json` says**: chosen. The version is the package's own, and every
     changelog entry so far is the road to this first working release.
  3. **Keep shipping from HEAD**: the bundles and `npm link` work without a tag, but nothing can pin.
- **Decision:** Tag `v0.1.0` on main at this pull request. The changelog's Unreleased section becomes
  `0.1.0 - 2026-10-29` with one Fixed section (the #6 and #5 entries were under two), and a fresh
  Unreleased opens above it with Keep a Changelog's compare links.
- **Consequences:** Installs may `git checkout v0.1.0`; the README's `git pull` path is unchanged.
  Each later release bumps `package.json` and `package-lock.json` by npm (`npm version`), never by hand.
- **Validation:** `npm run typecheck` and `npm test` (27 tests) pass on the release commit; CI runs both
  on macOS and Windows for the pull request.
- **Review date:** at the next release, to see whether the version still tells the installs apart.

## local-021: The build sets the executable bit, not the installer

- **Status:** Accepted
- **Date:** 2026-10-29
- **Context:** canon's `bootstrap.sh` installs ds-code with `npm ci` (which builds through `prepare`)
  and `npm link`. npm sets the bin's mode only when it creates the global link. On a machine where the
  link already pointed at `~/Developer/ds-code` and the clone underneath was replaced (the reinstall
  path in the guide: move the repos aside, run the installer again), `npm link` was a no-op and the
  freshly compiled `dist/cli.js` kept mode 644, so `ds-code` failed with "permission denied" while
  bootstrap reported it linked.
- **Options considered:**
  1. **`chmod +x` in bootstrap.sh after `npm link`**: fixes one installer; a wheel-less `npm install -g`
     or a Windows checkout would each need their own.
  2. **Unlink and relink in bootstrap.sh**: churns the global link on every update to fix a mode bit.
  3. **The build sets the mode (`postbuild`), and `prepare` runs `build`**: chosen. Whatever builds the
     package produces a runnable bin; `fs.chmodSync` is a no-op on Windows, where npm's `.cmd` shim is
     what runs.
- **Decision:** `package.json` scripts are `build` (tsc), `postbuild` (`chmodSync("dist/cli.js", 0o755)`),
  `prepare` (`npm run build`). bootstrap.sh gains a check that `ds-code --version` answers after the link
  (cwkoenigs/canon, the lifecycle pull request).
- **Consequences:** Reinstalling over an existing link works. The only Node code outside `src/` is the
  one-line `postbuild`.
- **Validation:** `chmod 644 dist/cli.js && npm run build` leaves `dist/cli.js` at 755; `npm run typecheck`
  and `npm test` pass.
- **Review date:** when the package is first installed from a registry rather than a checkout.
