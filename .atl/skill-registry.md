# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review | branch-pr | C:\Users\tapla\.config\opencode\skills\branch-pr\SKILL.md |
| When writing Go tests, using teatest, or adding test coverage | go-testing | C:\Users\tapla\.config\opencode\skills\go-testing\SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature | issue-creation | C:\Users\tapla\.config\opencode\skills\issue-creation\SKILL.md |
| When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen" | judgment-day | C:\Users\tapla\.config\opencode\skills\judgment-day\SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | C:\Users\tapla\.config\opencode\skills\skill-creator\SKILL.md |

## Compact Rules

### branch-pr
- Every PR MUST link an approved issue; blank PRs are blocked.
- Add exactly one `type:*` label to each PR.
- Branch names MUST match `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\/[a-z0-9._-]+$`.
- PR body MUST include `Closes/Fixes/Resolves #N`, summary bullets, changes table, test plan, and checklist.
- Commit messages MUST use conventional commits.
- Run `shellcheck` on modified scripts before merging.

### go-testing
- Prefer table-driven tests for multiple cases.
- Test Bubbletea models by calling `Update` directly and asserting state transitions.
- Use `teatest.NewTestModel()` for full TUI flows and `WaitFinished`/`FinalModel` for assertions.
- Use golden files for `View()` output snapshots.
- Use `t.TempDir()` for filesystem tests and mock side effects where practical.

### issue-creation
- Blank issues are disabled; use a template.
- Every issue gets `status:needs-review` automatically.
- A maintainer MUST add `status:approved` before any PR can be opened.
- Questions belong in Discussions, not issues.
- Choose the correct template and fill all required fields.

### judgment-day
- Resolve the skill registry before launching judges; match skills by code context and task context.
- Launch TWO blind judges in parallel with identical target and standards.
- Classify warnings as real vs theoretical; theoretical warnings become INFO and do not block.
- Confirmed CRITICALs or real warnings go to a separate Fix Agent, then re-run both judges.
- After 2 fix iterations, escalate to the user if issues remain.

### skill-creator
- Create skills only for reusable, non-trivial patterns or workflows.
- Use `skills/{skill-name}/SKILL.md`; put templates/schemas in `assets/` and local docs in `references/`.
- Frontmatter MUST include name, description with trigger, Apache-2.0 license, author, and version.
- Start with critical patterns, keep examples minimal, and include a Commands section.
- `references/` should point to local files, not web URLs.

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| None found | — | No AGENTS/CLAUDE/cursorrules/GEMINI/copilot-instructions detected |
