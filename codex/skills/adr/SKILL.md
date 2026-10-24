---
name: adr
description: "Architecture decision records: create a one-page MADR record, list records, or send one to Codex in refute mode. Use for decisions that are expensive to reverse: architecture, data model, security boundary, dependency choice, lasting trade-offs. Not for routine choices."
---

# ADR

<example>
Context: A decision to switch the storage engine is expensive to reverse later.
user: "Record that we're moving from SQLite to Postgres and why."
assistant: "I'll run `dev-office adr new 'Move to Postgres'`, fill in Context, Decision and Consequences, then offer to send it to Codex in refute mode."
</example>

- New record: `dev-office adr new <title>`. It prints the path (sibling `dev-docs/adr/` in a split workspace, else `docs/adr/`). Fill Context, Decision and Consequences in under a page. Options considered go in Context as one line each.
- Second opinion: `dev-office adr refute <file>`. It runs the Codex CLI in refute mode and appends the output. Then report in three lines: what survived, what you overruled and on what evidence, what remains unchecked. Discard objections that carry no check; one objection whose check actually fails blocks the decision.
- List: `dev-office adr list`.
- A record is never edited after acceptance. A change of mind is a new record whose Status line reads `supersedes NNNN`, and the old one gets `superseded by NNNN`.

If `codex` is not on PATH the command exits 3 and says no second opinion was taken. Do not substitute self-review for it; say so in the report.

Scope: records the decision and its refutation only. It does not run tests, release anything, or touch the repository layout — see `release` and `repo-init` for those.
