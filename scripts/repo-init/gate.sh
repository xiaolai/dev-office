#!/bin/sh
# repo-init gate — the layout and its ignore guarantees, checked rather than assumed.
#
#   gate.sh [workspace]        default: the current directory
#
# Exit 0: every check passed. Exit 1: one or more failed, each printed as FAIL.
# Exit 2: usage, or the argument is not a directory.
#
# Why the ignore checks are the point: .git/info/exclude is local to one clone,
# so a rule that lives only there does not travel — the checkout can look clean
# by hand while a fresh clone shows the file as untracked and can commit it by
# accident. A rule anchored to the repository root misses the copy a tool writes
# in a subdirectory. Every rule for the tools' files must therefore come from a
# .gitignore that Git tracks, and the gate asks Git itself (git check-ignore
# --no-index) instead of reading the files and guessing.
set -u

usage() { printf 'usage: %s [workspace]\n' "$0" >&2; exit 2; }
[ "$#" -le 1 ] || usage
ws=${1:-.}
[ -d "$ws" ] || usage
ws=$(CDPATH= cd -- "$ws" && pwd -P) || usage

failed=0
ok()   { printf 'ok   %s\n' "$*"; }
bad()  { printf 'FAIL %s\n' "$*"; failed=$((failed + 1)); }
note() { printf 'note %s\n' "$*"; }

# --- layout -----------------------------------------------------------------

if [ -e "$ws/.git" ]; then
    bad "the workspace root is a Git repository; main/ and dev-docs/ are the repositories"
else
    ok "the workspace root is not a Git repository"
fi

for dir in main dev-docs worktrees scripts; do
    if [ -d "$ws/$dir" ]; then ok "$dir/ exists"; else bad "$dir/ is missing"; fi
done
if [ -f "$ws/AGENTS.md" ]; then ok "AGENTS.md exists"; else bad "AGENTS.md is missing"; fi
if [ -x "$ws/scripts/new-worktree.sh" ]; then
    ok "scripts/new-worktree.sh is executable"
else
    bad "scripts/new-worktree.sh is missing or not executable"
fi

for dir in main dev-docs; do
    top=$(git -C "$ws/$dir" rev-parse --show-toplevel 2>/dev/null) || top=
    if [ -z "$top" ]; then
        bad "$dir/ is not a Git repository"
    elif [ "$(CDPATH= cd -- "$top" 2>/dev/null && pwd -P)" != "$ws/$dir" ]; then
        bad "$dir/ is not its own repository root (Git says $top)"
    # A linked worktree also reports its own directory as its toplevel, so the
    # check above alone would accept main/ or dev-docs/ being a worktree of
    # each other (or of an unrelated repository) rather than an independent
    # one. `.git` as a real directory is what only an independent repository
    # has; a worktree's `.git` is a file pointing elsewhere.
    elif [ ! -d "$ws/$dir/.git" ]; then
        bad "$dir/ is not its own repository: .git is not a directory (it is a worktree, or missing)"
    else
        ok "$dir/ is the root of its own repository"
    fi
done

# A link file is a symlink that resolves to the workspace rulebook. An @ import
# is not a substitute: it is external, needs approval, and Codex and Gemini do
# not read it at all.
check_link() { # path, label
    link=$1 label=$2
    if [ ! -L "$link" ]; then
        bad "$label is not a symlink"
    elif [ ! -e "$link" ]; then
        bad "$label does not resolve (target: $(readlink "$link" 2>/dev/null))"
    # readlink -f compares where the link actually points, not merely whether
    # its content happens to match today: `cmp` would also pass for a
    # different file that is byte-identical right now and free to drift later.
    elif [ "$(readlink -f "$link" 2>/dev/null)" != "$(readlink -f "$ws/AGENTS.md" 2>/dev/null)" ]; then
        bad "$label does not resolve to the workspace AGENTS.md"
    elif head -n 1 "$link" 2>/dev/null | grep -q '^@'; then
        bad "$label begins with an @ import; it must be a symlink"
    else
        ok "$label is a symlink to the rulebook"
    fi
}

check_link "$ws/main/AGENTS.md" "main/AGENTS.md"

