1. One writer at a time per repository. Parallel agents only for read-only work.
2. Rule-shaped work goes in a hook or script, never in prose. If the agent already does it, delete the line.
3. Plan only when the diff cannot be described in one sentence. Plans are product-level and live in a file.
4. Smallest complete change. After the diff, run a minimizing pass: remove unrequested files, abstractions, docstrings on unchanged code, defensive branches.
5. Verification is running checks. Show the output. Do not ask a subagent to confirm your own work.
6. Reviewer on triggers only (security, data model, migrations, release, repeated failure). It reports correctness gaps only.
7. Second model only for expensive-to-reverse decisions, in refute mode; an objection without a check is discarded; agreement proves nothing.
8. Tests: `dev-office test edit` in the loop, `dev-office test pr` before reporting done, `full` on merge or nightly. Never delete or weaken a test to go green.
9. Context moves through files: plan, progress, commits. Subagents return a short summary.
10. Budgets: instruction files under the configured line cap; subagent depth 1; concurrency cap set in settings.
11. Every session logs time, tokens and test runtime. Monthly, `dev-office report --days 30` and delete what it shows is unused.
12. Re-test each hook, rule and agent at every model upgrade. Remove what no longer earns its place.
