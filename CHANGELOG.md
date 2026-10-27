# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Nothing has been
released yet, so everything is under Unreleased. Pull requests before #1 here were in ds-next, where
the CLI started (`cwkoenigs/ds-next#N`).

## [Unreleased]

### Fixed
- An allow rule in the person's own Claude settings, or a "don't ask again" saved in Claude Code,
  ran commands in `rule agent` without the dialog. Every Claude tool but the reads now asks
  (local-017). (#5)
- Cortex Code ran a repo's own hooks from its `.cortex` or `.claude` settings, and its SDK cannot
  stop it; `rule` now shows the hooks and asks before a Cortex session starts there (local-016). (#5)
- `block_add` and `code_add` wrote `pyproject.toml` and `.ds/manifest.toml` through a symbolic link;
  they now refuse, before writing anything. (#5)
- `code_get` could have uv download and install a Python; it now uses only one uv already has, offline. (#5)
- A TOML float version (`version = 1.0`) passed `reconcile`, where ds-next rejects it; it is now an
  error worded as ds-next words it. (#5)
- A Windows share path (`\\server\share`) lost a leading backslash in `purePath`, as Python's `Path`
  never does. (#5)
- The parity check printed differences and still passed; it now fails on any difference but the
  two the README names, and covers float versions. (#5)
- A Codex request that never got an answer waited for good, and could hold a session's start; each
  now gives up after 60 s. (#5)
- Two first calls for a language could start two servers, one never stopped, and a server that
  failed to start kept running. (#5)
- `rule mcp` said every write was additive; `adopt_repo`, `block_add` and `code_add` now say they can
  change what is there. (#5)
- The line editor split emoji: backspace, ← and → moved by UTF-16 unit, and could send half a
  character. (#5)
- A Claude session ran the repo's own hooks: a cloned repo's `.claude/settings.json` could run a
  command as `rule agent` started, with nothing asked. Claude sessions now run no hooks but those an
  organisation manages (local-015). (#5)
- The code tools no longer run a repo's own `.venv/bin/python`: Pyright was given it as its
  interpreter and ran it, so a cloned repo could run code from a tool that never asks. Pyright now
  gets the environment's package folders instead (local-011). (#5)
- Pyright's first answers were short: until it has found the repo's files it answers from the open
  ones, so a first `find_symbol` said "no symbol" and `references` missed other files' uses. The
  first call now waits for it to settle (local-012). (#5)
- `change_impact` said "used nowhere else" when a references lookup failed; it now says the uses are
  unknown, and why. (#5)
- Approvals show the whole request in both looks: Rule showed six lines of a command and Rail eight,
  and long lines were cut. (#5)
- A session that stopped while its approval was showing left that question unanswered, and every
  later approval, in this session or the next, waited behind it until `rule` was restarted. A late
  close from an ended session could also drop the next session. (#5)
- A model's or a tool's escape codes reached the terminal: `ESC[8m` could hide the end of a command
  in the approval. Control characters now show as symbols (`␛`) everywhere (local-013). (#5)
- A Codex patch over several files asked about the first file only, and a delete read as an edit; the
  approval now names every file and what happens to it. (#5)
- The code tools read through links: a file in the repo linked to one outside it showed that file's
  lines and symbols. They now show nothing outside the repo but libraries (local-014). (#5)
- `change_impact` ran `git diff` with textconv on, so a diff driver in git config ran a command from
  a tool that never asks. (#5)
- `test/codex.test.tsx` assumed no canon on the machine; it now sets `DS_CANON` and `DS_SKILLS` itself. (#5)

### Added
- README: updating with `npm ci` and why, prompts that reach each code tool and the first real
  answer, why the code tools rather than Serena or a code graph, and what does and doesn't leave the
  machine at work. (#4)
- The `code` tools, served by `rule agent` beside `ds` and by `rule mcp`, to every agent: `find_symbol`,
  `references`, `callers`, `callees`, `file_symbols`, `definition`, `repo_overview` and `change_impact`,
  answered by TypeScript 7's language server and Pyright, which install with `rule` from npm. Nothing
  else to install, nothing leaves the machine. (#3)
- `rule agent --agent codex`: Codex as a third agent, through `codex app-server`, with the same
  approvals and ds-next's tools; the turn footer shows its token count. (#2)
- `rule mcp`: ds-next's tools and `rule_spec` as an MCP server, for Codex, Cortex Code or Claude Code
  run on their own. The repo's Codex and Claude Code configs start it as `ds`. (#2)
- `ARCHITECTURE.md`: how a turn flows, the rules the code keeps, every file and what it holds, and where
  to make a given change. A test fails when a file is added or removed without it. (#1)
- `DECISIONS.md` records the decisions so far, local-001 to local-008. (#1)
- The code graph and Serena for agents opened in this repo: `.codex/config.toml` for Codex, `.mcp.json`
  for Claude Code, `.serena/project.yml` for Serena. `npm run index` builds or refreshes the graph. (#1)
- Its own repo, `cwkoenigs/rule-cli`, with its history, in the knowledge system with its own
  manifest: 27 canon standards apply, each pending until the owner decides. (cwkoenigs/ds-next#5)
- Rail, the look ds-next ships, beside Rule: `--look rail` or `DS_LOOK=rail` for `rule agent`,
  `rule demo`, `rule screen` and `rule html`. (cwkoenigs/ds-next#1)
- `rule agent`: a real Cortex Code or Claude Code session with ds-next's 17 tools, ported, plus
  approvals, interrupts, queued messages, a stall watchdog and `/last`. (cwkoenigs/ds-next#1)
- The reference CLI for Rule: the 19-chapter tour, the seven screens, the spec as data, `rule html` and
  `rule demo`. (cwkoenigs/ds-next#1)

### Changed
- `typescript` is a runtime dependency now (the code tools run its native language server), and
  `pyright` is a new one. (#3)
- `rule agent` asks Serena 2 for one tool per operation, so Serena's reads pass without asking. (#1)

### Removed
- Serena and codebase-memory-mcp: `rule agent` no longer looks for them, and `.serena/`, `npm run index`
  and the `graph` and `lsp` servers in `.codex/config.toml` and `.mcp.json` are gone. The `code` tools
  replace them, with nothing to install or approve. (#3)
- **Needs Node 22.22 or newer** (was 20): every dependency is at its latest release, including ink 8,
  TypeScript 7 and vitest 5. (cwkoenigs/ds-next#4)

### Fixed
- The input box, the approval and the dialog could send what was typed before the last key when
  Enter came right after it. (cwkoenigs/ds-next#1)

### Security
- The four `npm audit` advisories (vitest, tinypool, zod) are gone. (cwkoenigs/ds-next#4)
