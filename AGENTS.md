# AGENTS.md

<!-- ds:local adopted 2026-10-26 -->
The ds-next agent terminal in Node, drawn in Rule or Rail, for the team on Mac and Windows

- Test: `npm test`
- Lint: `npm run typecheck`
- Before changing anything, read `.ds/manifest.toml`: it says which standards are in force here.
- The team's knowledge base is served by `ds-next mcp` (canon_list, canon_read, code_search, code_get, code_add) for any agent that can reach it.

<!-- ds:inherited canon 2026-10-26 -->
## Standards

Standards that apply here, each pending until the owner adopts or declines it in `.ds/manifest.toml` (`/status` in ds-next): [[adr-000]], [[adr-001]], [[architecture]], [[change-cadence]], [[cicd]], [[code-review]], [[compliance-rubric]], [[decision-logs]], [[error-handling]], [[gotcha-agent-trust]], [[gotcha-approvals]], [[gotcha-cortex-sdk]], [[gotcha-green-means-ran]], [[gotcha-proving-claims]], [[gotcha-terminal-ui]], [[gotcha-tool-arguments]], [[gotcha-verify-process]], [[lifecycle]], [[llm-agents]], [[normative-language]], [[operating-principles]], [[repo-naming]], [[review-cadence]], [[security]], [[templates]], [[terminal-design]], [[testing]].

## Skills

From skills-os:

- `/so-build-feature-interview`: Turn a feature request on an existing app into a reviewed, phased implementation plan with a decision log and external review gates.
- `/so-bug-review-interview`: Turn a bug report into a reproduced, root-caused, phased fix plan with a decision log and external review gates.
- `/so-capture`: Capture problems, discoveries, decisions and gotchas from a coding session into structured draft records, then flush them to the team knowledge repo as a GitLab MR for review before publication.
- `/so-changes`: Record decisions (ADRs), log shipped changes (changelog), draft stakeholder communications, and capture cross-project insights.
