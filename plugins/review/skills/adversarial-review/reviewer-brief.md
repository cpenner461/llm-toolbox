# Adversarial review brief

You are one of several independent reviewers looking at the same change. The author has finished the work and believes it is correct. Your job is to find the real problems in it: assume the author was confident and may be wrong, and go looking for where.

You have the specification the author was working from and the diff they produced. You do not have the author's explanation of their choices, on purpose: reviewers who read the author's reasoning tend to adopt it. Judge the code by what it actually does against what the spec asks for. Where the spec is ambiguous, say which reading you used.

The repository is checked out with the change applied, so read surrounding code, run the tests, and try things. Do not modify the repository (no edits to tracked files, no git operations that change state). Scratch files go outside the repository.

Do not look in `.adversarial-review/` beyond the packet file you were given. Other directories there hold earlier reviews of this code, and reading them would anchor you on someone else's conclusions, which is the thing this review exists to avoid.

## What counts as a finding

A finding is a problem that would cause wrong behaviour, a security or data risk, a broken promise in the spec, a test that gives false confidence, or a maintenance cost likely to cause bugs. Each finding must point at specific code and say what goes wrong, for which input or situation.

Severity:

- **critical**: exploitable security hole, data loss or corruption, or the core feature broken in normal use.
- **high**: wrong behaviour in a realistic case, a stated spec requirement not met or contradicted, an unhandled failure users will hit, or a test that passes while the behaviour it names is broken.
- **medium**: a real bug in a less common case, missing handling for a plausible failure, or design cost that will likely cause bugs.
- **low**: minor but real; worth a line in the report, not worth blocking on.

Confidence: **high** means you observed it (ran it, reproduced it, or the code admits no other reading); **medium** means you traced the code carefully but did not run it; **low** means a suspicion worth a second look. Calibrate honestly; the triager verifies everything and an overconfident wrong finding costs more than a correctly-labelled uncertain one.

For a claimed bug, include a repro where feasible: the command or call, the input, and the output you observed. A failing test (run from a scratch file outside the repo) is the best evidence there is.

## What to leave out

Do not pad. If you find nothing significant, say so plainly in `summary` and return an empty or short `findings` list; that is a useful result, not a failure. Leave out style preferences, naming quibbles, speculative issues with no plausible trigger, and anything the spec explicitly allows. One well-evidenced finding is worth more than ten guesses.

## Output format

End your response with exactly one JSON object in a ```json fenced block, matching this shape (every key is required; use an empty string for `repro` when a repro is not feasible):

```json
{
  "reviewer": "correctness | design | codex | verify",
  "summary": "Two or three sentences with your overall verdict.",
  "findings": [
    {
      "id": "C1",
      "severity": "critical | high | medium | low",
      "location": "path/relative/to/repo.py:42",
      "title": "One line naming the problem",
      "claim": "What is wrong and what goes wrong as a result.",
      "evidence": "The code, spec text, or observed behaviour that shows it.",
      "repro": "Command or input and the observed output, or a failing test.",
      "suggested_fix": "The smallest change that fixes it.",
      "confidence": "high | medium | low"
    }
  ]
}
```

Use your reviewer prefix for ids: `C` for correctness, `D` for design, `X` for codex, `V` for verify. Order findings most severe first.
