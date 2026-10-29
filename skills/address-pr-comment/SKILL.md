---
name: address-pr-comment
description: "Address a GitHub PR review comment end-to-end: fetch it, analyze in codebase context, propose a fix, and after approval implement, validate, commit, push, and reply. Use this skill whenever the user pastes a GitHub PR comment URL (containing #discussion_r), mentions a PR review comment, or asks to handle/fix/address a reviewer's feedback. Even if the user just drops a link without further instructions, this skill applies. Also triggers when the user pastes multiple comment URLs or asks to address all comments on a PR."
---

## Important

Never run Bash commands in background mode (`run_in_background`). Every command must run in the foreground so you can read its output immediately and proceed sequentially.

## Input

One or more GitHub PR review comment URLs like `https://github.com/org/repo/pull/123#discussion_r123456789`. The comment ID is the number after `discussion_r`.

Accepted input formats:

- A single comment URL
- Multiple comment URLs (handle them in sequence)
- Just a comment ID number
- A PR URL with instructions like "address all comments" — in that case, fetch all pending review comments on the PR first

## Workflow

### 1. Fetch the comment (and its thread)

Extract the comment ID from the URL and fetch it:

```
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}
```

From the response, extract: `body` (reviewer's text), `path` (file), `line`/`original_line` (location), `user.login` (reviewer), `pull_request_url` (to derive the PR number for replies).

**Check for thread context.** The comment might be part of a conversation — the reviewer may have added clarifications in replies, or there may be a back-and-forth that changes what's being asked. Fetch the review thread to see the full picture:

Use the fetched comment's `in_reply_to_id` as `root_id`, or its own `id` if it is the root. Fetch every page, then select the root and its replies in chronological order:

```bash
gh api --paginate --slurp repos/{owner}/{repo}/pulls/{pr_number}/comments \
  | jq --argjson root {root_id} 'add | map(select(.id == $root or .in_reply_to_id == $root)) | sort_by(.created_at)'
```

Read the entire thread — the latest reply often contains the most specific ask. Use `root_id` when posting a reply. Also paginate when fetching all PR comments.

### 2. Read and understand context

Before editing, check `git status --short` and confirm the current branch matches the PR head branch. If it does not, stop and ask how to proceed; do not switch branches automatically. Preserve existing user changes and ask before editing overlapping changes.

Read the commented file to understand the full picture — not just the line, but the surrounding logic. If the comment references other files, types, or functions, read those too. The goal is to understand the reviewer's intent in context, not just in isolation.

### 3. Classify and present

First, classify what kind of comment this is — this determines the workflow path:

**A) Change request** — the reviewer wants code modified. Present:

- **What the reviewer wants** — restate the request in concrete terms
- **Your assessment** — is the comment valid? Is there a better alternative?
- **Proposed solution(s)** — with brief code snippets. If there are multiple valid approaches, list them with tradeoffs.
- **If ambiguous** — explain the different possible interpretations

**B) Question** — the reviewer is asking for clarification, not a code change. Present:

- **What they're asking** — restate the question
- **Draft reply** — a concise answer based on your understanding of the code
- Skip to step 7 (no code changes needed, just reply)

**C) Nit / style suggestion** — minor formatting or naming preference. Present:

- The change briefly
- Whether you agree it's an improvement
- Can often be accepted without much discussion

### 4. Ask for input

Ask the user how to proceed. They might:

- Approve one of the proposed solutions
- Ask to push back on the reviewer instead (help draft a reply and skip to the reply step)
- Request adjustments to the approach
- Say "just do it" for nits — in which case, implement immediately

Wait for explicit confirmation before making any code changes.

### 5. Implement the change

Apply the agreed-upon code changes.

### 6. Validate

Read the repository instructions and inspect its scripts, manifests, and CI configuration to determine the correct validation commands. Use the repository's package manager and tooling; do not assume a language, workspace layout, or package naming convention.

Run relevant tests first, then the affected packages' build, lint, and type checks where available. For monorepos, use the actual workspace names and include dependent packages when the change affects them.

If a check fails because of the change, fix it and rerun. Report unrelated failures or unavailable checks explicitly; never claim a check passed without running it.

### 7. Confirm before shipping

Show the user:

- Which files changed (a brief summary, not the full diff)
- Validation results, including any failures or checks that could not run
- The reply message that will be posted

Ask for permission to commit, push, and reply.

### 8. Commit, push, and reply

Once approved, run everything in sequence — each step must complete before the next starts, because the reply depends on the commit SHA and the push completing first.

1. **Stage** — stage only the changed files by name (never `git add -A` or `git add .`).
2. **Commit** — follow the repository's commit conventions. Do not include Co-Authored-By or any AI attribution. Let any configured hooks finish; do not assume specific hooks or bypass them.
3. **Push** — push to the current branch. Wait for it to complete.
4. **Reply** — reply to the comment referencing the commit:
   ```
   gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
     -F in_reply_to={root_id} \
     -f body="Thanks, addressed in {short_sha}"
   ```
   A brief clarification of what changed is fine, but keep it to one sentence max.

For question-only comments (no code change), skip staging, committing, and pushing; just post the approved reply.

## Handling multiple comments

When the user provides multiple comment URLs or asks to address all PR comments:

1. Fetch all comments first
2. Group them by file — comments on the same file are often related
3. Present a summary of all comments with your proposed approach for each
4. After the user confirms, implement changes file by file (addressing related comments together)
5. Validate once after all changes are applied (not after each individual change — that would be slow)
6. Commit all changes in a single commit following the repository's conventions, with a message that references the PR review
7. Reply to each comment individually with the commit SHA

## Push-back replies

When the user wants to push back on a reviewer, help draft a reply that is:

- Respectful and collaborative in tone
- Specific about why the current approach was chosen
- Open to further discussion ("happy to discuss further" / "let me know what you think")
- Backed by concrete reasoning (performance, consistency with codebase patterns, etc.)

**Example:**

> Good point. I considered that approach but went with X because [reason]. The tradeoff is [tradeoff]. Happy to change it if you feel strongly, though!
