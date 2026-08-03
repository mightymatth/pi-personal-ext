---
description: Check out and independently review a GitHub PR locally with GitHub CLI
argument-hint: "<PR URL or number>"
---
Perform a standalone, local-first review of GitHub PR `$1`. Do not use subagents.

Use `gh` as the primary interface for GitHub: resolving PR/repository data, cloning, PR checkout, API data, checks, reviews, and comments. Use `git` only for local repository state, diffs, history, and validation. Do not post GitHub comments or submit a review.

## Resolve and inspect PR data first

Resolve the PR before creating or changing a local checkout. Collect title, author, base/head refs and OIDs, description, commits, changed files, check results, reviews, and review comments with `gh`. Derive `OWNER_REPO` and `PR_NUMBER` from the resolved PR URL—not assumptions from the input—and use them consistently.

**Execution discipline:** make each `gh`/`git` operation visible as an individual command/tool call; do not wrap the workflow in an opaque shell script or use shell variables merely to orchestrate commands. Run all dependency-independent calls concurrently. Preserve ordering only where one operation consumes another's output.

1. Run `gh pr view "$1" --json url,number,title,author,baseRefName,baseRefOid,headRefName,headRefOid,body,commits,files,statusCheckRollup,reviews` first.
2. From its resolved `url` and `number`, derive `OWNER_REPO` and `PR_NUMBER`.
3. Then run these concurrently: `gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/comments" --paginate`, `gh pr view "$PR_URL" --comments`, `gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/reviews" --paginate`, and local-checkout existence/origin inspection. If no checkout exists, clone in this concurrent group with `gh repo clone "$OWNER_REPO" "$CHECKOUT"`.

Read the complete outputs; `gh pr view --comments` is supplemental and does not replace fetching inline review comments through the API.

## Prepare the exact checkout

Use exactly `/tmp/<repository-name>-<pr-number>`, where `repository-name` is the repository component of `OWNER_REPO`.

- If it does not exist, clone with `gh repo clone "$OWNER_REPO" "$CHECKOUT"`.
- If it exists, verify its `origin` identifies `OWNER_REPO` (accept equivalent HTTPS or SSH remote URL forms). Stop on a mismatch; never reuse an unrelated checkout.
- Warn immediately before the following commands: they intentionally discard all local modifications and untracked files in that checkout.

```bash
git reset --hard
git clean -fd
git fetch origin --prune
gh pr checkout "$PR_NUMBER" --repo "$OWNER_REPO" --detach
test "$(git rev-parse HEAD)" = "$(gh pr view "$PR_NUMBER" --repo "$OWNER_REPO" --json headRefOid --jq .headRefOid)"
git status --short --branch
```

`gh pr checkout --detach` is intentional: the review is pinned to the PR head commit without creating or updating a local feature branch. If it fails because a merged/closed PR's head branch was deleted, fetch the immutable pull-request head ref and detach at it:

```bash
git fetch origin "refs/pull/$PR_NUMBER/head"
git checkout --detach FETCH_HEAD
test "$(git rev-parse HEAD)" = "$(gh pr view "$PR_NUMBER" --repo "$OWNER_REPO" --json headRefOid --jq .headRefOid)"
git status --short --branch
```

Use this fallback only after `gh pr checkout --detach` fails for an unavailable head ref; do not silently substitute another commit. Do not use `git pull` to update a detached `HEAD`; rerun checkout/fetch and verify `headRefOid` instead. Do not modify source files, commit, push, rebase, force-update, or otherwise mutate remote state.

## Review procedure

Parallelize independent read-only inspection where it improves speed. After the checkout is pinned, inspect the complete merge-base diff, commit log, package scripts/test configuration, and every changed file; trace outward only as far as needed to verify behavior changed by the PR. Repository-wide searching is for locating direct consumers and contracts, not for collecting loosely related concerns. Run validations concurrently only when they cannot contend for mutable build artifacts.

There is no finding quota. A clean **No findings** result is better than weak, speculative, or policy-based criticism.

1. Read the PR description, complete diff, commits, existing reviews, inline review comments, and check results. Do not infer intent from the title alone.
2. In the checkout, inspect the complete merge-base diff and every changed file. Then trace only directly relevant callers, types, tests, configuration, and error paths:
   ```bash
   git diff --find-renames "origin/<base>...HEAD"
   git log --oneline "origin/<base>..HEAD"
   ```
   Do not truncate the diff. If `origin/<base>` is unavailable, use the immutable `baseRefOid` resolved from the PR rather than fetching or guessing another base.
3. Identify the smallest relevant non-destructive repository validation commands from package scripts, test configuration, and changed-test proximity. Run them when dependencies/tooling are already available. Do not install dependencies unless explicitly asked. State the exact command, result, and reason for anything that could not run.
4. Assess only risks that are concretely connected to the diff. Do not expand into unrelated scripts or generic security/observability/test checklists merely to appear comprehensive. Existing approval or green checks are evidence, not a substitute for review.

## Finding admission bar

A review finding is a claimed defect, not a brainstorming prompt. Include one only when all of these are established:

1. **Introduced or materially exposed by this PR** — identify the changed line and causal connection. Do not report unrelated pre-existing behavior.
2. **Expected behavior is evidenced** — ground it in the PR description, an explicit contract/specification, tests, schema/API guarantees, or a clearly established invariant. Similar handling elsewhere is useful context but does not prove that behavior should be identical.
3. **Concrete failing path** — describe a reachable input and trace the actual control/data flow. Do not claim retries, DLQ accumulation, persistence failures, compatibility breakage, or user impact without verifying the relevant machinery.
4. **Actionable correction** — the requested change follows directly from the demonstrated defect rather than from personal preference.

If any part is uncertain, do not promote it to a finding. Put it under **Open questions** with the missing fact stated explicitly, or omit it when it does not help review the PR. Never answer a product-policy question by inference. In particular, a sibling special case (for example, press embargo handling) is not evidence that a new case (for example, pre-production handling) must share its policy.

Use severity conservatively:

- **P0/P1** only for demonstrated release-blocking, data-loss, security, or broadly broken production behavior.
- **P2** for a demonstrated functional defect affecting a narrower path.
- **P3** for a concrete low-impact defect worth fixing.

Do not assign severity to speculation, missing context, optional hardening, or test suggestions. A type assertion or widened union is not itself a defect; prove a bad runtime result at an actual caller before reporting it.

Before finalizing each finding, try to disprove it by rereading the relevant diff, caller, tests, and contract. Remove it if the evidence supports multiple plausible policies.

## Start the review conversation

Present evidence before conclusions, in this order:

1. **PR facts** — resolved repository/PR, base and head OIDs, checkout verification, changed-file count, review/check status.
2. **Intent and scope** — plain technical description grounded in the PR body and diff.
3. **Change map** — concise mapping of each changed area to its role.
4. **Validation evidence** — exact commands executed and outcomes; clearly separate successful checks, failed checks, and checks not run. Do not present unexecuted commands as validation results.
5. **Findings** — only items meeting the admission bar, ordered by severity. Every finding must include severity, exact `path:line`, evidence, concrete failing path/impact, and requested change. Explicitly say **No findings** when none qualify.
6. **Open questions** — only unresolved facts that materially affect correctness. Label these as non-findings and do not imply a preferred product decision without evidence.

Keep the report concise. Do not pad it with a generic verification plan, discussion prompts, hypothetical risks, or an offer to inspect more files unless the user asks.
