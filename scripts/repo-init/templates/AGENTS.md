# Workspace Layout

```text
./
├── main/                  # primary Git repository
│   ├── .git/
│   └── AGENTS.md          # ignored; symlink to ../AGENTS.md
├── dev-docs/              # separately tracked documentation repository
│   └── .git/
├── scripts/
│   └── new-worktree.sh    # creates a worktree, AGENTS link, optional settings
├── worktrees/             # linked worktrees, one subdirectory each
│   └── <worktree-name>/
│       ├── .git           # file pointing into the source repository
│       ├── AGENTS.md      # ignored; symlink to ../../AGENTS.md
│       └── .claude/settings.local.json  # optional; ignored; per worktree
└── .env                   # local environment file; never read its values
```

- Initialize or verify this layout with the `/repo-init` skill. Its gate must
  pass before the workspace is called healthy.
- `./` is not a Git repository.
- `main/` and `dev-docs/` are independent repositories.
- A worktree is not a third repository: its `.git` is a file that points into
  the source repository's `.git/worktrees/<name>/`.
- Create worktrees with `./scripts/new-worktree.sh <name> [--settings <file>]`.
  Do not nest them.
- `--settings` copies a local file to the worktree's ignored
  `.claude/settings.local.json` and never overwrites an existing file.
- The `AGENTS.md` link files are symlinks to this file and are ignored; never
  commit them. A symlink, not an `@` import: an import resolving outside the
  working directory needs approval once per project and may not load in a
  headless run, and Codex and Gemini do not read `@` imports at all.
- Local settings are ignored; never symlink them across worktrees.
- Keep `.env` at the workspace root, outside both repositories.
