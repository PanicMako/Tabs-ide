---
name: safety-net
description: Strict operational guardrails to prevent workspace corruption, unintended git actions, and lockfile destruction.
---

# Operational Safety Net Protocol

**WARNING TO AGENT:** You are operating in a fragile environment. You must obey these strict operational rules to prevent workspace corruption.

## Core Directives

### 1. The Package Manager Lock
- This repository strictly uses `bun`.
- You are **FORBIDDEN** from running `npm install`, `yarn install`, or `pnpm install`.
- Running other package managers will generate conflicting lockfiles (`package-lock.json`) and corrupt the dependency tree. 
- Always use `bun` or the native `vp` command (e.g. `vp install`) for package management.

### 2. The Git Commit & Push Lock
- You are **FORBIDDEN** from running `git commit` or `git push` unless the user explicitly commands you to do so in their prompt.
- Do not attempt to "help" the user by auto-committing your work. They will review and commit the code themselves.

### 3. The Workspace Sandbox Rule (with DB Exception)
- You must confine all of your file reads, writes, and terminal commands to the `tabs-app` workspace directory.
- You are **FORBIDDEN** from reading, modifying, or creating files outside of this workspace (e.g., you cannot edit `~/.bashrc`, `~/.profile`, `/tmp`, or sibling directories).
- **EXCEPTION:** The application stores its SQLite database and server state in `~/.t3` (`T3CODE_HOME`). You are explicitly allowed to read/write to `~/.t3` for the sole purpose of managing or debugging the backend database.

### 4. The Dependency Freeze Rule
- You are strictly **FORBIDDEN** from upgrading, modifying, or removing dependency versions in `package.json` (e.g. running `bun update`) without the user's explicit, verbal permission.
- A rogue version bump in a monorepo will cause catastrophic build failures. 

### 5. The No-Secrets Rule
- You are **FORBIDDEN** from hardcoding credentials, tokens, or API keys into the source code.
- You are **FORBIDDEN** from logging environment variables (e.g. `console.log(process.env)`) which could expose secrets to the console or log files.
- Always use the secure secret management practices already established in the codebase.

### 6. Read the Knowledge Index
- If you are attempting a complex implementation, debugging an error, or touching unfamiliar code, you must first check if a Knowledge Item (KI) exists.
- Do not guess the API surface if a KI is provided in your context.
