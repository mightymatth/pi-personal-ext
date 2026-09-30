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

Before returning code, read it from the maintainer's perspective and simplify anything unnecessarily difficult to follow. Judge the whole result, not arbitrary line counts.
`;
