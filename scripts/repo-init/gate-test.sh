#!/bin/sh
# Positive controls for gate.sh — a check that cannot fail is not a check.
#
# Each case builds a throwaway workspace with one defect and requires the gate
# to fail on it, with the message that names the defect. The healthy fixture
# must pass, which also proves the fixture itself is not what makes the red
# cases red.
#
#   gate-test.sh        exits 0 only when every control behaves.
set -u
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
gate=$here/gate.sh
[ -x "$gate" ] || { printf 'gate-test: %s is not executable\n' "$gate" >&2; exit 2; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/repo-init-gate.XXXXXX") || exit 2
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

passed=0
failed=0
pass() { printf 'ok   %s\n' "$*"; passed=$((passed + 1)); }
fail() { printf 'FAIL %s\n' "$*"; failed=$((failed + 1)); }

make_ws() { # directory
    mkdir -p "$1/main" "$1/dev-docs" "$1/worktrees" "$1/scripts"
    printf '# Workspace\n\n- rulebook\n' > "$1/AGENTS.md"
    cat > "$1/main/.gitignore" <<'EOF'
.cc-suite/
.cc-suite.md
.codex/
CLAUDE.md
.claude/settings.local.json
EOF
    cp "$1/main/.gitignore" "$1/dev-docs/.gitignore"
    printf '#!/bin/sh\nexit 0\n' > "$1/scripts/new-worktree.sh"
    chmod +x "$1/scripts/new-worktree.sh"
    for part in main dev-docs; do
        git -C "$1/$part" init -q -b main
        git -C "$1/$part" add .gitignore
        git -C "$1/$part" -c user.name=gate -c user.email=gate@example.invalid commit -q -m Initial
    done
    printf 'AGENTS.md\n.claude/settings.local.json\n' >> "$1/main/.git/info/exclude"
    ln -s ../AGENTS.md "$1/main/AGENTS.md"
}

run_case() { # name expected(pass|fail) pattern workspace
    name=$1 want=$2 pattern=$3 ws=$4
    out=$("$gate" "$ws" 2>&1)
    status=$?
    if [ "$want" = pass ]; then
        if [ "$status" -eq 0 ]; then pass "$name"
        else fail "$name (gate exited $status)"; printf '%s\n' "$out" | sed 's/^/     /'
        fi
        return
    fi
    if [ "$status" -eq 0 ]; then fail "$name (gate passed)"; return; fi
    if [ -n "$pattern" ] && ! printf '%s\n' "$out" | grep -q "$pattern"; then
        fail "$name (no '$pattern' in the failure)"
        printf '%s\n' "$out" | sed 's/^/     /'
        return
    fi
    pass "$name"
}

ws=$tmp/healthy
make_ws "$ws"
run_case "healthy layout passes" pass '' "$ws"

ws=$tmp/worktree
make_ws "$ws"
git -C "$ws/main" worktree add -q "$ws/worktrees/one" -b one
ln -s ../../AGENTS.md "$ws/worktrees/one/AGENTS.md"
run_case "a linked worktree with a symlinked rulebook passes" pass '' "$ws"

ws=$tmp/worktree-import
make_ws "$ws"
git -C "$ws/main" worktree add -q "$ws/worktrees/one" -b one
printf '@../../AGENTS.md\n' > "$ws/worktrees/one/AGENTS.md"
run_case "a worktree with an @ import is red" fail 'is not a symlink' "$ws"

ws=$tmp/worktree-unrelated
make_ws "$ws"
other=$tmp/other-repo
mkdir -p "$other"
git -C "$other" init -q -b main
git -C "$other" -c user.name=gate -c user.email=gate@example.invalid commit -q -m Initial --allow-empty
git -C "$other" worktree add -q "$ws/worktrees/one" -b one
ln -s ../../AGENTS.md "$ws/worktrees/one/AGENTS.md"
run_case "a worktree of an unrelated repository is red, not a false pass" fail 'not of main/' "$ws"

ws=$tmp/anchored
make_ws "$ws"
cat > "$ws/main/.gitignore" <<'EOF'
/.cc-suite/
/.cc-suite.md
/.codex/
/CLAUDE.md
.claude/settings.local.json
EOF
run_case "root-anchored rules are red on a subdirectory copy" fail 'not ignored' "$ws"

ws=$tmp/negated
make_ws "$ws"
printf '!CLAUDE.md\n' >> "$ws/main/.gitignore"
git -C "$ws/main" add .gitignore
git -C "$ws/main" -c user.name=gate -c user.email=gate@example.invalid commit -q -m 'Negate CLAUDE.md (regression fixture)'
run_case "a committed negation is red, not a false pass" fail 'CLAUDE.md is not ignored' "$ws"

ws=$tmp/exclude-only
make_ws "$ws"
: > "$ws/main/.gitignore"
printf '.cc-suite/\n.cc-suite.md\n.codex/\nCLAUDE.md\n' >> "$ws/main/.git/info/exclude"
run_case ".git/info/exclude alone is red: it does not travel" fail 'does not travel' "$ws"

ws=$tmp/tracked
make_ws "$ws"
mkdir -p "$ws/main/.cc-suite/audits"
printf 'state\n' > "$ws/main/.cc-suite/audits/run.md"
git -C "$ws/main" add -f .cc-suite/audits/run.md
git -C "$ws/main" -c user.name=gate -c user.email=gate@example.invalid commit -q -m 'Commit tool state'
run_case "a tracked .cc-suite file is red" fail 'tracked AI tool files' "$ws"

ws=$tmp/untracked-ignore
make_ws "$ws"
git -C "$ws/main" rm --cached -q .gitignore
git -C "$ws/main" -c user.name=gate -c user.email=gate@example.invalid commit -q -m 'Drop the ignore from the index'
run_case "an untracked .gitignore is red" fail 'committed rules do not' "$ws"

ws=$tmp/uncommitted-rule
make_ws "$ws"
# HEAD is committed without the CLAUDE.md rule; the working tree then adds it
# back uncommitted, so the working tree protects CLAUDE.md but a fresh clone
# of HEAD would not — exactly the gap this check exists to catch. (A comment
# added above unchanged rules, tried here before, changes no actual ignore
# behavior and the gate correctly has nothing to say about it.)
git -C "$ws/main" rm -q .gitignore
printf '.cc-suite/\n.cc-suite.md\n.codex/\n.claude/settings.local.json\n' > "$ws/main/.gitignore"
git -C "$ws/main" add .gitignore
git -C "$ws/main" -c user.name=gate -c user.email=gate@example.invalid commit -q -m 'Commit without the CLAUDE.md rule'
printf 'CLAUDE.md\n' >> "$ws/main/.gitignore"
run_case "a rule added but not committed is red" fail 'committed rules do not' "$ws"

ws=$tmp/root-repo
make_ws "$ws"
git -C "$ws" init -q
run_case "a repository at the workspace root is red" fail 'workspace root is a Git repository' "$ws"

ws=$tmp/broken-link
make_ws "$ws"
ln -sfn ../AGENTS-missing.md "$ws/main/AGENTS.md"
run_case "a link that does not resolve is red" fail 'does not resolve' "$ws"

ws=$tmp/import-link
make_ws "$ws"
rm "$ws/main/AGENTS.md"
printf '@../AGENTS.md\n' > "$ws/main/AGENTS.md"
run_case "an @ import in place of the symlink is red" fail 'is not a symlink' "$ws"

ws=$tmp/no-dev-docs
make_ws "$ws"
rm -rf "$ws/dev-docs"
run_case "a missing dev-docs is red" fail 'dev-docs/ is missing' "$ws"

printf 'gate-test: %s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
