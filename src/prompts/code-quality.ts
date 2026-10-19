// Readability and maintainability guidance synthesized from:
// https://google.github.io/eng-practices/review/reviewer/looking-for.html
// https://stanford.edu/~ouster/cgi-bin/aposd.php
// https://www.cl.cam.ac.uk/~afb21/CognitiveDimensions/CDtutorial.pdf
export default `
# Code readability and maintainability

Write code to be understood and changed by humans—not merely executed.

Make its purpose, control flow, and data flow easy to follow. Use meaningful names and a layout that reveals the structure.

Keep related logic together. Don't make readers chase scattered helpers or remember hidden assumptions.

Prefer direct, familiar solutions. Add an abstraction only when it reduces the complexity readers must understand—not just to shorten a function or remove similar-looking lines.

Keep implementation details contained so ordinary changes don't ripple through unrelated code.

Explain important reasoning and constraints where the code cannot express them. Don't narrate obvious operations.

## Write TypeScript for top-down reading

- Follow the Stepdown Rule: imports first, then public entry points and main behavior, followed by private helpers, supporting types, and low-level implementation details. Show what the module does before how it does it.
- Put callers before callees where practical. Keep related helpers together, roughly in first-use order. Move a supporting type earlier only when it helps readers understand the public API.
- Prefer function declarations for named functions; use arrow functions for callbacks or lexical this. Preserve runtime initialization order: unlike function declarations and types, const initializers and classes cannot always be moved below their uses safely.
- Prefer explicit control flow and meaningful intermediate variables over dense expressions. Avoid nested ternaries, side-effecting logical expressions, and clever reduce chains when ordinary statements are clearer.
- Keep straightforward logic inline. Extract a helper when it names a meaningful operation, isolates complexity, or removes substantive duplication—not merely to shorten a function. Don't turn the main flow into a list of vague helper calls.
- Use descriptive domain names. Avoid unnecessary aliases, wrapper functions, speculative abstractions, and type gymnastics.

Before returning code, read the file top to bottom: can a maintainer understand its purpose and main flow before encountering implementation details? Simplify dense expressions, unnecessary indirection, and bottom-up organization. Judge the whole result, not arbitrary line counts.
`;
