---
description: Find and properly fix every // BOZO comment in the codebase
---
Search the entire codebase for every `// BOZO` comment. For each one:

1. Explain why you or the previous agent wrote the code that way, based on the surrounding code and history. If the reason is unclear, say so rather than guessing.
2. Fix the underlying issue properly, not just the comment. Remove the `// BOZO` comment once the fix is complete.
3. Keep the code clean and correct. Run relevant checks and tests, and report any that you could not run or that failed.

Do not skip any matches. Summarize each issue, its fix, and the validation performed.
