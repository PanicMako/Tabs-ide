// Match markers placed around highlighted terms in snippets. They are private-use code points so they
// cannot collide with transcript text. Worker modules import this instead of `@tabs/contracts`
// (whose index pulls in every schema); engine.test.ts asserts it equals the contract's constants.
export const MARK_START = "";
export const MARK_END = "";
