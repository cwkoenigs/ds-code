# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Nothing has been
released yet, so everything is under Unreleased. Pull requests before #1 here were in ds-next, where
the CLI started (`cwkoenigs/ds-next#N`).

## [Unreleased]

### Added
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
- `rule agent` asks Serena 2 for one tool per operation, so Serena's reads pass without asking. (#1)
- **Needs Node 22.22 or newer** (was 20): every dependency is at its latest release, including ink 8,
  TypeScript 7 and vitest 5. (cwkoenigs/ds-next#4)

### Fixed
- The input box, the approval and the dialog could send what was typed before the last key when
  Enter came right after it. (cwkoenigs/ds-next#1)

### Security
- The four `npm audit` advisories (vitest, tinypool, zod) are gone. (cwkoenigs/ds-next#4)