for wt in "$ws"/worktrees/*; do
    [ -e "$wt" ] || [ -L "$wt" ] || continue
    label=worktrees/$(basename "$wt")
    if [ ! -d "$wt" ]; then bad "$label is not a directory"; continue; fi
    if [ -f "$wt/.git" ] && [ ! -d "$wt/.git" ]; then
        top=$(git -C "$wt" rev-parse --show-toplevel 2>/dev/null) || top=
        if [ -n "$top" ] && [ "$(CDPATH= cd -- "$top" 2>/dev/null && pwd -P)" = "$wt" ]; then
            # A worktree of ANY repository would pass the check above; this is
            # what ties it specifically to main/ — git-common-dir is the one
            # path every worktree and its source repository agree points at
            # the same shared .git, regardless of which worktree you ask from.
            common=$(git -C "$wt" rev-parse --git-common-dir 2>/dev/null) || common=
            case $common in /*) ;; *) common="$wt/$common" ;; esac
            common_real=$(CDPATH= cd -- "$common" 2>/dev/null && pwd -P) || common_real=
            main_real=$(CDPATH= cd -- "$ws/main/.git" 2>/dev/null && pwd -P) || main_real=
            if [ -n "$common_real" ] && [ "$common_real" = "$main_real" ]; then
                ok "$label is a linked worktree of main/"
            else
                bad "$label is a linked worktree, but not of main/ (git-common-dir: ${common:-unresolved})"
            fi
        else
            bad "$label is not a linked worktree of a repository (Git says ${top:-nothing})"
        fi
    else
        bad "$label has no .git file; a directory there would be a second repository"
    fi
    check_link "$wt/AGENTS.md" "$label/AGENTS.md"
done

# --- ignores ----------------------------------------------------------------

# Each name, at the repository root and one directory down. The probe under
# .codex/ is a name no repository would re-include on purpose, so a deliberate
# '!path' exception for a tracked config file does not mask the check.
probes=
for name in .cc-suite/gate-probe .cc-suite.md .codex/gate-probe CLAUDE.md; do
    probes="$probes $name apps/foo/$name apps/foo/bar/$name"
done

check_repo_ignores() { # repository, label, checkout (yes for main, where the link files live)
    r=$1 label=$2 checkout=$3
    problems=0
    head_ok=0 head_tmp=

    if ! git -C "$r" rev-parse --verify HEAD >/dev/null 2>&1; then
        note "$label has no commit yet; its .gitignore must be in the first one"
    else
        head_ok=1
        # HEAD's own tracked .gitignore files, reconstructed in an isolated
        # directory with no other content. check-ignore against THIS tree is
        # what HEAD actually ignores — a clone would see exactly this. Diffing
        # one matched line's text (the previous approach) cannot catch a
        # negation elsewhere in the same file changing the net verdict for
        # this path, or a line moving and the comparison tracking the wrong one.
        head_tmp=$(mktemp -d) && git -C "$head_tmp" init -q >/dev/null 2>&1
        if [ -n "$head_tmp" ]; then
            git -C "$r" ls-tree -r --name-only HEAD 2>/dev/null | grep -E '(^|/)\.gitignore$' | while IFS= read -r gi; do
                mkdir -p "$head_tmp/$(dirname "$gi")"
                git -C "$r" show "HEAD:$gi" >"$head_tmp/$gi" 2>/dev/null
            done
        fi
    fi

    for probe in $probes; do
        # `-q` (no `-v`) is the one invocation whose exit code is the true
        # ignored/not-ignored verdict. `-v`'s exit status is 0 whenever ANY
        # pattern matched, including a negation (`!pattern`) that makes the
        # net result "not ignored" — relying on that would let a committed
        # `!path` exception pass the probe as ignored when it is explicitly
        # the opposite. `-v` is still used below, but only after `-q` has
        # already confirmed the path really is ignored, to report where from.
        if ! git -C "$r" check-ignore -q --no-index "$probe" 2>/dev/null; then
            bad "$label: $probe is not ignored"
            problems=$((problems + 1))
            continue
        fi
        line=$(git -C "$r" check-ignore -v --no-index "$probe" 2>/dev/null) || line=
        src=$(printf '%s\n' "$line" | awk -F: '{print $1}')
        case $src in
            *.gitignore) ;;
            *)
                bad "$label: $probe is ignored by $src, which does not travel; put the rule in a tracked .gitignore"
                problems=$((problems + 1))
                continue
                ;;
        esac
        # The rule must hold from HEAD's own tracked .gitignore files, not
        # merely from the working tree: the latter looks green here and is
        # missing from every clone.
        if [ "$head_ok" -eq 1 ]; then
            if [ -z "$head_tmp" ] || ! git -C "$head_tmp" check-ignore -q --no-index "$probe" 2>/dev/null; then
                bad "$label: $src ignores $probe only with working-tree changes; HEAD's committed rules do not — commit them"
                problems=$((problems + 1))
            fi
        fi
    done
    [ -n "$head_tmp" ] && rm -rf "$head_tmp"
    [ "$problems" -eq 0 ] && ok "$label: AI tool state is ignored at any depth by tracked .gitignore rules"

    tracked=$(git -C "$r" ls-files 2>/dev/null \
        | grep -E '(^|/)\.cc-suite(/|$)|(^|/)\.cc-suite\.md$|(^|/)\.codex(/|$)|(^|/)CLAUDE\.md$') || tracked=
    if [ -n "$tracked" ]; then
        bad "$label: tracked AI tool files:"
        printf '%s\n' "$tracked" | sed 's/^/       /'
    else
        ok "$label: no tracked AI tool files"
    fi

    if [ "$checkout" = yes ]; then
        # AGENTS.md is the checkout's link to the rulebook. repo-init writes the
        # local exclude in the same step that creates the link, so the local rule
        # is accepted; what must never happen is the link being committed.
        if git -C "$r" ls-files 2>/dev/null | grep -q '^AGENTS\.md$'; then
            bad "$label: AGENTS.md is tracked; the link file belongs outside Git"
        elif git -C "$r" check-ignore -q --no-index AGENTS.md 2>/dev/null; then
            ok "$label: AGENTS.md is ignored"
        else
            bad "$label: AGENTS.md is not ignored"
        fi

        if git -C "$r" ls-files 2>/dev/null | grep -q 'settings\.local\.json$'; then
            bad "$label: a local settings file is tracked"
        elif git -C "$r" check-ignore -q --no-index .claude/settings.local.json 2>/dev/null; then
            ok "$label: .claude/settings.local.json is ignored"
        else
            bad "$label: .claude/settings.local.json is not ignored"
        fi
    fi

    if [ -e "$r/.env" ]; then
        bad "$label: .env is inside the repository; keep it at the workspace root"
    fi
}

for repo in main dev-docs; do
    r="$ws/$repo"
    if git -C "$r" rev-parse --show-toplevel >/dev/null 2>&1; then
        case $repo in
            main) check_repo_ignores "$r" "$repo" yes ;;
            *)    check_repo_ignores "$r" "$repo" no ;;
        esac
    fi
done

# --- result -----------------------------------------------------------------

if [ "$failed" -eq 0 ]; then
    printf 'gate: passed\n'
    exit 0
fi
printf 'gate: %s failed\n' "$failed"
exit 1
