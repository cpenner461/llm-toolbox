---
name: adversarial-review
description: Run an adversarial multi-reviewer review of finished work. Independent reviewers (a Claude correctness reviewer, a Claude design/risk reviewer on a different model, and Codex) see only the spec and the diff, never the builder's reasoning; the main session then triages every finding, applies accepted fixes, and runs one fresh verification pass. Supports a deep mode (stronger reviewer models) and a report-only mode (findings and triage, no fixes). Use only when the user explicitly asks for an adversarial, independent, second-opinion, cross-model, or multi-reviewer review (e.g. "run an adversarial review", "run a deep adversarial review, report only", "get independent reviewers on this branch", "have Codex and Claude both review this"). Do not use for an ordinary "review this", a quick look at a diff, or PR comment review.
argument-hint: "[deep] [report-only] [base-ref | A..B] [spec file, issue, or URL]"
---

# Adversarial review

You are the orchestrator. Reviewers find problems; you scope the work, triage what they report, apply fixes, and report. Reviewers never edit code.

The whole design rests on one idea: reviewers get the **spec and the diff**, never the builder session's narrative. If a reviewer reads why the author made a choice, it tends to agree with the choice. So everything you hand a reviewer must be the requirements as the user stated them, plus the code. Keep your own summaries, rationale, and "I chose X because" out of it, even when you were the builder.

Supporting files live in `${CLAUDE_SKILL_DIR}`: `reviewer-brief.md` (shared framing and findings format), `codex-focus.md`, `verification-brief.md`, `triage-and-report.md`, `findings.schema.json`, `config.env` (deep-mode models and Codex settings), and `scripts/`.

## Modes

Two options, independent of each other. Take them from the arguments or from the user's wording.

**Deep** (`deep`, or words like "in-depth", "thorough", "use Fable"): reviewers run on stronger models for this run only. Read the deep settings with `grep '^REVIEW_DEEP_' "${CLAUDE_SKILL_DIR}/config.env"` and pass them as the `model` parameter when you dispatch each Claude reviewer; the verification reviewer gets the correctness model. Run Codex with `--deep`. If the user names models, use theirs instead. If a dispatch fails because a model is unavailable, re-dispatch that reviewer without the override and say so in the report. Without deep mode, pass no `model`: the agents' pinned defaults apply.

**Report-only** (`report-only`, or words like "findings only", "don't fix", "dry run", "no changes"): do steps 1, 2, 3 and 6, and skip fixing and verification. Do not edit any file outside the work directory. In triage, **accept** then means "confirmed, and I would fix it".

Each run has its own work directory, so the user can run a standard and a deep review on the same code and compare them. When an earlier review of this code already happened in this session, keep the runs independent: do not put earlier findings or decisions into this run's spec, prompts, or packet, and triage this run's findings on their own evidence. Compare runs only when the user asks.

Record the mode, the models used, and the scope (`base_sha`, `head_tree` from scope output) in `$WORKDIR/mode.txt`.

## 1. Scope

Run from inside the repository:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/scope.sh" range [REF]
```

With no argument it reviews merge-base(default branch, HEAD) through the working tree, including uncommitted and untracked files. Pass a ref the user names as the base, or an explicit `A..B` range to review only those commits. It prints `workdir=...` (a per-run directory under `.adversarial-review/`, git-excluded) plus the base, head, and size. Exit 4 means the diff is empty: tell the user and ask what to review rather than guessing.

Now find the spec and write it to `$WORKDIR/spec.md`. In order of preference:

1. A spec, plan, or issue the user named when invoking the review.
2. The user's original request in this conversation. Quote their words verbatim, including later messages where they added or changed requirements. Do not paraphrase into your own framing.
3. An issue referenced by the user, the branch name, or `$WORKDIR/commits.txt` (fetch with `gh issue view` if available).
4. A plan or spec file in the repo that matches the work (look in places like `docs/`, `specs/`, `plans/`, `PLAN.md`).

Leave out anything that is the builder's account rather than the requirement: implementation summaries, design rationale, known-limitation notes, test results, commit message bodies. If you cannot find a spec, ask the user for one in a single question. Do not reconstruct a spec from the diff; that just tells reviewers the code is what was wanted.

Note the source at the top of `spec.md` (for example `Source: docs/specs/foo.md` or `Source: user request in session`). Then build the packet every reviewer reads:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/scope.sh" packet "$WORKDIR"
```

