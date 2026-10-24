---
name: release
description: "Cut a release: preflight (clean tree, default branch, not behind upstream, tag free, changelog section present), full test tier, annotated tag, optional push. Use when asked to release, tag a version, or ship. Never pushes unless told to."
---

# Release

<example>
Context: The working tree is clean and ready to ship a bug fix.
user: "Cut v1.2.1."
assistant: "I'll confirm the version, check the changelog has a 1.2.1 section, then run `dev-office release 1.2.1` and quote its preflight and test output before tagging."
</example>

1. Confirm the version with the user if the request did not name one. Semver only.
2. If `CHANGELOG.md` exists, make sure it has a `## <version>` section; write the entry from the commits since the last tag if it is missing, in the repository's existing style, and let the user see it before tagging.
3. Run `dev-office release <version>`. It refuses on any preflight problem, runs `dev-office test full`, then creates the tag from a message file. Quote its output.
4. Push only when the user asks: `dev-office release <version> --push`, or the two `git push` lines it prints. CI owns publishing from the tag (release-please, GoReleaser, the homebrew tap workflow, npm trusted publishing), not this skill.
5. `--skip-tests` exists for a hotfix with a documented reason; the tag message records that it was used.

Before any push, inspect the diff since the last tag for secrets and run the secret-scan docket if one is configured.

Scope: preflight, tag and (if asked) push only. It does not publish artifacts itself and does not record the decision behind a release — see `adr` for that.
