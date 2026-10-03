# Contributing to the Tabs public beta

Bug reports and small, focused reliability fixes are welcome. For substantial
changes, open an issue first so the maintainer can confirm scope. Review capacity
is limited during beta; filing a report or PR does not guarantee acceptance.

Product code lives in `tabs-main`; the embedded Code-OSS fork lives in
`tabs-code-main`. Read applicable AGENTS.md files. Preserve upstream licenses,
existing user data, and project architecture. Do not include credentials or
private source/prompts in examples, screenshots, logs, or diagnostics.

Run formatting, lint, typecheck, relevant tests, and the workspace test suite
from `tabs-main`. UI changes should include before/after screenshots and cover
keyboard access and light/dark themes. Installer changes require native platform
validation. Explain the problem, changed behavior, and checks run in the PR.

Use the repository bug template for version, OS/architecture, provider setup,
reproduction, restart behavior, and sanitized logs. Follow SECURITY.md for
vulnerabilities; do not report exploitable details publicly.
