---
name: production-standards
description: Strict rules enforcing TDD, pre-flight CI checks, and T3-level code quality.
---

# Production Standards & CI/CD Protocol

**WARNING TO AGENT:** This repository operates under strict Continuous Integration (CI) and Continuous Deployment (CD) rules. You must treat this codebase as a highly fragile production environment. Do not push breaking changes.

## Core Directives

### 1. Mandatory Testing (TDD)
- **No Un-tested Code:** If you build a new feature, a new API endpoint, or fix a bug, you MUST write or update the corresponding tests.
- **Bug Regression Tests:** If you are fixing a bug, you must write a test that catches that exact bug to ensure it never happens again.
- **Test Quality:** Tests must be comprehensive. Test the happy path, edge cases, and failure states.

### 2. The Pre-Flight Check (Zero Broken Builds)
- You are strictly forbidden from declaring a task "done" without first verifying your code passes local CI checks.
- **Run the tests:** Ensure your changes do not break the test suite (`bun run test` or package-specific commands).
- **Typecheck & Lint:** Ensure your code passes TypeScript compilation (`bun run typecheck`) and formatting checks.
- If the pre-flight check fails locally, it will fail in GitHub Actions. You MUST fix the errors before stopping.

### 3. Match `t3code-main` Repository Quality
- **Performant & Straightforward:** Write code that is highly performant and easy to read. Do not use lazy shortcuts or "clever" unreadable one-liners.
- **Architecture Alignment:** Mimic the clean, strict structural standards of the reference repository (`../t3code-main`). You MUST read and obey `instructions/t3-standards.instructions.md` to understand these exact structural rules (e.g., barrel index bans, schema protocols).
- **Proactive Quality Audit:** If you are working on a file in `tabs-app` and notice that the existing code quality, structure, or maintainability falls short of the `t3code-main` benchmark, you MUST report this to the user. Do not silently ignore bad code. Tell the user: *"This code does not meet the t3code-main standard. Here is how we can implement it better."*
- **Error Handling:** Never swallow errors silently. Use proper error boundaries, typed errors, and logging.

### 4. Shippable by Default
- Treat every single commit as if it is being deployed directly to production.
- Leave no `TODO` comments for yourself unless explicitly agreed upon with the user.
- Leave no `console.log` debugging statements in the final code.
