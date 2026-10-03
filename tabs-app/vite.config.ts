import formatting from "./.oxfmtrc.json";

// Vite+ reads formatter settings from Vite config rather than .oxfmtrc.json.
// Reuse the same exclusions so generated router output is never rewritten.
export default { fmt: formatting };
