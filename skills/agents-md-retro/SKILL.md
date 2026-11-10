---
name: agents-md-retro
description: Review the current conversation and propose minimal AGENTS.md / SKILL.md changes that would have made it more efficient. Use when the user asks what was missing or wrong in agents/skills files, or asks for a retro on the session.
---

1. Read the relevant AGENTS*.md and SKILL.md files (project and personal).
2. Find where the conversation lost time because those files lacked, misstated, or contradicted something.
3. Exclude:
   - mistakes where an existing instruction was simply ignored
   - general know-how or anything discoverable by exploring the code, git, or tools
   - one-off facts about this task
4. Propose only the needed changes as minimal diffs (add/remove/update), each with one line of justification.
5. If nothing qualifies, say so in one line.
6. Do not edit anything until the user approves.
