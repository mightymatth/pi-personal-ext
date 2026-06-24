---
name: selfreview
description: "Review local changes before finalizing, committing, pushing, or opening/updating a PR. Use for self-review, pre-commit review, PR review, or second-pass review requests."
---

# Self Review

Perform a focused code review of changes before finalizing work.

Use when:

- the user asks for self-review, autoreview, pre-commit review, PR review, or a second pass
- after non-trivial code edits, before final response/commit/push/PR
- reviewing a local branch, open PR, staged/unstaged changes, or a specific commit

## Principles

- Treat review findings as advisory; verify every finding against the actual code.
- Review the smallest relevant diff, but read surrounding code before judging correctness.
- Prioritize correctness, regressions, security, data loss, concurrency, error handling, and test gaps.
- Reject speculative issues, unrealistic edge cases, stylistic churn, and broad rewrites.
- Prefer small fixes at the right ownership boundary.
- If a review-triggered fix changes code, rerun focused tests/checks and review the changed diff again.
- Do not push, commit, or post PR comments unless the user explicitly asks.

## Pick the Review Target

Inspect repository state first:

```bash
git status --short --branch
```

Uncommitted local work:

```bash
git diff -- .
git diff --staged -- .
```

Current branch against its upstream/base:

```bash
git branch --show-current
git merge-base HEAD origin/main
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- .
```

If an open GitHub PR exists, use its actual base and read the title/body for intent and review context:

```bash
gh pr view --json number,title,body,baseRefName,headRefName --jq '{number,title,body,baseRefName,headRefName}'
base=$(gh pr view --json baseRefName --jq .baseRefName)
git fetch origin "$base"
git diff "origin/$base"...HEAD -- .
```

Specific commit:

```bash
git show --stat --oneline HEAD
git show --find-renames --find-copies HEAD -- .
```

## Review Checklist

For each changed area, check:

- correctness: logic, edge cases, invariants, API contracts
- regressions: behavior changed unintentionally, backwards compatibility
- errors: exception paths, failed I/O/network calls, retries/timeouts, cleanup
- data: migrations, serialization, validation, null/undefined handling
- concurrency: races, ordering, cancellation, idempotency
- security: injection, authz/authn, secret handling, unsafe file/process/network use
- tests: missing coverage for new behavior or fixed bug class
- maintainability: unnecessary complexity only when it creates real risk

## Reporting Format

Report only actionable findings. For each finding include:

```text
[P1|P2|P3] Title
File: path/to/file:line
Why: concrete failure mode
Fix: minimal recommended change
```

Priority guidance:

- `P1`: likely breakage, security issue, data loss, or severe regression
- `P2`: real bug or important missing test with plausible user impact
- `P3`: low-risk correctness/maintainability issue worth fixing

If no actionable findings remain, say:

```text
selfreview clean: no actionable findings
```

Final response should include:

- review target used
- tests/checks run
- findings accepted/fixed or consciously rejected
- remaining risk, if any
