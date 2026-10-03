# Tabs IDE Architecture & Upstream Maintainer Guide

---

## 1. Overview & Ownership Model

Tabs IDE is a native developer environment optimized for multi-agent workflows (Codex, Claude, custom MCP tools, server preset orchestration, and testing).

To maintain frictionless weekly/monthly updates from upstream `microsoft/vscode:main`, this repository strictly enforces the **Zero Core Mutation** architectural pattern.

### Ownership Boundary

```
┌─────────────────────────────────────────────────────────────────┐
│                    UPSTREAM VS CODE OWNED                       │
│  src/vs/base/                                                   │
│  src/vs/platform/                                               │
│  src/vs/editor/                                                 │
│  src/vs/workbench/                                              │
│  src/vs/sessions/ (core services, layout, non-tabs contribs)    │
│                                                                 │
│  ★ Never modified by Tabs feature development                   │
│  ★ Synced continuously with microsoft/vscode:main               │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                   (Single Integration Seam)
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        TABS IDE OWNED                           │
│  src/vs/workbench/contrib/tabs/                                 │
│  ├── tabs.contribution.ts  <-- Only imported file in core       │
│  ├── common/               <-- Protocols, types, constants      │
│  └── media/tabs.css        <-- Tabs UI styles                   │
│                                                                 │
│  product.json              <-- Branding & App Config Overlay    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Dual Provider Architecture: Tabs AI & GitHub Copilot

Tabs IDE natively supports **both** Tabs AI (Codex, Claude 3.5 Sonnet, native tool execution) and **GitHub Copilot** as peer first-class providers:

```
                         Tabs IDE
                            │
                 ┌──────────┴──────────┐
                 │                     │
             Tabs AI              GitHub Copilot
                 │                     │
          Codex / Claude          Native Copilot
                 │                     │
                 └──────────┬──────────┘
                            │
                     Code-OSS Runtime
```

### Key Integration Points

1. **Workbench Entrypoint & Layout**:
   - `src/vs/code/electron-browser/workbench/workbench.ts`: Preserves `isTabsEmbeddedWorkbench` flag and layout state across session reloads.
   - `src/vs/workbench/browser/layout.ts`: Default fallbacks for ZenMode when hosted in the Tabs shell.
   - `src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts`: Maintains visibility of the secondary sidebar composite bar even when the main activity bar is hidden.

2. **Native Host & Preload**:
   - `src/vs/base/parts/sandbox/electron-browser/preload.ts`: Standard Electron sandbox preloads.
   - Host integration terminates in `tabs-app/apps/desktop/src/nativeCodeHostMain.ts`.

3. **Production Extensions**:
   - Packaged Copilot extension bundles include runtime dependencies (`dotenv`, `source-map-support`).
   - `.moduleignore` preserves required SDK entry points.
