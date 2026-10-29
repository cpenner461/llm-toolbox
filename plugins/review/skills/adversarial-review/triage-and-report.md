# Triage and report

Reviewers were told to be adversarial, so expect some findings to be wrong. Your job in triage is to be equally hard on them: a finding gets accepted because you confirmed it, not because a reviewer sounded sure.

## Merge and dedupe

Put every finding from every reviewer in one list. Two findings are duplicates when they describe the same underlying defect, even if they point at different lines or propose different fixes (for example, a missing check reported at the call site by one reviewer and at the helper by another). Merge duplicates into one entry that keeps all source ids (`C2 + X1`) and the strongest evidence and repro among them.

Agreement between reviewers is a signal, especially across model families, and worth noting in the table. It is not proof: two reviewers can share a misreading. A finding raised by only one reviewer is not weaker for it; the reviewers have different lenses on purpose.

Use the highest severity that the evidence supports. If you think a reviewer over- or under-rated something, change it and say why in the reason.

## Verify, then decide

For each merged finding, check it against the code before deciding:

- Read the code at the cited location and enough around it to know whether the claim holds.
- If there is a repro, run it (from a scratch location outside the repo). If there is none and the claim is cheap to test, test it.
- For "this test does not test its claim" findings, read the test and ask whether it would still pass if the behaviour were broken.
- For spec-deviation findings, re-read the spec text itself rather than relying on the reviewer's quote.

Then record one decision with a one-line reason:

- **accept**: confirmed real and in scope; it will be fixed now.
- **reject**: wrong (misread code, repro does not reproduce, the spec allows it), or not worth changing (style, speculative). Say which.
- **defer**: real, but fixing it here is the wrong call: out of scope for this change, needs a product decision, or is a larger refactor. Say what it would take.

When a decision depends on what the user wants (an ambiguous spec, a trade-off with no clear winner), defer it and surface it in the report rather than choosing silently.

Keep the triage record in `$WORKDIR/triage.md` as you go: one line per finding with id(s), title, severity, decision, and reason.

## Report

End the session's response with the report, and save the same text to `$WORKDIR/report.md`. Keep it concise.

The summary table is required, even if you otherwise prefer prose: it is the decision record the user asked for, one row per merged finding, and it is what they scan to check your triage. Do not restate its rows in prose; the sentences around it should only add what a table can't hold.

Start with a mode line, for example `Mode: deep, report-only · correctness=fable, design=opus, codex=effort high · scope main@9b5c2b1 → tree aabff6b`. Two runs on the same code show the same scope, which is how the user knows the comparison is fair.

Then one or two sentences: which reviewers ran (and why any were skipped), how many findings came in, and the headline.

Then the summary table, most severe first:

| ID | Finding | Source(s) | Severity | Decision | Reason |
|----|---------|-----------|----------|----------|--------|
| C1+X2 | Page 1 skips the first page of results | correctness, codex | high | accept | Reproduced: page=1 returns rows 21-40 |
| D3 | Extract a helper for the SQL ordering clause | design | low | reject | Style preference; one call site |

After the table, in short paragraphs: the fixes made (what changed and where, tests added or corrected, and the test suite result); the verification outcome (which fixes the fresh reviewer confirmed, anything new it found and what you did, and which fixes nobody independently re-checked); anything deferred or unresolved, with what it would take or the decision needed from the user (say "none" if there is nothing); and the work directory path.