## 2. Dispatch reviewers in parallel

In a single message, start all three so they run concurrently:

- **Agent** with `subagent_type: "review:adversarial-reviewer-correctness"` (plus `model` in deep mode).
- **Agent** with `subagent_type: "review:adversarial-reviewer-design"` (plus `model` in deep mode).
- **Bash** with `run_in_background: true`: `bash "${CLAUDE_SKILL_DIR}/scripts/codex-review.sh" [--deep] "$WORKDIR"`.

Give each Claude reviewer this prompt, and nothing more about the work:

> Read `<WORKDIR>/packet.md` in full (page through it if it is long). It contains your brief, the specification, and the diff under review. The repository at `<REPO>` has the change applied. Review it through your lens and finish with the JSON findings block the brief describes. Use reviewer name `<correctness|design>`.

The agents pin their own models (opus and sonnet by default), and their tools are read-only. If the `review:` agent types are unavailable (for example the skill was copied out of its plugin), use `general-purpose` agents, paste the body of the matching file from the plugin's `agents/` directory at the top of the prompt, and pass `model` to keep the two reviewers on different models.

If the Codex script exits 3 it was skipped; record its one-line reason for the report and carry on with two reviewers. Any other non-zero exit is a failure: note it, glance at `codex.log`, and carry on. On success its findings are in `$WORKDIR/codex-findings.json`.

As each Claude reviewer's result arrives, save its JSON block to `$WORKDIR/<reviewer>-findings.json` exactly as returned. Do not condense or rewrite it: the file is the audit record of what each reviewer actually claimed, separate from your triage of it.

## 3. Triage

Wait for all reviewers, then follow `${CLAUDE_SKILL_DIR}/triage-and-report.md`. In short: merge and dedupe across reviewers, noting agreement; verify every finding against the code before deciding; record **accept / reject / defer** with a one-line reason for each. Nothing gets applied because a reviewer said so.

In report-only mode, go straight to step 6 after triage.

## 4. Fix

Before touching code, record a snapshot of the working tree so the fix diff can be isolated:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/scope.sh" snapshot   # prints PRE_FIX_TREE
```

Apply the accepted fixes. Where a finding was a bug, add or correct a test that would have caught it; where a finding was a test that did not test its claim, fix the test so it does. Run the test suite. Leave the changes uncommitted unless the user asked otherwise.

## 5. Verification pass

Write `$WORKDIR/accepted.md`: for each accepted finding, its id, title, location, the claim, and the fix you intended, in a few lines. State what the fix is; do not argue for it. Then:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/scope.sh" fixdiff "$PRE_FIX_TREE" "$WORKDIR"
```

Dispatch **one fresh** `review:adversarial-reviewer-correctness` agent (a new instance, not a continuation of a round-1 reviewer; in deep mode pass the deep correctness model) with:

> Read `<WORKDIR>/verify-packet.md` in full. It contains your brief, the specification, the accepted findings, and the fix diff. The repository at `<REPO>` has the fixes applied. Finish with the JSON block the brief describes.

Save its JSON block verbatim to `$WORKDIR/verify-findings.json`, then triage it the same way. If it reports a fix as not or partially fixed, or a new critical/high problem, you may fix it if the fix is clear and you can verify it yourself, but do not dispatch another reviewer: one verification round is the limit. Anything still open goes to the user in the report as unresolved. Stop looping when no critical or high findings remain or the round is spent.

## 6. Report

End with the report described in `triage-and-report.md`: the mode line, a summary table (finding, source reviewer(s), severity, decision, reason), the fixes made, the verification outcome, and anything deferred or unresolved. In report-only mode, leave out fixes and verification and say that no code was changed.

Write the same report to `$WORKDIR/report.md`, then show it in your response. The file is what the user opens later to read or compare runs, so it must stand alone: the full report, not a summary or a pointer to the chat. Mention the work directory at the end.
