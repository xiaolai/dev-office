---
name: repo-init
description: "Initialize or verify the split workspace layout: main/ and dev-docs/ as sibling repositories, worktrees/, a root AGENTS.md symlinked into each checkout, and the gate that proves ignore rules travel. Use when setting up this layout, checking a workspace, or preparing linked worktrees. Never rewrites history or moves a .git directory."
user-invocable: true
---

# Repo init

<example>
Context: Starting a new project that should use the main/dev-docs split layout.
user: "Set up this workspace with the usual main/dev-docs layout."
assistant: "I'll run `dev-office repo-init`, then `dev-office repo-init --check` and show the `gate: passed` line."
</example>

- Verify: `dev-office repo-init --check [workspace]` runs the gate only. It must print `gate: passed` before the workspace is called healthy.
- Create: `dev-office repo-init [workspace]` creates what is missing and never overwrites what exists: directories, root `AGENTS.md`, `scripts/new-worktree.sh`, `git init` in `main/` and `dev-docs/`, tracked `.gitignore` files, the `AGENTS.md` and `CLAUDE.md` symlinks in `main/`, and a local exclude for the link. Then it runs the gate.
- `--maintenance` additionally runs `git maintenance start` in both repositories. It is opt-in because it edits global git config and installs a scheduler entry.
- Each repository's `.gitignore` must be in its first commit; the gate checks HEAD. Make that commit only when the user asks.
- Worktrees: `./scripts/new-worktree.sh <name> [--settings <file>]`. A worktree's `.git` is a file pointing into `main/.git/worktrees/<name>/`; never nest them.
- Repositories with their own hooks path: `dev-office hooks-install` chains the global commit-msg, staged-content and pre-push checks into them.

Hard rules: never read or print `.env` values; never move an existing `.git` or rewrite history without explicit confirmation; never commit, add a remote or push unless asked. Migrating a single existing repository into this layout is a manual, confirmed procedure, not something this command does.

Scope: workspace layout and its gate only. Routine cleanup of merged worktrees and junk files is `tidy`'s job, not this one's.
