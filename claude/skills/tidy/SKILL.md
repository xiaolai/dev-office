---
name: tidy
description: "Housekeeping for the current repository: junk files to the Trash, pruned worktrees, merged branches, git maintenance, and the 30-day dev-office report. Use when asked to tidy, clean up, or housekeep a repo, or monthly. Dry run first; nothing is removed with rm."
user-invocable: true
---

# Tidy

<example>
Context: A monthly housekeeping pass on an active repository.
user: "Tidy this repo."
assistant: "I'll run `dev-office tidy`, show the dry run, and apply only what you confirm with `--apply`."
</example>

1. Run `dev-office tidy` and show its output. It is a dry run: every line says what would happen, and the report at the end shows sessions and test runs for the last 30 days.
2. If the user wants the listed actions, run `dev-office tidy --apply`. Junk goes to `~/.Trash`; branches are deleted only with `git branch -d`, which refuses anything unmerged.
3. From the report, name instruction files, agents or test tiers the numbers show as unused. Propose deletions; do not perform them from this skill.

Configuration keys under `tidy` in `.dev-office.json` turn each step off. `dev-office config` shows the effective values.

Scope: junk files, pruned worktrees, merged branches, maintenance and reporting. It never deletes without `--apply` and never sets up the workspace layout — see `repo-init` for that.
