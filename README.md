# dev-office

A lean, self-measuring dev office for coding agents. Logic lives once in
host-neutral scripts under `scripts/`; `claude/` is the Claude Code adapter and
`codex/` is the Codex CLI adapter with the same features. The Codex tree is
derived from the Claude one by `dev-office gen-codex`; a test fails if they
drift. Codex plugins carry skills and hooks but not agents, so `dev-office
install` copies the three agent files into `~/.codex/agents/`.

| Piece | Form | Command |
|---|---|---|
| Perception | two hooks | SessionStart budget line and rules; SessionEnd log record |
| Tests | script | `dev-office test edit\|pr\|full` with quarantine expiry |
| Git routine | scripts | `dev-office hooks-install`, `env-audit`, `release`, `repo-init` |
| Housekeeping | script | `dev-office tidy [--apply]` |
| Decisions | script | `dev-office adr new\|refute\|list` |
| Judgment | three agents | `planner`, `implementer`, `verifier` |
| Contract | twelve lines | `rules/orchestration.md` |

Configuration merges `defaults.json`, `~/.dev-office/config.json`, the
repository's `.dev-office.json` and `.dev-office.local.json`, later wins.
`dev-office config` prints the effective values with their source layer.

Install: `dev-office install` (see `scripts/install.mjs`), then the `claude
plugin` and `codex plugin` commands it prints, and trust the Codex hooks once
with `/hooks` in the Codex TUI. Tests: `npm test`. No runtime dependencies.

Known host differences, all encoded in tests or the installer: Codex's
SessionEnd hook gets at most 3 seconds and no transcript path, so the session's
rollout file is found by id under `~/.codex/sessions/`; Codex agents inherit the
default model and only the reasoning effort carries over; a headless
`codex exec` must have stdin closed or it waits for more input.
