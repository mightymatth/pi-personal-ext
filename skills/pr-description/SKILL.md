---
name: pr-description
description: Create, draft, or improve pull requests and their descriptions. Always use for any PR creation or update workflow, including requests to make a branch, commit, push, run `gh pr create`, open a draft PR, or write, review, or improve a PR title or body.
---

# PR descriptions

Use the current conversation and code context first. Supplement it with the diff, commits, existing PR, linked sources, and repository PR template when useful. Do not repeat investigation already completed in the session.

Before drafting, establish the relevant answers:

- what changed at a high level, and what problem does it solve?
- what context should reviewers know? where did the work originate from: a ticket, Slack discussion, known issue, production logs, customer report, or conversation with someone? link to the source, if possible
- how was the affected behavior tested, and in which environment?
- is any setup needed to reproduce or review it?
- what background explains why the change was made this way?
- should reviewers focus on or ignore anything specific during the review?

Not every question needs to appear in every description, but use developer judgment. If important context is missing or unclear, ask the user before drafting. Do not guess. Ask clarification questions in one batch, not individually.

Write a concise description like a human developer:

- explain the problem, origin, and relevant background
- explain non-obvious decisions
- include useful evidence and references
- include meaningful validation of the affected behavior
- avoid narrating implementation already obvious from the code diff
- omit routine lint, typecheck, build, and generic test claims
- respect the repository PR template without letting it suppress useful context
- include a ticket reference only when reliably known

Propose the description first. Create or update the PR only after explicit user approval.
