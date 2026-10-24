#!/bin/sh
set -eu

usage() {
    printf 'usage: %s <worktree-name> [--settings <file>]\n' "$0" >&2
    exit 2
}

name=
settings=

while [ "$#" -gt 0 ]; do
    case "$1" in
        --settings)
            [ "$#" -ge 2 ] || usage
            settings=$2
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        -*)
            usage
            ;;
        *)
            [ -z "$name" ] || usage
            name=$1
            shift
            ;;
    esac
done

[ -n "$name" ] || usage

if ! printf '%s\n' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
    printf 'invalid worktree name: %s\n' "$name" >&2
    exit 2
fi

if [ -n "$settings" ] && [ ! -r "$settings" ]; then
    printf 'settings file not readable: %s\n' "$settings" >&2
    exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname "$script_dir")
main="$root/main"
target="$root/worktrees/$name"

[ -d "$main/.git" ] || {
    printf 'main repository not found: %s\n' "$main" >&2
    exit 1
}
git -C "$main" rev-parse --verify HEAD >/dev/null 2>&1 || {
    printf 'main has no commits; create an initial commit before adding a worktree\n' >&2
    exit 1
}
[ ! -e "$target" ] || {
    printf 'target already exists: %s\n' "$target" >&2
    exit 1
}
if git -C "$main" show-ref --verify --quiet "refs/heads/$name"; then
    printf 'branch already exists: %s\n' "$name" >&2
    exit 1
fi

git_dir=$(git -C "$main" rev-parse --git-common-dir)
case "$git_dir" in
    /*) ;;
    *) git_dir="$main/$git_dir" ;;
esac

exclude="$git_dir/info/exclude"
mkdir -p "$(dirname "$exclude")"
# Root-anchored, so a plugin may still ship its own nested AGENTS.md.
if ! grep -qxF '/AGENTS.md' "$exclude" 2>/dev/null; then
    printf '\n# Local agent files\n/AGENTS.md\n' >> "$exclude"
fi
if ! grep -qxF '.claude/settings.local.json' "$exclude" 2>/dev/null; then
    printf '.claude/settings.local.json\n' >> "$exclude"
fi

if [ ! -e "$main/AGENTS.md" ]; then
    ln -s ../AGENTS.md "$main/AGENTS.md"
fi

git -C "$main" worktree add "$target" -b "$name"
# A symlink, not `@../../AGENTS.md`: an import outside the working directory needs approval once per project and may
# not load in a headless run, and Codex and Gemini do not read `@` imports at all.
ln -s ../../AGENTS.md "$target/AGENTS.md"

if [ -n "$settings" ]; then
    mkdir -p "$target/.claude"
    settings_dest="$target/.claude/settings.local.json"
    # `-e` alone misses a dangling symlink (it follows the link and reports
    # false for a broken target), and checking existence before `cp` leaves a
    # window for something else to create the file in between. `set -C`
    # (noclobber) makes the `>` redirect itself fail — atomically, at the
    # shell's open(2) call — if anything is already there, dangling symlink
    # included, so the exclusivity is enforced by the write, not a prior check.
    if [ -e "$settings_dest" ] || [ -L "$settings_dest" ]; then
        printf 'kept existing local settings: %s\n' "$settings_dest" >&2
    elif (set -C; cat "$settings" > "$settings_dest") 2>/dev/null; then
        chmod 600 "$settings_dest"
        printf 'copied local settings: %s\n' "$settings_dest"
    else
        printf 'kept existing local settings: %s\n' "$settings_dest" >&2
    fi
fi

printf 'created %s\n' "$target"
