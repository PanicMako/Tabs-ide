export interface ChangelogCategory {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  tag: string;
  title: string;
  date: string;
  shortDate?: string;
  isLatest?: boolean;
  type: "major" | "feature" | "patch";
  summary: string;
  highlights: string[];
  categories: ChangelogCategory[];
  installers?: {
    platform: string;
    arch: string;
    filename: string;
    url: string;
  }[];
}

export const TOTAL_TAGS_COUNT = 171;

export const changelogData: ChangelogRelease[] = [
  {
    tag: "v1.3.28",
    title: "Development state isolation, preserved workspace configs, and reactive typography",
    date: "September 29, 2026",
    shortDate: "Sep 29",
    isLatest: true,
    type: "patch",
    summary:
      "Tabs isolates development state from production profiles, preserves workspace configuration files during data resets, and applies font preference changes immediately across the interface.",
    highlights: [
      "Development launches now use a dedicated state directory, keeping local development sessions separated from your production profiles and caches.",
      "Local data reset flows now preserve active workspace configuration files alongside editor runtime data and settings.",
      "Font family, heading font, and custom theme adjustments apply instantly across all open views without requiring a page reload.",
    ],
    categories: [
      {
        title: "Reliability",
        items: [
          "Development launches now use an isolated state directory to avoid mutating production profiles.",
          "Local data reset flows preserve workspace configuration files alongside editor runtime data.",
        ],
      },
      {
        title: "Appearance",
        items: [
          "Font preference and custom theme changes apply reactively across all open views without page reloads.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.27",
    title: "Orphaned provider process cleanup and theme typography combination persistence",
    date: "September 28, 2026",
    shortDate: "Sep 28",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs automatically detects and shuts down orphaned local provider process groups when the parent process exits unexpectedly, and preserves selected font preset combinations when client settings update.",
    highlights: [
      "Adds a process watchdog to monitor local provider servers, terminating detached provider process groups cleanly if the Tabs backend process exits unexpectedly.",
      "Selected typography presets in Themes settings now take precedence when restoring saved configurations, preventing older client font settings from reverting your active font combo.",
      "Stale development instance termination now tracks complete process groups and cleans up orphaned OpenCode and Kilo server instances across worktrees.",
    ],
    categories: [
      {
        title: "Reliability",
        items: [
          "Detached provider process watchdog to stop orphaned provider process groups when backend exits.",
          "Development cleanup now terminates full process groups for local provider servers across worktrees.",
        ],
      },
      {
        title: "Appearance",
        items: [
          "Preserve selected font combination presets when restoring saved client configurations.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.26",
    title: "Font picker selection highlight and persistent typography synchronization",
    date: "September 28, 2026",
    shortDate: "Sep 28",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs restores the active selection highlight for typography presets in Themes settings and synchronizes font family preferences to persistent storage.",
    highlights: [
      "Selecting a preset font combination or choosing individual interface and editor fonts in Themes settings now immediately displays the active selection highlight.",
      "Font family choices now synchronize directly to the persistent settings store alongside font size preferences, ensuring your active typography state remains consistent across restarts.",
    ],
    categories: [
      {
        title: "Appearance",
        items: [
          "Restored active selection highlight on font presets and individual font pickers in Themes settings.",
          "Synchronized font family selections with client settings store for consistent state comparison.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.25",
    title:
      "Packaged desktop font rendering, editor font synchronization, and dynamic provider models",
    date: "September 28, 2026",
    shortDate: "Sep 28",
    type: "patch",
    summary:
      "Tabs improves desktop font rendering with proper cross-origin headers, adds instant font preference synchronization for the embedded editor, and switches provider models to dynamic capability snapshots.",
    highlights: [
      "Resolved cross-origin asset restrictions when loading local application fonts in packaged desktop builds, ensuring custom UI fonts render cleanly.",
      "Updated editor typography settings so font family and code font size preferences apply immediately to the embedded Code-OSS editor and persist across restarts.",
      "Provider model menus now rely strictly on live provider capability snapshots, keeping available models accurate and up to date.",
      "Curated the font picker to bundled local typefaces so your selected typography renders consistently with or without network access.",
    ],
    categories: [
      {
        title: "Desktop",
        items: [
          "Proper cross-origin headers for custom font assets in packaged builds.",
          "Real-time font family and size synchronization with the embedded Code-OSS editor.",
        ],
      },
      {
        title: "Models",
        items: ["Dynamic provider model discovery from live server capability snapshots."],
      },
      {
        title: "Appearance",
        items: ["Offline font reliability with bundled local typefaces."],
      },
    ],
  },
  {
    tag: "v1.3.24",
    title: "Local data reset, batch keybindings restore, and renderer responsiveness diagnostics",
    date: "September 27, 2026",
    shortDate: "Sep 27",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs introduces a safe local data reset option in About settings, atomic restoration of default keyboard shortcuts, and real-time renderer responsiveness metrics in Diagnostics.",
    highlights: [
      "Easily reset Tabs cached data, conversation history, and local profile state directly from Settings while safely preserving your Git worktrees and editor runtime.",
      "Restoring default shortcuts now removes all custom keybindings in a single atomic operation, preventing partial resets or delays.",
      "Added real-time tracking of input delay, main-thread long tasks, and presentation latency to the Diagnostics panel to help identify UI slowdowns.",
      "Settings sections now synchronize with URL search parameters for direct navigation, and notification toggles display clear pending states during system authorization.",
    ],
    categories: [
      {
        title: "Settings",
        items: [
          "Safe local data reset in About settings preserving Git worktrees.",
          "Atomic batch restoration for default keybindings.",
          "URL search parameter synchronization for settings navigation.",
        ],
      },
      {
        title: "Diagnostics",
        items: ["Real-time tracking of UI input delay, long tasks, and presentation latency."],
      },
    ],
  },
  {
    tag: "v1.3.23",
    title: "Vibrant setup wizard wallpapers, filmstrip dock, and modal portaling",
    date: "September 25, 2026",
    shortDate: "Sep 25",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs enhances the first-run onboarding experience with curated bright anime wallpapers, a horizontal filmstrip dock for quick scene switching, and portaled modal rendering.",
    highlights: [
      "The first-run welcome wizard now filters wallpaper options to bright daytime and sunset anime scenes, ensuring striking visual contrast against the dark-glass interface.",
      "Enabled the quick-access horizontal wallpaper shelf in the welcome wizard header, letting you preview and switch scenes without opening the full-screen modal.",
      "Updated the full-screen wallpaper gallery modal to mount directly to the document root, eliminating overlay clipping and dialog stacking conflicts.",
    ],
    categories: [
      {
        title: "Onboarding",
        items: [
          "Curated bright daytime and sunset anime wallpapers in the welcome wizard.",
          "Interactive horizontal wallpaper filmstrip dock for fast browsing.",
          "Document-level modal portaling for overlay stability.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.22",
    title: "Interactive onboarding sandbox, wallpaper gallery, and system icon theme",
    date: "September 25, 2026",
    shortDate: "Sep 25",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs introduces an interactive project prototype sandbox in the welcome wizard, a curated gallery of 30 aesthetic desktop wallpapers, and automatic system-matching application icons.",
    highlights: [
      "The welcome wizard now includes a hands-on prototype sandbox where you can explore project presets, inspect agent tools, and preview workspace capabilities before opening your first repository.",
      "Added a gallery of 30 curated high-resolution wallpapers across scenic, pastel, and anime aesthetics with an interactive preview modal and custom wallpaper controls.",
      "The application icon theme setting now includes a System option that automatically matches your operating system appearance alongside fixed light and dark icons.",
      "Refined bundled runtime asset verification to ensure consistent Code-OSS runtime packaging across desktop platforms.",
    ],
    categories: [
      {
        title: "Onboarding",
        items: [
          "Interactive prototype sandbox in the welcome wizard.",
          "Hands-on project preset selection and tool capability exploration.",
        ],
      },
      {
        title: "Customization",
        items: [
          "Curated gallery of 30 atmospheric high-resolution wallpapers.",
          "System desktop icon theme automatically syncing with OS dark/light mode.",
        ],
      },
      {
        title: "Packaging",
        items: ["Refined bundled Code-OSS runtime staging and dependency asset verification."],
      },
    ],
  },
  {
    tag: "v1.3.21",
    title: "Launchpad command dashboard and preset icon customization",
    date: "September 24, 2026",
    shortDate: "Sep 24",
    type: "patch",
    summary:
      "Tabs replaces the Server tab with Launchpad, introducing visual icon customization for development presets and automatic category detection for project workflows.",
    highlights: [
      "Rebranded the Server tool to Launchpad to better reflect running development servers, background tasks, worker processes, and database consoles in one place.",
      "Added 12 curated icon choices for Launchpad presets, including frontend, backend, database, worker, terminal, and build workflows.",
      "Presets intelligently suggest matching icons as you type their label, such as frontend web, backend API, database, worker queue, or build tasks.",
      "Project configurations automatically map existing server presets and tool labels to Launchpad while preserving commands, working folders, and preview URLs.",
    ],
    categories: [
      {
        title: "Launchpad",
        items: [
          "Replaced Server tool with Launchpad command hub across the workspace and product experience.",
          "Visual icon picker with 12 preset iconography options.",
          "Real-time icon suggestion auto-detecting preset roles from labels.",
          "Automatic migration for existing project workspace settings and tool configurations.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.20",
    title: "Expanded external editor integration and refined workspace controls",
    date: "September 24, 2026",
    shortDate: "Sep 24",
    type: "patch",
    summary:
      "Tabs expands external editor discovery with automatic path detection and branded icons for JetBrains, Trae, Kiro, and VSCodium, alongside streamlined split-button headers and sidebar thread actions.",
    highlights: [
      "Added automatic executable detection for JetBrains IDEs, Trae, Kiro, VS Code Insiders, and VSCodium across macOS, Windows, and Linux.",
      "Integrated official brand iconography for all supported external editors and system file managers in the Open In menu.",
      "Replaced standard button groupings in the chat header and Git actions toolbar with cohesive split-button controls featuring descriptive tooltips and smooth dropdown menus.",
      "Added quick-access floating actions to sidebar thread items for pinning, settling, and snoozing threads without opening full context menus.",
      "Updated sidebar filter tabs to display dynamic match counts for active, settled, snoozed, and archived threads when searching.",
    ],
    categories: [
      {
        title: "External Editors",
        items: [
          "Automatic application detection for JetBrains suite (IntelliJ IDEA, WebStorm, PyCharm, GoLand, CLion, Rider, RustRover, PhpStorm, DataGrip, DataSpell, Aqua, RubyMine).",
          "Detection for Trae, Kiro, VS Code Insiders, and VSCodium across macOS, Windows, and Linux.",
          "Branded icons for all editors and platform file managers.",
        ],
      },
      {
        title: "Workspace UI",
        items: [
          "Split-button controls with tooltips for Git quick actions and Open In editor selection.",
          "Thread hover action bar for quick pin, settle, and snooze.",
          "Dynamic search counters across sidebar thread status tabs.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.19",
    title: "Improved user message readability and layout in chat",
    date: "September 24, 2026",
    shortDate: "Sep 24",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs refines user message formatting in the conversation timeline so multi-line text, bulleted lists, and structured notes read naturally.",
    highlights: [
      "User message text is now aligned to the left within its right-docked message block, ensuring list items, headers, and wrapped lines start cleanly from the margin.",
      "Upgraded prompt line height to relaxed spacing, matching the composer and providing visual breathing room for multi-line prompts and code snippets.",
      "Maintained the signature right-side vertical accent border and docked placement while eliminating awkward jagged right-aligned line wrapping.",
    ],
    categories: [
      {
        title: "Chat & Workspace UI",
        items: [
          "Left-aligned prompt text inside right-docked user message container.",
          "Relaxed typography line height for multi-line prompts, code snippets, and lists.",
          "Preserved right-side vertical accent border.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.18",
    title: "Faster and more reliable desktop update installation",
    date: "September 24, 2026",
    shortDate: "Sep 24",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs speeds up desktop updates across macOS and Linux by pre-staging downloaded releases in the background and eliminating lengthy installation stalls.",
    highlights: [
      "Downloaded updates are now pre-staged in the background while you continue working, making the restart-to-install action nearly instantaneous.",
      "Removed redundant multi-gigabyte re-verification steps during installation that previously caused desktop updates on macOS and Linux to freeze or take tens of minutes.",
      "Staging and preparation failures now surface as clear, retryable error messages before restarting, preventing the app from getting stuck in an indefinite restart loop.",
      "Automatically clears macOS download quarantine attributes during update staging to prevent launch interruptions after installing.",
    ],
    categories: [
      {
        title: "Desktop Experience",
        items: [
          "Pre-staged background update extraction for macOS and Linux.",
          "Eliminated deep codesign and SHA-512 verification bottlenecks during update restart.",
          "Surface actionable error reporting prior to quitting on update failure.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.17",
    title: "Polished update release notes dialog",
    date: "September 24, 2026",
    shortDate: "Sep 24",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs brings a redesigned software update notes dialog with cleaner formatting and dedicated dismiss controls.",
    highlights: [
      "Added a clear close button to the update notes window alongside escape and backdrop dismiss options.",
      "Centered the update dialog with larger readable typography, a version badge, and a blurred backdrop.",
      "Switched download manifests and release notes caching to prevent rate limits and ensure update details are immediately visible.",
    ],
    categories: [
      {
        title: "Desktop Experience",
        items: [
          "Redesigned release notes modal with dedicated dismiss action.",
          "Clearer typography and layout for update details.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.16",
    title: "More recoverable desktop updates",
    date: "September 23, 2026",
    shortDate: "Sep 23",
    isLatest: false,
    type: "patch",
    summary:
      "Tabs protects your existing installation during desktop updates and retries a full download when a smaller differential download fails.",
    highlights: [
      "macOS restores the previous app if replacing it fails.",
      "Linux keeps the previous AppImage until the replacement starts successfully.",
      "Windows closes processes running from the existing Tabs installation before replacing its files, while leaving unrelated processes open.",
    ],
    categories: [
      {
        title: "Desktop Updates",
        items: [
          "Recovery for interrupted macOS and Linux updates.",
          "Safer Windows upgrades when the existing installation has files in use.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.15",
    title: "Centered release notes dialog with dedicated close control",
    date: "September 22, 2026",
    shortDate: "Sep 22",
    isLatest: false,
    type: "feature",
    summary:
      "Tabs now opens software update release notes in a centered modal dialog with an accessible top-right close button, blurred backdrop scrim, and smooth scrolling.",
    highlights: [
      "Replaced the edge-anchored popover with a spacious, centered modal dialog that gives release notes plenty of reading room across all display sizes.",
      "Added an accessible top-right close button with an X icon, complementing keyboard escape and backdrop click to dismiss.",
      "Added a smooth, scroll-faded reading panel so you can easily browse long update notes while keeping titles and close actions anchored.",
    ],
    categories: [
      {
        title: "Desktop Experience",
        items: [
          "Centered release notes modal dialog with blurred backdrop scrim.",
          "Dedicated top-right close button with X icon.",
          "Scroll-faded reading area for clean changelog browsing.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.14",
    title: "Reliable settings drafts and input saving",
    date: "September 22, 2026",
    shortDate: "Sep 22",
    isLatest: false,
    type: "feature",
    summary:
      "Tabs now isolates unsaved drafts in workspace settings, debounces continuous settings inputs with instant flush on blur or close, and ensures theme previews revert cleanly when cancelled.",
    highlights: [
      "Editing custom browser tabs, terminal tabs, or server presets keeps your in-progress changes isolated until you choose to save or cancel.",
      "Settings text fields automatically debounce updates during typing and flush immediately on blur, Enter, or when closing the application.",
      "Exploring and customizing colors in the Theme Studio safely reverts back to your previous theme if you exit or cancel without applying changes.",
      "Refreshed brand typography and visual aurora liquid effects across buildwithtabs.com.",
      "Improved stability and validation when importing custom keybinding configurations.",
    ],
    categories: [
      {
        title: "Settings & Workspaces",
        items: [
          "Isolated entity-level drafts for custom Browser Tabs, Terminal Tabs, and Server Presets.",
          "Debounced input persistence with instant flush on blur, Enter, and application shutdown.",
          "Theme Studio preview rollback on cancel or close.",
          "Server keybindings batch upsert validation and error handling.",
        ],
      },
      {
        title: "Design & Brand",
        items: ["Refreshed brand typography and visual aurora liquid wave effects."],
      },
    ],
  },
  {
    tag: "v1.3.13",
    title: "In-app desktop updates and release notes preview",
    date: "September 21, 2026",
    shortDate: "Sep 21",
    isLatest: false,
    type: "feature",
    summary:
      "Tabs now checks for desktop updates directly within the application, previews release notes before downloading or installing, and provides in-app updates for preview builds on macOS.",
    highlights: [
      "macOS preview builds now verify and install updates in place, with automatic cryptographic signature and checksum verification.",
      "Hover over the update button or check About settings to review what changed before downloading or restarting.",
      "See real-time download percentage directly in the update button tooltip and About settings.",
      "Fresh product screenshots, social cards, and updated release documentation on buildwithtabs.com.",
    ],
    categories: [
      {
        title: "Desktop updates",
        items: [
          "In-app preview updates on macOS verified with Ed25519 signatures and SHA-512 digests.",
          "Release notes preview in the sidebar update button and full notes in About settings.",
          "Real-time download progress tracking in update tooltips and settings.",
        ],
      },
      {
        title: "Documentation & marketing",
        items: [
          "Updated marketing screenshots and social previews.",
          "Documented macOS preview updater architecture and verification guarantees.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.12",
    title: "Work with two agent threads side by side",
    date: "September 20, 2026",
    shortDate: "Sep 20",
    isLatest: false,
    type: "feature",
    summary:
      "Open two agent conversations in the same Tabs window, keep a separate draft in each pane, and resize the view to suit your screen.",
    highlights: [
      "Open a second conversation by dragging a thread, choosing 'Open to the side', or Alt-clicking it.",
      "Keep a separate draft, attachments, and message position in each pane.",
      "Follow agent replies in both panes while you work.",
      "Resize the divider with a mouse or keyboard, or double-click to split the space evenly.",
      "On narrow windows, Tabs shows one thread at a time with a quick way to switch.",
    ],
    categories: [
      {
        title: "Working side by side",
        items: [
          "Drag a thread into either side of the conversation area.",
          "Choose 'Open to the side' from a thread's menu or Alt-click it.",
          "Start a new thread in the active pane without closing the other conversation.",
        ],
      },
      {
        title: "Layout and controls",
        items: [
          "Resize the divider by dragging or with the arrow keys.",
          "Maximize or close a pane from its header controls.",
          "Switch quickly between threads when the window is too narrow for two panes.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.11",
    title: "Smoother startup and more reliable saved sessions",
    date: "September 20, 2026",
    shortDate: "Sep 20",
    type: "patch",
    summary:
      "Startup feels smoother, and Tabs better preserves browser sessions and workspace settings when closing or updating the app.",
    highlights: [
      "Paced the Solari tile cascade with a relaxed 160ms letter stagger, 250ms scramble lead-in, and 1.8s hold time for a smooth 8-tile highlight wave.",
      "Proactively flushes in-memory session cookies and cache partitions before application shutdown, preventing session state loss on exit.",
      "Improved how existing workspace settings are carried forward during updates.",
      "Preserved Linux user data across verified historical configuration paths.",
      "Honored user accessibility preferences across all core dialog primitives (Alert Dialog, Command Palette, Dialog, and Sheet).",
      "Maintained self-contained desktop installers (.dmg, .exe, .AppImage) bundling the complete Code-OSS runtime directly.",
    ],
    categories: [
      {
        title: "User Experience & Startup Polish",
        items: [
          "Relaxed startup Solari tile cascade timing with 160ms stagger and 250ms scramble lead-in.",
          "Smoothed tile highlight transition with a 380ms ease-out outline glow wave.",
          "Extended minimum startup animation hold time to 1.8 seconds to gracefully resolve the full wordmark.",
          "Honored prefers-reduced-motion across Alert Dialog, Dialog, Sheet, and Command Palette.",
        ],
      },
      {
        title: "Desktop & Storage Stability",
        items: [
          "Proactively flushed browser session partitions prior to application shutdown.",
          "Hardened workspace shell storage migration against invalid schemas and state corruption.",
          "Preserved Linux user data across verified legacy paths.",
          "Improved preservation of older Linux user data during updates.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.10",
    title: "Easier keyboard entry in the time picker",
    date: "September 18, 2026",
    shortDate: "Sep 18",
    type: "patch",
    summary:
      "Typing a two-digit time is more reliable, and the selected value stays in sync when you scroll.",
    highlights: [
      "Added 800ms numeric accumulation buffer allowing smooth typing of two-digit hours without premature auto-advance sticking at '1'.",
      "The displayed time now stays in step with the picker wheel while scrolling.",
      "Maintained self-contained desktop installers (.dmg, .exe, .AppImage) bundling the complete Code-OSS runtime.",
      "Fixed a time picker issue that could leave the selected hour stuck on its first digit.",
    ],
    categories: [
      {
        title: "User Interface & Input Polish",
        items: [
          "Added two-digit digit accumulation buffer and 800ms timer to AppleTimePicker hour and minute inputs.",
          "Prevented keyboard focus jumps and digit sticking when typing two-digit hours.",
          "Synchronized WheelColumn drum wheel scroll position with live selected values via mutable ref caching.",
        ],
      },
      {
        title: "Desktop Distribution & Stability",
        items: [
          "Bundled Code-OSS runtime directly within production application resources on all supported platforms.",
          "Prevented remote runtime download dependencies on application startup.",
          "Aligned relay discovery error propagation with Effect yieldable error contracts.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.9",
    title: "Desktop installers include the editor",
    date: "September 17, 2026",
    shortDate: "Sep 17",
    type: "patch",
    summary:
      "The desktop installer includes the editor it needs to start, so a separate runtime download is no longer required after installation.",
    highlights: [
      "Packaged desktop releases (.dmg, .exe, .AppImage) now bundle the complete Code-OSS runtime directly inside the application package.",
      "Fixed a dependency issue that could stop the packaged app from opening.",
    ],
    categories: [
      {
        title: "Desktop Packaging & Distribution",
        items: [
          "Bundled Code-OSS runtime directly into Resources/tabs-code-main for macOS and resources/tabs-code-main for Linux and Windows.",
          "Eliminated post-installation download latency and remote 404 runtime zip dependencies.",
          "Added strict build assertions verifying runtime integrity before producing release artifacts.",
        ],
      },
      {
        title: "Development Runtime & Isolation",
        items: [
          "Short-circuited remote runtime download checks during local development execution.",
          "Ensured bun run dev:desktop consistently resolves editor assets from the local checkout.",
        ],
      },
      {
        title: "Platform Runtime Stability",
        items: [
          "Pinned @effect/platform-node-shared to 4.0.0-beta.78 to align with @effect/platform-node.",
          "Prevented runtime ByteSize module import failures on packaged desktop launches.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.8",
    title: "Updated editor and workspace controls",
    date: "September 16, 2026",
    shortDate: "Sep 16",
    type: "feature",
    summary:
      "Tabs updates the embedded editor to the VS Code 1.138 codebase and refines workspace controls, time entry, and settings.",
    highlights: [
      "Synchronized vendored Code-OSS runtime with upstream VS Code 1.138.0, updating workbench parts, chat widgets, and extensions.",
      "Refined the layout, prompt stash, and message queue panels.",
      "Refined workspace shell layout, prompt stash and message queue panels, time picker input mechanics, and notification settings.",
    ],
    categories: [
      {
        title: "Code-OSS & Upstream Sync",
        items: [
          "Synchronized vendored Code-OSS runtime and dependencies with VS Code 1.138.0.",
          "Updated workbench chat contributions, terminal contributions, and built-in extensions.",
          "Refreshed Code-OSS bootstrap configuration, product settings, and build pipelines.",
        ],
      },
      {
        title: "AgentHost & Protocol Schemas",
        items: [
          "Upstream-aligned AgentHost session coordination, changeset handlers, and turn starter lifecycle.",
          "Regenerated and synced Codex JSON-RPC protocol schemas across all domain types.",
          "Updated Copilot and Claude provider adapters for the synchronized runtime.",
        ],
      },
      {
        title: "Native Code Host & Testing",
        items: [
          "Implemented strongly-typed native code host IPC contracts for desktop integration.",
          "Added automated contract testing suite for native code host bridge stability.",
          "Polished desktop smoke tests and resource initialization.",
        ],
      },
      {
        title: "UI & Settings Polish",
        items: [
          "Refined workspace shell layout, right panel tabs, and sidebar logic.",
          "Improved prompt stash and message queue panel user experience.",
          "Enhanced keyboard numeric entry and styling for time picker and settings controls.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.7",
    title: "Notification history and scheduling improvements",
    date: "September 16, 2026",
    shortDate: "Sep 16",
    type: "feature",
    summary:
      "Review past notifications, adjust desktop alerts, enter scheduled times more easily, and choose available Codex reasoning levels.",
    highlights: [
      "Persistent notification history drawer with category filtering, sound/badge controls, and desktop overlay synchronization.",
      "Overhauled schedule popover with backdrop blur and direct keyboard numeric entry for time and date pickers.",
      "Prompt stash and message queue panels for organizing and sequencing agent commands without interrupting execution.",
      "Ending an agent conversation now stops its background updates more reliably.",
    ],
    categories: [
      {
        title: "Notifications & Desktop Alerts",
        items: [
          "Notifications History drawer with category filters, sound toggles, and auto-dismiss duration controls.",
          "Desktop native overlay synchronization for real-time alert updates and dismissals.",
          "Integrated notification settings panel with granular toast and sound preferences.",
        ],
      },
      {
        title: "Prompt Stash & Scheduling",
        items: [
          "Overhauled time picker mechanics: eliminated drum wheel scroll fighting and hour input sticking.",
          "Added modern backdrop blur styling to schedule dialog popovers.",
          "Prompt stash and message queue panels for composing and batching agent actions.",
        ],
      },
      {
        title: "Providers & Session Runtime",
        items: [
          "Bound Antigravity, Codex, Copilot, Cursor, Droid, and Grok adapter loops to session scopes.",
          "Prevented orphan notification fibers and leaked event loops upon session changes.",
          "Dynamic Codex reasoning effort configuration and resilient Grok model fallback routing.",
        ],
      },
      {
        title: "Theme Studio & Typography",
        items: [
          "Added headingFont customization in Theme Studio with complete export/import sync.",
          "Polished input decorations, popover backdrops, and active tab indicators.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.6",
    title:
      "Native view notification overlay, persistent editor views, and accessible modal dialogs",
    date: "September 15, 2026",
    shortDate: "Sep 15",
    type: "feature",
    summary:
      "Topmost native notification overlay above Code-OSS and browser views without detaching or flashing, typed notification IPC with focus restoration, and accessible custom dialogs throughout the UI.",
    highlights: [
      "Topmost native notification overlay rendering toasts above embedded Code-OSS and browser surfaces.",
      "Typed notification IPC and focus restoration returning keyboard focus to the active native editor or web view.",
      "Accessible modal dialogs replacing raw browser popups across Git, Testing, Settings, and Theme Studio.",
      "Input styling refinements ensuring decoration icons layer properly above background controls across all themes.",
    ],
    categories: [
      {
        title: "Desktop & Notification Overlay",
        items: [
          "Native WebContentsView notification overlay managed by NativeViewStackCoordinator.",
          "Persistent editor views: eliminated canvas detaching and blank states when notifications appear.",
          "Typed notification IPC channels with robust focus tracking and restoration.",
        ],
      },
      {
        title: "Accessibility & Modal Dialogs",
        items: [
          "Replaced native browser confirm/alert dialogs with custom accessible Dialog components.",
          "Standardized useConfirm hook for billing, unstaged changes, and destructive actions.",
          "Modernized custom select dropdowns across Testing Journey Recorder and PR review cards.",
        ],
      },
      {
        title: "UI & Theme Styling",
        items: [
          "Fixed absolute input icon z-indexes across light and dark themes.",
          "Streamlined review thread action buttons and locator pickers.",
        ],
      },
    ],
  },
  {
    tag: "v1.3.5",
    title:
      "Antigravity protocol, collaborative browser engine, PR stacks, and streaming performance",
    date: "September 14, 2026",
    shortDate: "Sep 14",
    type: "feature",
    summary:
      "Native Antigravity protocol support, real-browser cookie and session import with isolated profiles, GitHub pull request stacks, and major streaming timeline optimizations.",
    highlights: [
      "Native Antigravity protocol integration with interactive approval options and resilient provider streams.",
      "Collaborative browser engine with real session import, passkey capabilities, CDP operation serialization, and side-by-side comparison replay.",
      "Manage GitHub PR stacks directly from Tabs with linked threads, status checks, and inline review annotations.",
      "Incremental markdown parsing, resumable syntax highlighting, and DOM stabilization for streaming code lines.",
    ],
    categories: [
      {
        title: "Antigravity Protocol & Server",
        items: [
          "Native Antigravity protocol support with interactive approval options.",
          "Optimized server logging, turn queueing during compaction, and resilient provider streams.",
        ],
      },
      {
        title: "Collaborative Browser Engine",
        items: [
          "Real-browser session and cookie import engine with profile-scoped permissions.",
          "CDP operation serialization, human takeover preemption, and external OAuth fallback.",
          "Side-by-side comparison replay and restored custom tab controls.",
        ],
      },
      {
        title: "Pull Request Stacks & Reviews",
        items: [
          "Navigate and manage GitHub PR stacks directly within the IDE.",
          "Bi-directional linking between agent threads and PRs with multi-PR support.",
          "Status checks, review metadata, and inline review annotations.",
        ],
      },
      {
        title: "Streaming & Timeline Performance",
        items: [
          "Incremental markdown parsing and resumable syntax highlighting during token streaming.",
          "DOM stabilization for completed code lines to reduce layout shifts.",
          "Bounded live timeline rendering and state preservation across large threads.",
        ],
      },
      {
        title: "Settings & Workspace Resilience",
        items: [
          "Split heavyweight settings sections into lazy-loaded panels.",
          "Recoverable configuration persistence failures and complete keybinding configuration.",
          "Preserved per-project active tools across workspace navigation.",
        ],
      },
    ],
    installers: [
      {
        platform: "macOS",
        arch: "Apple Silicon",
        filename: "Tabs-1.3.5-arm64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.5/Tabs-1.3.5-arm64.dmg",
      },
      {
        platform: "macOS",
        arch: "Intel",
        filename: "Tabs-1.3.5-x64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.5/Tabs-1.3.5-x64.dmg",
      },
      {
        platform: "Windows",
        arch: "x64",
        filename: "Tabs-Setup-1.3.5.exe",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.5/Tabs-Setup-1.3.5.exe",
      },
      {
        platform: "Linux",
        arch: "x64 AppImage",
        filename: "Tabs-1.3.5-x86_64.AppImage",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.5/Tabs-1.3.5-x86_64.AppImage",
      },
    ],
  },
  {
    tag: "v1.3.4",
    title: "Toast notifications over native views, clean activity rail, and heartbeat optimization",
    date: "September 11, 2026",
    shortDate: "Sep 11",
    type: "patch",
    summary:
      "Toast notifications remain visible over embedded views, auxiliary items are cleaned from Code activity rail, and background heartbeat latency warnings are eliminated.",
    highlights: [
      "Embedded Code-OSS, browser preview, and testing views suspend during active toasts and notifications so alerts remain visible.",
      "Auxiliary bar items filtered out from the primary activity bar to prevent cluttering main rail navigation.",
      "Excluded routine lease heartbeats from slow RPC latency tracking and added concurrency guards to activity reporting.",
    ],
    categories: [
      {
        title: "Native Overlays & Notifications",
        items: [
          "Suspends native WebContentsViews when toasts are mounted so notifications are never occluded.",
          "Updated overlay selectors across Code host and testing previews.",
        ],
      },
      {
        title: "Workbench & Activity Rail",
        items: [
          "Secondary auxiliary bar items excluded from main activity rail.",
          "Deterministic ordering for custom activity bar extensions.",
        ],
      },
      {
        title: "RPC & Performance",
        items: [
          "Heartbeat RPC methods excluded from latency monitoring to avoid spurious slow request toasts.",
          "In-flight concurrency guard for client activity reporting.",
        ],
      },
    ],
    installers: [
      {
        platform: "macOS",
        arch: "Apple Silicon (M1/M2/M3/M4)",
        filename: "Tabs-1.3.4-arm64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.4/Tabs-1.3.4-arm64.dmg",
      },
      {
        platform: "macOS",
        arch: "Intel x64",
        filename: "Tabs-1.3.4-x64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.4/Tabs-1.3.4-x64.dmg",
      },
      {
        platform: "Windows",
        arch: "x64 installer",
        filename: "Tabs-1.3.4-x64.exe",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.4/Tabs-1.3.4-x64.exe",
      },
      {
        platform: "Linux",
        arch: "x64 AppImage",
        filename: "Tabs-1.3.4-x86_64.AppImage",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.4/Tabs-1.3.4-x86_64.AppImage",
      },
    ],
  },
  {
    tag: "v1.3.3",
    title: "Workspace skills, preview controls, and attachments",
    date: "September 10, 2026",
    shortDate: "Sep 10",
    type: "patch",
    summary:
      "Workspace-specific skill discovery and dispatch, direct browser preview controls, file attachments, and progressive desktop startup stability.",
    highlights: [
      "Discover and dispatch directory-aware skills for Claude, Cursor, Codex, OpenCode, Antigravity, and Grok with ranked fuzzy search.",
      "Added direct viewport resize handles, picture-in-picture, appearance emulation, and active session controls to the browser preview.",
      "General file attachments in composer, persistent prompt stashing, and paste mention preservation.",
      "Progressive Code-OSS workbench startup, secondary sidebar support, and multi-environment state isolation.",
    ],
    categories: [
      {
        title: "Skills & Slash Commands",
        items: [
          "Ranked skill search with source badges for app, repo, project, personal, and system skills.",
          "Directory-aware skill snapshots and native provider dispatch planning.",
        ],
      },
      {
        title: "Browser & Preview",
        items: [
          "Direct viewport resize frame with responsive presets.",
          "Theme appearance emulation, native picture-in-picture, and per-session audio controls.",
        ],
      },
      {
        title: "Composer & Desktop Stability",
        items: [
          "File attachments with provider upload support and persistent prompt stash.",
          "Progressive Code-OSS startup, secondary sidebar support, and effect remount preservation.",
        ],
      },
    ],
    installers: [
      {
        platform: "macOS",
        arch: "Apple Silicon (M1/M2/M3/M4)",
        filename: "Tabs-1.3.3-arm64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.3/Tabs-1.3.3-arm64.dmg",
      },
      {
        platform: "macOS",
        arch: "Intel x64",
        filename: "Tabs-1.3.3-x64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.3/Tabs-1.3.3-x64.dmg",
      },
      {
        platform: "Windows",
        arch: "x64 installer",
        filename: "Tabs-1.3.3-x64.exe",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.3/Tabs-1.3.3-x64.exe",
      },
      {
        platform: "Linux",
        arch: "x64 AppImage",
        filename: "Tabs-1.3.3-x86_64.AppImage",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.3/Tabs-1.3.3-x86_64.AppImage",
      },
    ],
  },
  {
    tag: "v1.3.2",
    title: "A steadier embedded editor",
    date: "September 9, 2026",
    shortDate: "Sep 9",
    type: "patch",
    summary:
      "A stability release that makes the shipped desktop workspace and its release validation path more dependable.",
    highlights: [
      "Stabilized the embedded Code OSS host and its startup path in the desktop app.",
      "Fixed a TypeScript declaration issue in the web application's atom registry so release validation can complete reliably.",
    ],
    categories: [
      {
        title: "Release scope",
        items: ["This release does not add a new end-user workflow."],
      },
    ],
    installers: [
      {
        platform: "macOS",
        arch: "Apple Silicon (M1/M2/M3/M4)",
        filename: "Tabs-1.3.2-arm64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.2/Tabs-1.3.2-arm64.dmg",
      },
      {
        platform: "macOS",
        arch: "Intel x64",
        filename: "Tabs-1.3.2-x64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.2/Tabs-1.3.2-x64.dmg",
      },
      {
        platform: "Windows",
        arch: "x64 installer",
        filename: "Tabs-1.3.2-x64.exe",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.2/Tabs-1.3.2-x64.exe",
      },
      {
        platform: "Linux",
        arch: "x64 AppImage",
        filename: "Tabs-1.3.2-x86_64.AppImage",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.2/Tabs-1.3.2-x86_64.AppImage",
      },
    ],
  },
  {
    tag: "v1.3.1",
    title: "Standalone installers and reliable updates",
    date: "September 5, 2026",
    shortDate: "Sep 5",
    type: "patch",
    summary:
      "Tabs now ships as a complete desktop installer for macOS, Windows, and Linux, with update manifests checked as part of every release.",
    highlights: [
      "Each installer includes the runtime it needs, so there are no separate dependencies to install.",
      "Release checks now validate the Windows and Linux update manifests before publishing.",
      "Code OSS packaging and window startup are more reliable in production builds.",
    ],
    categories: [
      {
        title: "Desktop & Distribution",
        items: [
          "Bundled native runtimes into standalone .dmg packages for macOS (separate Apple Silicon arm64 and Intel x64 builds).",
          "Generated verified NSIS installer (.exe) with differential blockmap for Windows x64.",
          "Produced universal Linux .AppImage with glibc 2.31+ binary compatibility.",
        ],
      },
      {
        title: "Updater & Lifecycle",
        items: [
          "Integrated in-app update checks for Windows and Linux with automated restart flow.",
          "Hardened native IPC bootstrap channel between Electron main process and background server daemon.",
        ],
      },
    ],
    installers: [
      {
        platform: "macOS",
        arch: "Apple Silicon (M1/M2/M3/M4)",
        filename: "Tabs-1.3.1-arm64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.1/Tabs-1.3.1-arm64.dmg",
      },
      {
        platform: "macOS",
        arch: "Intel x64",
        filename: "Tabs-1.3.1-x64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.1/Tabs-1.3.1-x64.dmg",
      },
      {
        platform: "Windows",
        arch: "x64 (Win 10/11)",
        filename: "Tabs-1.3.1-x64.exe",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.1/Tabs-1.3.1-x64.exe",
      },
      {
        platform: "Linux",
        arch: "x64 AppImage",
        filename: "Tabs-1.3.1-x86_64.AppImage",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.1/Tabs-1.3.1-x86_64.AppImage",
      },
    ],
  },
  {
    tag: "v1.3.0",
    title: "Code OSS, project tabs, browser tools, and remote workspaces",
    date: "September 5, 2026",
    shortDate: "Sep 5",
    type: "major",
    summary:
      "This release brings the editor, browser automation, remote environments, pull requests, and testing into the same project-based desktop workspace.",
    highlights: [
      "Use the embedded Code OSS editor with extensions, syntax support, and familiar keyboard shortcuts.",
      "Open URLs in browser tabs, inspect elements, record journeys, and turn them into Playwright tests.",
      "Connect through SSH or Tailscale while keeping terminals and Git commands scoped to the selected project.",
      "Review GitHub and GitLab pull requests with inline comments and merge controls.",
      "Generate, run, and review Playwright tests without leaving the project tab.",
    ],
    categories: [
      {
        title: "Code OSS Chrome & Editor",
        items: [
          "Replaced separate editor windows with a native Code OSS workbench embedded directly into the workspace rail.",
          "Surface extension views, webviews, and file trees in compact Tabs chrome.",
          "Synchronized active editor state, cursor locations, and themes with agent sessions.",
        ],
      },
      {
        title: "Agent Browser Automation Broker",
        items: [
          "Connected Chromium-based browser preview with bidirectional CDP automation broker.",
          "Visual DOM element inspection and locator discovery with automatic selector generation.",
          "Journey recording: automatically records user interactions into executable Playwright test scripts.",
          "Session recording with live automation diagnostics and video artifacts.",
        ],
      },
      {
        title: "Remote Environments & Connections",
        items: [
          "Desktop SSH gateway supporting password and key-based authentication with reconnect resilience.",
          "Tailscale transport support for zero-config mesh networking.",
          "Isolate workspace state, file watchers, and terminals by target project environment.",
        ],
      },
      {
        title: "AI Collaborators & Providers",
        items: [
          "Added GitHub Copilot provider driver with ACP and custom authentication configurations.",
          "Integrated Kilo, Droid, Antigravity, and OpenRouter model drivers.",
          "Real-time provider usage telemetry with token tracking and quota alerts.",
        ],
      },
      {
        title: "Git Workflows & PR Management",
        items: [
          "Full PR review workspace for both GitHub and GitLab repositories.",
          "Manage reviewers, labels, draft statuses, and branches directly in-app.",
          "Suspend inactive Git panel queries for optimal multi-tab CPU efficiency.",
        ],
      },
    ],
    installers: [
      {
        platform: "macOS",
        arch: "Apple Silicon (M1/M2/M3/M4)",
        filename: "Tabs-1.3.0-arm64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.0/Tabs-1.3.0-arm64.dmg",
      },
      {
        platform: "macOS",
        arch: "Intel x64",
        filename: "Tabs-1.3.0-x64.dmg",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.0/Tabs-1.3.0-x64.dmg",
      },
      {
        platform: "Windows",
        arch: "x64",
        filename: "Tabs-1.3.0-x64.exe",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.0/Tabs-1.3.0-x64.exe",
      },
      {
        platform: "Linux",
        arch: "x64 AppImage",
        filename: "Tabs-1.3.0-x86_64.AppImage",
        url: "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.0/Tabs-1.3.0-x86_64.AppImage",
      },
    ],
  },
  {
    tag: "v1.2.122",
    title: "Safer quit flow and steadier extension sessions",
    date: "August 12, 2026",
    shortDate: "Aug 12",
    type: "feature",
    summary:
      "Tabs now protects active work before quitting, restores project state more consistently, and starts Code OSS extensions more reliably.",
    highlights: [
      "Quit Confirmation Dialog: Custom non-native modal dialog safeguards active agent sessions and uncommitted file edits from accidental exit.",
      "Extension Host Stabilization: Resolved race condition during multiple extension host activations on cold launch.",
      "Tab Switching Responsiveness: Smoother tab transitions and reduced memory footprint during background tab hibernation.",
    ],
    categories: [
      {
        title: "Session & Tab Management",
        items: [
          "Implemented quit confirmation flow with modal to prevent data loss on exit.",
          "Refined tabs layout and session UI with smooth tab dragging and pinning.",
          "Lifecycle state preservation across workspace restarts.",
        ],
      },
      {
        title: "Extension Runtime",
        items: [
          "Fixed native Code OSS extension integration and webview assistant communication.",
          "Preserved structured output findings during agent tool invocation.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.121",
    title: "Synara Claude adapter and modular code audit engine",
    date: "August 5, 2026",
    shortDate: "Aug 5",
    type: "feature",
    summary:
      "Added native Claude provider support ported from Synara, paired with an automated code analysis engine for proactive workspace audits.",
    highlights: [
      "Integrated Synara Claude provider adapter with streaming tool calls and token metrics.",
      "Introduced modular audit engine running background code analysis passes.",
      "Added dashboard view for findings triage and one-click agent remediation.",
    ],
    categories: [
      {
        title: "Model Providers",
        items: [
          "Synced Claude protocol adapter with prompt caching and sub-agent handoffs.",
          "Added token metering and cost telemetry per workspace project.",
        ],
      },
      {
        title: "Audit & Analysis",
        items: [
          "Built multi-phase static inspection runner for TypeScript and Rust codebases.",
          "Surfaced diagnostic findings in the project rail alongside Git changes.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.120",
    title: "WebSocket review progress and reasoning controls",
    date: "August 4, 2026",
    shortDate: "Aug 4",
    type: "feature",
    summary:
      "Live WebSocket streaming for review progress, granular model reasoning budgets, and unified system dialog aesthetics.",
    highlights: [
      "Real-time WebSocket event streaming for background PR review jobs.",
      "Configurable reasoning effort levels (Low, Medium, High, Ultrathink).",
      "Unified modal design system replacing browser-native dialogs.",
    ],
    categories: [
      {
        title: "Review Streaming",
        items: [
          "Connected live server logs directly into PR review status views.",
          "Resilient auto-reconnect logic for interrupted WebSocket review feeds.",
        ],
      },
      {
        title: "Reasoning Controls",
        items: [
          "Exposed per-turn thinking budget sliders in composer settings.",
          "Persisted reasoning preferences by selected model tier.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.119",
    title: "More reliable structured agent responses",
    date: "August 4, 2026",
    shortDate: "Aug 4",
    type: "patch",
    summary:
      "Agent tools now receive validated structured responses more consistently, reducing failures caused by malformed data.",
    highlights: [
      "Reduced failures when an agent tool returns incomplete or malformed structured data.",
      "Improved consistency across agent providers when handling structured responses.",
    ],
    categories: [
      {
        title: "Response reliability",
        items: [
          "Validate structured tool responses before they reach the workspace.",
          "Report invalid responses consistently instead of failing later in the interaction.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.118",
    title: "Desktop IndexedDB storage migration and session cleanup",
    date: "August 3, 2026",
    shortDate: "Aug 3",
    type: "patch",
    summary:
      "Automated migration for Electron IndexedDB session storage, selecting latest mtime database ports without workspace disruption.",
    highlights: [
      "Resolved multi-instance storage collision during desktop database migrations.",
      "Cleaned up orphaned session records on background daemon startup.",
    ],
    categories: [
      {
        title: "Storage & Persistence",
        items: [
          "Migrated Electron IndexedDB session storage to newest mtime port.",
          "Pruned orphaned session data on background daemon startup.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.117",
    title: "Single tool toolbar optimization and zero-tool safeguard",
    date: "July 28, 2026",
    shortDate: "Jul 28",
    type: "patch",
    summary:
      "Streamlined toolbar layout when only one tool is active and added safety guards when no tools are configured.",
    highlights: [
      "Optimized compact toolbar layout for single active agent tools.",
      "Added zero-tool fallback indicator and empty-state guidance in toolbar UI.",
    ],
    categories: [
      {
        title: "Toolbar & Actions",
        items: [
          "Compact layout optimization when exactly one tool is active.",
          "Zero-tool fallback indicator and empty-state guidance in session toolbar.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.116",
    title: "Independent font preferences and Reset to Defaults UX",
    date: "July 27, 2026",
    shortDate: "Jul 27",
    type: "feature",
    summary:
      "Independent typography preferences with --font-display support, dynamic web font loader, and quick Reset to Defaults controls.",
    highlights: [
      "Configurable editor, UI, and display fonts with live preview.",
      "One-click Reset to Defaults for typography and theme customizations.",
      "Scoped CSS custom property injection for frictionless theme overrides.",
    ],
    categories: [
      {
        title: "Typography & Theming",
        items: [
          "Standalone Typography settings panel with --font-display support.",
          "Dynamic Google Fonts loader for selected display typefaces.",
          "One-click Reset to Defaults for themes and typography.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.114",
    title: "Embedded editor theme refinements and desktop integration",
    date: "July 27, 2026",
    shortDate: "Jul 27",
    type: "patch",
    summary:
      "Refined Code OSS dark theme contrast, fixed window title bar drag regions, and improved desktop bridge handshake.",
    highlights: [
      "Harmonized editor token colors with Tabs dark theme palette.",
      "Patched macOS titlebar drag region collision with custom tab rail.",
    ],
    categories: [
      {
        title: "Desktop & Editor Theme",
        items: [
          "Harmonized Code OSS dark theme tokens with workspace rail.",
          "Patched macOS titlebar drag region collision with custom tab rail.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.113",
    title: "Toolbar tools stale cache fix and provider stability",
    date: "July 27, 2026",
    shortDate: "Jul 27",
    type: "patch",
    summary:
      "Purged stale entries in the toolbar tools registry and improved MCP tool hot-reloading.",
    highlights: [
      "Fixed tool cache invalidation when MCP servers disconnect or reload.",
      "Prevented phantom tools from rendering in the active session action bar.",
    ],
    categories: [
      {
        title: "Tool Registry",
        items: [
          "Purged stale tool entries on MCP disconnect or reload.",
          "Prevented phantom tools from rendering in the active session action bar.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.112",
    title: "Language service build cleanup and CI preflight fixes",
    date: "July 26, 2026",
    shortDate: "Jul 26",
    type: "patch",
    summary:
      "Cleaned up build lifecycle scripts to eliminate TypeScript compiler preflight errors in continuous integration.",
    highlights: [
      "Streamlined monorepo typecheck pipeline across web and server workspaces.",
      "Accelerated CI preflight verification time by 30%.",
    ],
    categories: [
      {
        title: "Build & CI",
        items: [
          "Streamlined monorepo typecheck pipeline across web and server workspaces.",
          "Removed effect-language-service patch script causing preflight build errors.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.111",
    title: "Browser collapsed state persistence and header tooltips",
    date: "July 26, 2026",
    shortDate: "Jul 26",
    type: "patch",
    summary:
      "Persisted browser panel collapsed states across sessions and prevented header tooltips from clipping window borders.",
    highlights: [
      "Saved browser drawer visibility to local workspace preferences.",
      "Repositioned floating header tooltips to ensure they never overflow screen boundaries.",
    ],
    categories: [
      {
        title: "Browser & Header UI",
        items: [
          "Saved browser drawer visibility to local workspace preferences.",
          "Repositioned floating header tooltips to ensure they never overflow screen boundaries.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.110",
    title: "Animation frame stubs and test suite reliability",
    date: "July 26, 2026",
    shortDate: "Jul 26",
    type: "patch",
    summary:
      "Polyfilled requestAnimationFrame and cancelAnimationFrame in headless test environments to ensure zero test flakiness.",
    highlights: [
      "Deterministic test runs under bun:test runner.",
      "Eliminated headless DOM timing discrepancies in UI unit tests.",
    ],
    categories: [
      {
        title: "Test Infrastructure",
        items: [
          "Deterministic test runs under bun:test runner.",
          "Eliminated headless DOM timing discrepancies in UI unit tests.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.109",
    title: "Browser navigation loop guard and URL normalization",
    date: "July 26, 2026",
    shortDate: "Jul 26",
    type: "patch",
    summary:
      "Guard against infinite browser reloads with automatic URL normalization and isSameWebUrl comparison check.",
    highlights: [
      "Prevented rapid reload cycles when navigating client-side hashed routes.",
      "Normalized trailing slashes and default protocols for browser tabs.",
    ],
    categories: [
      {
        title: "Browser Engine",
        items: [
          "Prevented rapid reload cycles when navigating client-side hashed routes.",
          "Normalized trailing slashes and default protocols for browser tabs.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.108",
    title: "Browser toolbar expansion and default workspace URL resolution",
    date: "July 26, 2026",
    shortDate: "Jul 26",
    type: "patch",
    summary:
      "Added toolbar expansion controls for the embedded browser and automatic dev server URL detection on project boot.",
    highlights: [
      "Expanded browser chrome view with zoom controls and console toggle.",
      "Auto-detected running Vite and Next.js dev server ports.",
    ],
    categories: [
      {
        title: "Browser Chrome & Discovery",
        items: [
          "Expanded browser chrome view with zoom controls and console toggle.",
          "Auto-detected running Vite and Next.js dev server ports.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.105",
    title: "Persisted startup animation settings and UI efficiency",
    date: "July 26, 2026",
    shortDate: "Jul 26",
    type: "patch",
    summary:
      "Respected user preferences for startup animations and reduced initial rendering cost during cold launch.",
    highlights: [
      "Added toggle to disable startup splash animations for immediate editor focus.",
      "Optimized DOM reconciliation during session restoration.",
    ],
    categories: [
      {
        title: "Preferences & Performance",
        items: [
          "Added toggle to disable startup splash animations for immediate editor focus.",
          "Optimized DOM reconciliation during session restoration.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.104",
    title: "High contrast theme-based project tabs styling",
    date: "July 25, 2026",
    shortDate: "Jul 25",
    type: "feature",
    summary:
      "Introduced high-contrast project tab indicators with custom status markers and active border highlights.",
    highlights: [
      "Crisp visual separation for multiple concurrently active project tabs.",
      "Added high-contrast theme support for improved outdoor visibility.",
    ],
    categories: [
      {
        title: "Tabs Rail Design",
        items: [
          "Crisp visual separation for multiple concurrently active project tabs.",
          "Added high-contrast theme support for improved outdoor visibility.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.103",
    title: "Universal dynamic model discovery and remote catalog registry",
    date: "July 25, 2026",
    shortDate: "Jul 25",
    type: "feature",
    summary:
      "Dynamic model catalog discovery pulling latest provider models on demand with auto-refresh guards.",
    highlights: [
      "Auto-populated model pickers with newly released LLM models without requiring app updates.",
      "Rate-limiting protection on startup catalog synchronization.",
    ],
    categories: [
      {
        title: "Model Catalog Registry",
        items: [
          "Auto-populated model pickers with newly released LLM models without requiring app updates.",
          "Rate-limiting protection on startup catalog synchronization.",
        ],
      },
    ],
  },
  {
    tag: "v1.2.102",
    title: "Chat UI and composer redesign",
    date: "July 25, 2026",
    shortDate: "Jul 25",
    type: "feature",
    summary:
      "Rebuilt chat interface with expandable multi-line composer, file tag autocompletion, and visual model badge chips.",
    highlights: [
      "Redesigned conversational stream with markdown formatting and collapsible code blocks.",
      "Fuzzy file search `@mention` autocompletion directly in the prompt input.",
      "Added model token count estimators and cost previews.",
    ],
    categories: [
      {
        title: "Chat & Composer",
        items: [
          "Redesigned conversational stream with markdown formatting and collapsible code blocks.",
          "Fuzzy file search `@mention` autocompletion directly in the prompt input.",
          "Added model token count estimators and cost previews.",
        ],
      },
    ],
  },
];
