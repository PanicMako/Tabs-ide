# Changelog

All notable changes to Tabs IDE will be documented in this file.

## [v2.9.0] - 2026-11-22

### Meet Notch, your AI teammate, plus session search, worktree cleanup and computer use

Tabs 2.9.0 adds Notch, an optional AI teammate that hands code work to normal Tabs threads and tracks it for you. It also adds search across your past agent sessions, evidence-based worktree cleanup, terminal quick commands, optional computer use for agents, and a new set of themed menus, dropdowns and scrollbars.

### What changed

- **Notch, your AI teammate**: Turn on Settings → Labs → Teammates and a teammate named Notch is created. Rename it, or add more teammates, each with its own personality, memory, model and schedule. Manage them in Settings → Teammates.
- **Workers and a Teammates space**: Ask a teammate for code work and it starts a worker, a normal Tabs thread in its own worktree, then tracks it as to do, working, needs you, done or dropped. The Teammates space holds the chat and the item list.
- **Up next suggestions**: A teammate can look around your projects on a schedule, read-only, and post suggestions. Start one to turn it into a worker, or dismiss it. Look around now runs it on demand.
- **Memory and soul**: Each teammate keeps a SOUL.md and a MEMORY.md that you can read and edit, and you can forget individual memories. Everything stays on your machine and uses your own agent subscriptions.
- **Notch avatar**: The teammate appears as the Tabs mascot that you can drag anywhere in the window. It shows idle, thinking, working, waiting for you, happy, upset or asleep, and you can hide it.
- **Session search**: Search past Claude Code, Codex, Gemini and OpenCode sessions on this machine from the Command Palette or Quick Actions, filtered by agent, folder or date. Enter resumes the session in a terminal, and Cmd/Ctrl Enter copies the resume command. It is off until you turn on Settings → Labs → Session search, and nothing is uploaded.
- **Worktree cleanup**: In Settings → Workspace Maintenance, see each old agent worktree with its last activity, size, uncommitted files, unpushed commits and pull request state. Tabs removes only what you select, after a confirmation, and keeps worktrees with unsaved or unpushed work unless you relax the rules.
- **Terminal quick commands**: Save commands in Settings → Terminal Commands, optionally per project and with or without a trailing Enter, then run them in your active terminal from the terminal toolbar, the Command Palette or Quick Actions.
- **Computer use for agents**: Let an agent read and control native desktop apps through accessibility, with snapshots, clicks, typing, scrolling, drags and window screenshots. It is off by default, only full-access threads can use it, and agents cannot type into password fields. Turn it on in Settings → Labs → Computer use and use Check permissions to see what is missing.
- **Themed controls**: Dropdowns, menus and scrollbars now follow your theme instead of using the system look, including the right-click and spellcheck menus.
- **Settings navigation**: The Settings sidebar is regrouped so every page fits without scrolling.
- **Antigravity Gemini 3.8 Flash**: The thinking level you pick now takes effect and shows as level dots in the model picker.
- **Startup and close animation**: The splash and close screens now show the Tabs mascot and wordmark drawn as a dot pattern that prints in on startup and breaks apart on close, replacing the previous walking and bedtime animations. Animations settings now list the animation typeface as a simple list.

### Upgrade notes

- Notch, Session search and Computer use are Labs features and stay off until you turn them on.
- On macOS, computer use needs Tabs allowed under System Settings → Privacy & Security → Accessibility, plus Screen Recording for screenshots. On Windows it needs PowerShell, and on Linux it needs python3 with AT-SPI and xdotool.

## [v2.8.1] - 2026-11-20

### Tabs opens in seconds again, and you can arrange providers and favorite models

Tabs 2.8.1 fixes the long launch that kept the Dock icon bouncing for a minute or more after updating, and on the first launch of each day. It also lets you drag providers into your own order, brings a cleaner Pinned models list, and adds optional per-provider favorites to the model picker.

### What changed

- **Fast launch**: The data backup Tabs takes before opening now copies only what changed, so the step that held launch for about two minutes takes about a second. Keeping many old backups no longer slows down every launch.
- **Quicker first load**: The app's settings and editor list arrive sooner on a busy machine instead of waiting on each check in turn.
- **Arrange your providers**: In Settings → Providers, press a provider and drag it, or use its handle with Space and the arrow keys. Tabs remembers the order, keeps new providers at the end and offers Reset order.
- **Pinned models**: Pins are one ordered list that matches the model picker, with drag to reorder, unpin on each row, a note when a pinned model is no longer offered, and one-click suggestions when nothing is pinned yet. The Pin a model dialog groups models by provider.
- **Favorites first (optional)**: Turn on Favorites first in a provider's Models settings, star models in the picker, and that provider's tab lists your favorites first with the rest behind Show more. It is off unless you turn it on.
- **Everything from 2.8.0**: 2.8.0 was not published on its own, so this release also brings its seven new themes, curved Quick Actions menus, blank browser settings, message box formatting shortcuts, the redesigned Usage and Limits page and the faster interface.

### Upgrade notes

- The first launch after updating can take up to about half a minute while Tabs converts its existing data backups. Every launch after that is fast.

## [v2.8.0] - 2026-11-20

### New themes, curved Quick Actions, composer formatting and a redesigned Usage page

Tabs 2.8.0 adds seven new themes, curved Quick Actions menus with a configurable blank browser, Markdown formatting shortcuts in the message box, a redesigned Usage and Limits page with Antigravity quota, and a faster, snappier interface.

### What changed

- **New themes**: Graphite, Ultraviolet, Acid, Cyberdeck, Redline, Paper and Fog join the theme picker, and the embedded editor follows them.
- **Curved Quick Actions menus**: Sub-menus follow the edge of the ring, with a setting to switch back to plain cards.
- **Blank browser settings**: Choose whether a blank browser opens empty, on Google, on DuckDuckGo or on your own address, and keep its controls open on a blank page.
- **Message box formatting**: Press Cmd/Ctrl B, I or E to make the selection bold, italic or inline code, and press again to undo it.
- **Usage and Limits redesign**: A new activity chart, a rebuilt Usage tab, a clearer Limits page and Antigravity quota reported alongside the other providers.
- **Faster interface**: Animations and the startup splash run noticeably quicker, and the panel animation setting has a new live preview.
- **Side chats and surfaces**: Surfaces that cannot open are disabled with the reason, and a side chat explains why it cannot start from a draft thread.
- **Fixes**: Image attachments stay on inherited conversation turns, and Agents opens on a fresh thread when there is nothing to resume.

## [v2.7.0] - 2026-11-18

### Companion surface, Antigravity provider, and robust thread orchestration

Tabs 2.7.0 introduces the companion surface with an embedded web browser and interactive omnibox, native integration for Google Antigravity with local ACP and quota telemetry, enhanced Cursor adapter v2 error reporting, thread context handoffs, local speech transcription models, and expanded workspace layout controls.

### What changed

- **Companion Surface & Embedded Browser**: An integrated companion pane featuring an interactive omnibox browser, start page, multi-view diff layouts, terminal panels, and swift surface switching.
- **Google Antigravity Provider**: Native support for Google Antigravity including automatic CLI discovery, local ACP protocol bridging, OAuth credential handling, and realtime quota telemetry.
- **Cursor Adapter V2**: Modernized Cursor driver integration with structured run failure reporting and recovery diagnostics.
- **Orchestration V2 Services**: File system checkpoint capture, restore safety verification, instant rollback mechanics, thread branching, and context handoffs across sessions.
- **Composer & Prompt Stash**: Persistent prompt stashing surviving restarts, sequential message queueing during active turns, and extensible composer sheet controls.
- **Side Chats & Multi-Agent Splits**: Drag-and-drop agent split panes and auxiliary side-chat panels for running parallel sub-agent workflows.
- **Voice Dictation & Custom Dictionary**: Local transcription services with download management for speech models, custom dictionary vocabulary, and external speech app detection.
- **Git & Pull Request Workflows**: Redesigned branch toolbar with search filtering, linked PR conversation threads, and integrated code review thread cards.
- **Settings & Navigation Ergonomics**: Streamlined provider addition flow, motion duration controls, token pricing overrides, and hierarchical settings navigation with history stack.

## [v2.6.0] - 2026-11-16

### Overmind and Ultrathink banners, Ultracode toggle, and redesigned context meter

Tabs 2.6.0 introduces animated banners for Overmind and Ultrathink, combined Overmind and Ultrathink workflows, an Ultracode option toggle, a redesigned context window meter, illuminated sidebar thread guides, and improvements to project actions and workspace layout.

### What changed

- **Overmind Composer Banner**: An interactive dotted canvas banner with a sparkle strip, goal chip, worker model picker, and direct `/overmind` prompt command handling.
- **Ultrathink Composer Banner**: An animated ripple wash visualizer with radial ripple wave effects and a hairline frame for deep-reasoning sessions.
- **Combined Overmind & Ultrathink**: Run Overmind planning and sub-tasks with Ultrathink enabled simultaneously; start messages cleanly separate thinking instructions from Overmind directives.
- **Ultracode Toggle**: Switch Ultracode reasoning via a toggle in the model picker, supported across both modern and legacy Claude provider adapters with live mid-thread updates.
- **Redesigned Context Window Meter**: A popover breakdown showing token usage, context limits, and token budgets at a glance.
- **Workspace Header & Layout**: Mounted status banners inside the workspace body to ensure constant-height window headers, and integrated the Look pane for quick wallpaper customization.
- **Sidebar Thread Guides**: Visual branching rails illuminate the active path down to nested threads and sub-agent helpers, with distinct helper badges and refreshed icons.
- **Project Actions & Settings**: Redesigned project actions into a settings list with options for setup hold, settle lifecycle triggers, and preview auto-open.

## [v2.5.0] - 2026-11-15

### More agents, pull request review guides, and richer wallpapers

Tabs 2.5.0 adds new agent providers, a review guide for pull requests, a fuller pull request panel, and more control over wallpapers.

### What changed

- Add Kiro, Fx and Muse as agent providers alongside the ones you already use.
- Open a generated review guide on a pull request to see what changed and where to look first.
- Filter and group the pull request list, react to pull requests, and see link previews inline; pull requests from other code hosts get their own panel.
- Tune your wallpaper with new Wallpaper Labs controls, and keep text readable over it.
- Get guided through setup with a refreshed onboarding flow and a clearer usage view across providers.
- On Windows, agent-supplied network share paths are no longer opened, so Tabs will not sign in to remote hosts on your behalf.
- Connect features are now called Tabs Connect throughout the app and command line.

## [v2.4.1] - 2026-11-13

### The built-in editor is now VS Code 1.146

Tabs' Code tab now runs on the latest VS Code (1.146), so you get its newest editor, terminal and extension improvements while your Tabs layout and styling stay exactly as they were.

### What changed

- Work in the Code tab on VS Code 1.146, the current upstream editor, with its latest editing, terminal and extension updates.
- Keep the Tabs look: the rounded sidebar, editor, terminal and chat cards, the activity rail and the Tabs theme colors carry over unchanged.
- Keep Markdown Editor and Preview, notebooks, the integrated browser and the terminal working as before, now on the new editor.

## [v2.4.0] - 2026-11-12

### Quick glances, a smoother browser preview, and extensions that can restyle Tabs

Check your limits, answer waiting agents and flip common settings straight from Quick Actions, without leaving the conversation you are in. The browser preview no longer blanks out or stretches under its menus, and extensions can now add themes, Command Palette entries and launcher shortcuts.

### What changed

- Open Usage & limits, Waiting for you, While you were away and Quick toggles from Quick Actions as panels inside the launcher, with the full pages one click away.
- See every agent question and approval from all your projects in one list, and jump straight to the conversation that needs you.
- Come back after a break to a short summary of what finished, what failed and what is waiting, project by project.
- Send a page's console error to the agent from the browser toolbar, with the message, its source and the page attached.
- See pages as they load instead of an empty frame: a progress line runs under the address bar and Reload becomes Stop while a page loads.
- Keep the browser page on screen while its menus are open: no more "Preview hidden" notice, stretched snapshots or slow returns.
- Pick device sizes from a redesigned View menu with device tiles, orientation, zoom steps, appearance and audio controls.
- Watch the startup board finish every card, pause for a beat, then see your workspace rise from the bottom; the mascot now finishes under the TABS flag.
- Install extensions that add color themes, Command Palette entries and Quick Actions shortcuts (extension API 1.9).
- Extension tools now line up correctly when Tabs is zoomed, stay visible behind menus, and load reliably.
- Try resting idle project browsers in Labs, after anything from 30 minutes to a week, to give back memory; pages return to where they were when you switch back.

## [v2.3.2] - 2026-11-11

### Quick Actions Studio, Agent CLI surface, and faster startup

Organize and customize quick actions with an interactive arranger, switch between chat and agent CLI surfaces, and launch package scripts directly from Dock. Development startup is also noticeably quieter and faster.

### What changed

- Arrange and reorder Quick Actions with the new visual arranger, create custom actions, and configure sub-actions directly in Settings.
- Switch between conversation chat and dedicated Agent CLI views within threads to monitor long-running terminal and tool activity.
- Run detected package scripts and suggested commands directly from Dock Launchpad with clear execution feedback.
- Enjoy an updated startup experience with the Tabs mascot animation and refined splash transitions.
- Speed up development startup by building ESM-only during local development, eliminating duplicate CommonJS compilation and noisy warning outputs.
- Direct external links to appropriate browser profiles and windows with refined link target routing.

## [v2.3.1] - 2026-11-09

### A more personal workspace

Themes makes it easier to build a palette and preview how your toolbar will look in the workspace. Wallpaper controls and installed extension settings are easier to scan.

### What changed

- Create palettes with randomized colors, check contrast, and delete saved palettes you no longer use. Import a theme from a file or pasted JSON, or export your current theme.
- Browse seven toolbar styles in your current theme before applying one. Aurora follows your accent color, Frosted Lens gives the active tool a glass highlight, and Focus Pull softens the surrounding tools.
- See which wallpaper is active, browse the redesigned gallery, and add images from your computer or a URL. Manage workspace and per-thread wallpapers from one settings page.
- See where an installed extension is enabled and find its accounts, project profiles, credentials, and updates in separate sections.
- Read smaller workspace toolbar labels and icons. On the Welcome screen, the New Tab outline joins the tab strip on both sides.

## [v2.3.0] - 2026-11-08

### Guided workspace setup and a refreshed editor

Start with a project and follow a hands-on tour of Tabs. The embedded editor now runs Code OSS 1.145.0 and restores Markdown editing and preview in the installed app.

### What changed

- Open or create a local project, or clone into the current tab using a Git URL or a supported host such as GitHub or GitLab.
- Explore Code, Dock, Git, and Browser at your own pace. Minimize the tour while you work and click the Tabs mascot to resume.
- Follow optional setup through saving a Browser tab, Terminal tab, or Dock preset. The tour also walks through Quick Actions and shows where to connect a coding agent.
- Turn off Quick Actions without losing your layout or shortcuts. Longer labels wrap inside the action wheel.
- Edit thread titles from the thread list or conversation header. Titles are trimmed and blank titles are rejected.
- Switch between Text Editor, Markdown editing, and Preview. The embedded browser stays with its owning project when you switch tools.

## [v2.2.2] - 2026-11-03

### Quick Actions refinements and smaller editor caches

Quick Actions makes searching and temporary clipboard items easier to manage. This update also reduces accumulated editor caches and improves backup recovery.

### What changed

- Use the refreshed Quick Actions search panel, clearer action icons, and updated radial layouts.
- Work with the updated temporary clipboard and manage kept browser and terminal tools from Workspace settings.
- Get clearer backup and recovery controls, including separate feedback for refreshing snapshots and retrying startup.
- Create backups when runtime sockets or temporary pipes are present in application data.
- Reclaim legacy editor resource caches automatically and prevent the embedded editor from retaining separate resource and JavaScript disk caches for every project.
- Improve Windows update extraction when packaged files are checked through virtual directories.

## [v2.2.1] - 2026-11-02

### Quick actions and temporary workspace tools

Open frequent actions beside your pointer, keep scratch browsers and terminals organized, and manage worktrees and storage from Settings. This release also improves Windows installation and fixes logo selection on Windows.

### What changed

- Choose Halo Fade, Glass Dial, or Pie Sectors for Quick Actions, with configurable shortcuts beside each action and highlights that follow its color.
- Open Quick Actions from the editor, browser, or terminal with Command-Option-K on macOS or Ctrl-Alt-K on Windows and Linux. The workspace remains visible beneath the blurred overlay.
- Create temporary browser and terminal tabs, then rename, configure, keep, hide, or remove them from Workspace settings. Closing a tab asks for confirmation.
- Paste text, links, and images into Clipboard, search recent items, and pin snippets to keep on your device.
- Inspect Git worktrees and application storage, open isolated workspaces, and clean eligible logs with protection for checkouts that contain local work.
- Open agent conversations in separate windows and return them to the workspace.
- Use clearer settings navigation and a compact editor for configuring Quick Actions shortcuts.
- Install and upgrade Windows with a smaller bundled editor payload and better handling of running app processes.
- Apply the selected logo treatment to Windows window and taskbar icons and existing Tabs shortcuts.

## [v2.2.0] - 2026-11-01

### A refreshed workspace for code and agents

Tabs brings a more cohesive Code workspace together with richer agent controls, project scripts, local commit drafting, and data recovery. This release also refreshes theme and typography collections and reduces work during desktop startup.

### What changed

- Switch between Run, Git, and Agents in Workspace Actions, with remembered sections and a layout that adapts to your chat pane.
- Follow agent relationships, fork work into another conversation, and bring results back into the parent thread.
- Discover project scripts and inspect linked pull requests from the workspace, with clearer readiness and checkout behavior.
- Work in the updated Code OSS 1.143 editor with a wider Go to file control, connected tabs, coordinated panel corners, and more restrained menus, tooltips, and notifications.
- Draft commit messages with a local Ollama model and choose the model in settings.
- Review saved Tabs data backups and restore compatible snapshots from the recovery settings.
- Browse refreshed theme and typography collections and preview combinations before applying them.
- Reach the workspace sooner as optional services and startup resources load when needed.
- Explore the website's new interactive footer and updated product presentation.
- See refreshed response rail animations, clearer branch menus, and updated Dock interaction styling.
- Use keyboard shortcuts more reliably during startup and switch focus between embedded editor and chat inputs more consistently.

### Upgrade notes

Local commit drafting requires Ollama and a downloaded model, such as `qwen3:1.7b`. Tabs data backups cover application data, not project source files outside Tabs.

macOS builds are not Apple Developer ID signed or notarized. After attempting to open a downloaded build, use System Settings → Privacy & Security → Open Anyway.

## [v2.1.0] - 2026-10-25

### A new identity for Tabs

Tabs has a new app icon and five distinctive treatments, with desktop sizing that fits more comfortably beside other applications. This release also refreshes typography controls, the Mac installation guide, and the website introduction.

### What changed

- Choose Blueprint, Daybreak, Carbon Copy, Moonstone, or Afterglow in Themes, or follow your system appearance from General settings.
- Use corrected icon spacing on macOS, with transparent margins in Windows and Linux exports too.
- Explore saved typography mixes, separate interface and editor font choices, and updated appearance controls.
- Follow the refreshed drag-to-Applications guide in the Mac installer.
- Meet the new mascot in the website introduction: its eyes look around and follow a loose piece into place.
- Find consistent new branding across the desktop app, website, Exchange header, browser icons, and shared-link previews.

### Upgrade notes

macOS builds are not Apple Developer ID signed or notarized. After attempting to open a downloaded build, use System Settings → Privacy & Security → Open Anyway.

## [v2.0.4] - 2026-10-25

### A more cohesive Code workspace

Tabs refines the embedded editor, chat panels, workspace icons, and typography controls. Switching the Code toolbar between Tabs Agent and GitHub Copilot now closes the previous chat surface.

### What changed

- Keep one Code toolbar chat provider open at a time when switching between Tabs Agent and GitHub Copilot.
- Bring connected assistant tabs, rounded built-in controls, and more comfortable Chat spacing to the Code workspace.
- Blur the full Code workspace behind native dialogs, including its toolbar and activity rail, while keeping the dialog clear.
- Match the editor status bar and settings control to the workspace theme, including when the window loses focus.
- Add expressive workspace tool icons and animations, with larger Dock artwork.
- Expand local font choices and heading presets, with live typography previews in appearance settings.
- Add a clearer drag-to-Applications layout to the Mac installer.

### Upgrade notes

macOS builds are not Apple Developer ID signed or notarized. After attempting to open a downloaded build, use System Settings → Privacy & Security → Open Anyway.

## [v2.0.3] - 2026-10-23

Tabs 2.0.3 introduces ten distinctive, handcrafted typography presets across the setup experience and workspace, alongside upstream Code-OSS editor engine updates for enhanced performance and rendering stability.

### What changed

- Personalize workspace aesthetics with ten bespoke typography pairings featuring Halo Grotesk, Nauryz Redkeds, Exotica, Mantranaga 36dot, Angst, Equilla, Deserta, Arck, Darker Grotesque, Moche, Urbanist, Sato Sans, Rebel Type Dog, Neutral Face, Hashira Mt, Stigma, and Sun Seed.
- Preview typography selections live in the setup walkthrough with accurate weights, optical sizes, and integrated open font licensing.
- Upgrade the embedded Code-OSS editor engine with upstream improvements to editor rendering, platform services, and workbench contributions.
- Improve Agent Sessions layout responsiveness and titlebar appearance during multi-pane navigation.

### Upgrade notes

macOS builds are ad-hoc signed and update via the built-in preview updater. When opening a fresh manual download on macOS for the first time, use System Settings → Privacy & Security → Open Anyway.

## [v2.0.2] - 2026-10-21

Tabs 2.0.2 upgrades the embedded Code-OSS editor runtime to VS Code 1.142.0 with complete native host coordination, refines the startup experience with a full tile sequence and smooth reveal, resolves cold-launch authentication timing, and ensures approved extensions remain available with automatic metadata renewal.

### What changed

- Upgrade the embedded Code-OSS runtime to VS Code 1.142.0, supporting active editor state coordination, cancellation-aware native ZIP archiving, and GPU compositing detection.
- Preserve new-session composer drafts and reveal targets across Agents window handoffs while keeping focus-only window reuses undisturbed.
- Allow the airport flip-board animation to complete its full tile settle and highlight sequence before smoothly sliding upward to reveal the ready workspace.
- Synchronize startup loading concurrently behind the splash screen so elapsed animation time never fakes readiness, and respect reduced-motion preference changes.
- Wait for the local backend listener before initiating desktop authentication, eliminating cold-start connection-refused errors and reconnect delays.
- Keep approved extensions continuously available with automatic metadata renewal across sleeping and waking servers.
- Display verified publisher seals and expanded click targets on marketplace extension cards.

### Upgrade notes

macOS builds are ad-hoc signed and update via the built-in preview updater. When opening a fresh manual download on macOS for the first time, use System Settings → Privacy & Security → Open Anyway.

## [v2.0.1] - 2026-10-20

Tabs 2.0.1 refines extension tools with package icons, per-project workspace tool visibility, restored Git staging actions, and verified Linux desktop backend startup.

### What changed

- Manage installed extensions with package logos, detail previews, and installation review in the Extensions settings view.
- Choose which extension tools appear in the workspace toolbar for each project from Project Workspace Settings.
- Remember the selected extension tool across project switches, and retry extension tool panels safely if an error occurs.
- Stage and unstage files reliably with restored Git staging controls and acknowledged action progress in the Git workspace.
- Start the bundled workspace backend reliably on Linux AppImage installations.
- Package native dependencies accurately for each target desktop architecture.

### Upgrade notes

macOS builds are ad-hoc signed and update via the built-in preview updater. When opening a fresh manual download on macOS for the first time, use System Settings → Privacy & Security → Open Anyway.

## [v2.0.0] - 2026-10-16

Tabs brings conversations, queued work, project tools and source control into a shared workspace. This release also introduces the Exchange developer ecosystem and more focused appearance controls.

### What changed

- Download large macOS updates without a two-minute total limit, and resume interrupted downloads after retrying.
- Restore Git actions and account operations, repository cloning, keybinding imports and support-bundle export in the connected workspace.
- Apply the selected audit mode, depth and folder scope to AI reviews, with findings marked as unverified for your review.
- Schedule queued messages, edit their delivery time, reorder them, or send them next from the conversation's Queue panel.
- Use companion panels to keep files, browser pages and pull requests alongside agent conversations.
- Navigate a redesigned Git workspace with dedicated views for changes, history, branches and accounts.
- Try Interface Study in Labs across the app, or enable Settings page only and choose its light or dark appearance independently of your workspace theme.
- Open Tabs Exchange from the website to browse developer documentation and download extension development tools. Public publishing remains disabled during the pilot.
- Get clearer startup guidance when a workspace database belongs to an incompatible build. Supported legacy upgrades preserve conversation history, and development uses a separate default data directory.
- Fix Intel Mac and Linux startup when the desktop app hands settings to the bundled workspace backend.

### Upgrade notes

This refreshed 2.0.0 replaces the initial 2.0.0 download. If you already installed 2.0.0, download and install the refreshed installer manually; the version number is unchanged. Users on 1.3.34 whose in-app download times out should also use the manual installer.

This release updates the workspace runtime and database schema. Back up your Tabs data before upgrading; older builds may not be able to open a database upgraded by Tabs 2.0. Keep the backup if you need to return to an earlier version.

Extension authors: check that `engines.tabs` includes `2.0.0`, test your extension, then repack it. Existing packages restricted to Tabs 1.x will remain incompatible until their authors publish an updated package.

macOS builds are not Apple Developer ID signed or notarized. After attempting to open a downloaded build, use System Settings → Privacy & Security → Open Anyway.

## [v1.3.34] - 2026-10-05

### Refined setup typography and interactive workspace previews

Tabs refines onboarding headings with balanced typography, and the site now showcases an interactive manifesto covering supported coding agents, web tools, and project tabs.

### What changed

- Onboarding wizard screens use semibold Syne headings for balanced contrast and clear reading hierarchy.
- The marketing website adds an interactive workspace manifesto highlighting 11 supported agent providers, integrated web tools, and custom CLI workflows with scroll-linked reveal animations.
- Project continuity previews demonstrate how Code OSS, agent conversations, development servers, and live browser previews coordinate across project tabs.
- Documentation clarifies pseudonymous installation metrics with a clear environment opt-out and outlines provider authentication options.

### Upgrade notes

macOS builds are not Apple Developer ID signed or notarized. After attempting to open a downloaded build, use System Settings → Privacy & Security → Open Anyway.

## [v1.3.33] - 2026-10-05

### A clearer welcome to Tabs

Setup now offers a simpler introduction, an interactive preview of the workspace, and larger app icon choices. New installations use Solari Grid animations in Monochrome.

### What changed

- Explore miniature Code, Agents, Launchpad, Git, and Browser views with a tab for each example project.
- See how to add websites or terminal commands to your toolbar and keep the tools you use.
- Choose an app icon and appearance in refreshed setup screens with Syne headings. Finishing setup opens Themes for further customization.
- Setup keeps its header clear of native macOS and Windows window controls, including at smaller window sizes.
- New installations use Solari Grid with the Monochrome palette for startup and close animations. Saved animation choices remain unchanged.
- Windows installation and updates refresh Desktop and Start menu shortcuts so they point to the installed application.

### Upgrade notes

macOS builds are not Apple Developer ID signed or notarized. After attempting to open a downloaded build, use System Settings → Privacy & Security → Open Anyway.

## [v1.3.32] - 2026-10-05

### Basic usage analytics and clearer Source Control

Tabs adds basic installation activity metrics alongside updated Git icons and Source Control typography.

### What changed

- Basic usage analytics counts daily active installations using a random installation identifier, OS, architecture, and app version.

- Git tool icons in the workspace shell and onboarding wizard now display the GitHub mascot for immediate visual recognition.
- The Source Control sidebar header now includes the GitHub icon and renders repository names with your configured UI font and clean uppercase tracking.
- The download and release resolver dynamically surfaces the latest desktop builds across release channels.

### Upgrade notes

macOS builds are not Apple Developer ID signed or notarized. After attempting to open a downloaded build, use System Settings → Privacy & Security → Open Anyway. The macOS updater preserves quarantine; its independent update signature does not replace Apple approval.

## [v1.3.31] - 2026-10-03

### Public Beta: clearer defaults and privacy

Tabs is a desktop workspace for coding with agents, an embedded Code-OSS editor,
Launchpad terminals, Git, and a browser. This public beta is in active development;
expect bugs and rough edges. Feedback and reproducible bug reports are welcome.

### What changed

- Folders with spaces or special characters open correctly in the embedded
  editor, including empty project folders.
- Connection-error logs no longer include authenticated WebSocket URLs.
- Tabs-owned analytics is off by default. Explicit opt-in uses a random Tabs
  installation identifier instead of a provider account identifier.
- Testing starts hidden in new workspaces. Existing explicit Testing preferences
  remain intact; Workspace settings still offers it as Early access.
- Ordinary workspace actions and icons use neutral foregrounds. Filled primary
  controls retain their accent with contrast-aware text.
- Downloads support complete public-beta prereleases and retain update-metadata
  validation. Beta installs can discover later beta updates.
- Desktop trust checks restrict privileged calls and remote popout navigation.
  Diagnostic exports redact sensitive fields before serialization.
- About includes beta identity, a bug-report link, and basic diagnostic copying.

### Upgrade notes

macOS builds are not Apple Developer ID signed or notarized. After attempting
to open a downloaded build, use System Settings → Privacy & Security → Open Anyway.
Building from source is an alternative. The macOS updater preserves quarantine;
its independent update signature does not replace Apple approval.

Provider authentication remains separate. Do not share credentials, private
source, prompts, cookies, or sensitive terminal output in reports.

## [v1.3.30] - 2026-10-02

### GSAP surface animations, redesigned browser profiles, and workspace settings polish

Tabs introduces smooth entrance motion for dialogs, popovers, menus, and settings views, refines the browser profiles settings layout with streamlined session management, and enhances workspace settings and window control alignment.

### What changed

- **Smooth surface entrance animations**: Popups, dialogs, dropdown menus, sheets, and settings surfaces now animate into view smoothly with GSAP while strictly respecting user reduced-motion preferences.
- **Redesigned browser profiles settings**: Browser profiles now feature a cleaner header layout, simplified session cards, direct website launch actions, and clearer partition management.
- **Workspace settings and tab bar insets**: Modernized section headers in workspace settings, and added smooth transitions for native window control insets in the project tab bar.

## [v1.3.29] - 2026-10-01

### Code-OSS 1.140 and clearer runtime information

Tabs updates its embedded editor to Code-OSS 1.140.0 and shows the selected editor runtime version in Settings → About. Project tabs now use the space reported by native window controls on macOS and Windows; Linux keeps its system title bar outside the tabs.

### What changed

- **Embedded editor update**: Code-OSS 1.140.0 is included with Tabs.
- **Editor version in About**: Troubleshooting can distinguish the Tabs application version from the embedded Code-OSS runtime version.
- **Window-control spacing and themes**: Tabs follow native control geometry, and Windows caption symbols follow light and dark themes.
- **Updated GitHub links**: Website, downloads, update helpers and model catalog references use the PanicMako account.

## [v1.3.28] - 2026-09-29

### Development state isolation, preserved workspace configs, and reactive typography

- **Desktop development state isolation**: Development launches now use a dedicated state directory, keeping local development sessions separated from your production profiles and caches.
- **Workspace configuration preservation during reset**: Local data reset flows now preserve active workspace configuration files alongside editor runtime data and settings.
- **Immediate typography and theme reactivity**: Font family, heading font, and custom theme adjustments apply instantly across all open views without requiring a page reload.

## [v1.3.27] - 2026-09-28

### Orphaned provider process cleanup and theme typography combination persistence

- **Detached provider process watchdog**: Adds a process watchdog to monitor local provider servers, terminating detached provider process groups cleanly if the Tabs backend process exits unexpectedly.
- **Font combination preference persistence**: Selected typography presets in Themes settings now take precedence when restoring saved configurations, preventing older client font settings from reverting your active font combo.
- **Development instance and provider process cleanup**: Stale development instance termination now tracks complete process groups and cleans up orphaned OpenCode and Kilo server instances across worktrees.

## [v1.3.26] - 2026-09-28

### Font picker selection highlight and persistent typography synchronization

- **Font picker selection highlight**: Selecting a preset font combination or choosing individual interface and editor fonts in Themes settings now immediately displays the active selection highlight.
- **Typography settings synchronization**: Font family choices now synchronize directly to the persistent settings store alongside font size preferences, ensuring your active typography state remains consistent across restarts.

## [v1.3.25] - 2026-09-28

### Packaged desktop font rendering, editor font synchronization, and dynamic provider models

- **Packaged desktop font rendering**: Resolved cross-origin asset restrictions when loading local application fonts in packaged desktop builds, ensuring custom UI fonts render cleanly.
- **Embedded editor font synchronization**: Updated editor typography settings so font family and code font size preferences apply immediately to the embedded Code-OSS editor and persist across restarts.
- **Dynamic provider model discovery**: Provider model menus now rely strictly on live provider capability snapshots, keeping available models accurate and up to date.
- **Reliable offline font selections**: Curated the font picker to bundled local typefaces so your selected typography renders consistently with or without network access.

## [v1.3.24] - 2026-09-27

### Local data reset, batch keybindings restore, and renderer responsiveness diagnostics

- **Local data reset in About settings**: Easily reset Tabs cached data, conversation history, and local profile state directly from Settings while safely preserving your Git worktrees and editor runtime.
- **Batch restore for default keybindings**: Restoring default shortcuts now removes all custom keybindings in a single atomic operation, preventing partial resets or delays.
- **Renderer responsiveness diagnostics**: Added real-time tracking of input delay, main-thread long tasks, and presentation latency to the Diagnostics panel to help identify UI slowdowns.
- **Deep-linking and notification permission polish**: Settings sections now synchronize with URL search parameters for direct navigation, and notification toggles display clear pending states during system authorization.

## [v1.3.23] - 2026-09-25

### Vibrant setup wizard wallpapers, filmstrip dock, and modal portaling

- **Vibrant onboarding wallpaper selection**: The first-run welcome wizard now filters wallpaper options to bright daytime and sunset anime scenes, ensuring striking visual contrast against the dark-glass interface.
- **Horizontal filmstrip dock in setup**: Enabled the quick-access horizontal wallpaper shelf in the welcome wizard header, letting you preview and switch scenes without opening the full-screen modal.
- **Portaled wallpaper gallery dialog**: Updated the full-screen wallpaper gallery modal to mount directly to the document root, eliminating overlay clipping and dialog stacking conflicts.

## [v1.3.22] - 2026-09-25

### Interactive onboarding sandbox, wallpaper gallery, and system icon theme

- **Interactive onboarding sandbox**: The welcome wizard now includes a hands-on prototype sandbox where you can explore project presets, inspect agent tools, and preview workspace capabilities before opening your first repository.
- **Atmospheric wallpaper gallery**: Added a gallery of 30 curated high-resolution wallpapers across scenic, pastel, and anime aesthetics with an interactive preview modal and custom wallpaper controls.
- **System desktop icon theme**: The application icon theme setting now includes a System option that automatically matches your operating system appearance alongside fixed light and dark icons.
- **Streamlined desktop runtime staging**: Refined bundled runtime asset verification to ensure consistent Code-OSS runtime packaging across desktop platforms.

## [v1.3.21] - 2026-09-24

### Launchpad command dashboard and preset icon customization

- **Launchpad command hub**: Rebranded the Server tool to Launchpad to better reflect running development servers, background tasks, worker processes, and database consoles in one place.
- **Preset icon picker**: Added 12 curated icon choices for Launchpad presets, including frontend, backend, database, worker, terminal, and build workflows.
- **Automatic icon detection**: Presets intelligently suggest matching icons as you type their label, such as frontend web, backend API, database, worker queue, or build tasks.
- **Backward-compatible settings migration**: Project configurations automatically map existing server presets and tool labels to Launchpad while preserving commands, working folders, and preview URLs.

## [v1.3.20] - 2026-09-24

### Expanded external editor integration and refined workspace controls

- **Expanded external editor discovery**: Added automatic executable detection for JetBrains IDEs (IntelliJ IDEA, WebStorm, PyCharm, GoLand, CLion, Rider, RustRover, PhpStorm, DataGrip, DataSpell, Aqua, RubyMine), Trae, Kiro, VS Code Insiders, and VSCodium across macOS, Windows, and Linux.
- **Dedicated editor brand icons**: Integrated official brand iconography for all supported external editors and system file managers in the Open In menu.
- **Refined split-button header controls**: Replaced standard button groupings in the chat header and Git actions toolbar with cohesive split-button controls featuring descriptive tooltips and smooth dropdown menus.
- **Thread hover action bar**: Added quick-access floating actions to sidebar thread items for pinning, settling, and snoozing threads without opening full context menus.
- **Thread search counters**: Updated sidebar filter tabs to display dynamic match counts for active, settled, snoozed, and archived threads when searching.

## [v1.3.19] - 2026-09-24

### Improved user message readability and layout in chat

- **Left-aligned message text**: User message text is now aligned to the left within its right-docked message block, ensuring list items, headers, and wrapped lines start cleanly from the margin.
- **Relaxed line spacing**: Upgraded prompt line height to relaxed spacing, matching the composer and providing visual breathing room for multi-line prompts and code snippets.
- **Preserved right-side accent framing**: Maintained the signature right-side vertical accent border and docked placement while eliminating awkward jagged right-aligned line wrapping.

## [v1.3.18] - 2026-09-24

### Faster and more reliable desktop update installation

- **Near-instant restart to install**: Downloaded updates are now pre-staged in the background while you continue working, making the restart-to-install action nearly instantaneous.
- **Eliminated update stalls**: Removed redundant multi-gigabyte re-verification steps during installation that previously caused desktop updates on macOS and Linux to freeze or take tens of minutes.
- **Actionable error reporting**: Staging and preparation failures now surface as clear, retryable error messages before restarting, preventing the app from getting stuck in an indefinite restart loop.
- **Smooth macOS relaunch**: Automatically clears macOS download quarantine attributes during update staging to prevent launch interruptions after installing.

## [v1.3.17] - 2026-09-24

### Polished update release notes dialog

- **Dedicated dialog close control**: Added a clear close button to the update notes window alongside escape and backdrop dismiss options.
- **Enhanced release notes presentation**: Centered the update dialog with larger readable typography, a version badge, and a blurred backdrop.
- **Reliable release data delivery**: Switched download manifests and release notes caching to prevent rate limits and ensure update details are immediately visible.

## [v1.3.16] - 2026-09-23

### More recoverable desktop updates

- **macOS update recovery**: If replacing the app fails, Tabs restores the previous app from its backup.
- **Linux AppImage recovery**: Tabs keeps the previous AppImage until the replacement starts successfully and restores it if the update fails.
- **Windows upgrades**: The installer closes processes running from the existing Tabs installation before replacing its files, without closing unrelated processes elsewhere.

## [v1.3.15] - 2026-09-22

### Centered release notes dialog with dedicated close control

- **Centered release notes dialog**: Replaced the edge-anchored popover with a spacious, centered modal dialog that gives release notes plenty of reading room across all display sizes.
- **Dedicated close button**: Added an accessible top-right close button with an X icon, complementing keyboard escape and backdrop click to dismiss.
- **Scroll-faded changelog panel**: Added a smooth, scroll-faded reading panel so you can easily browse long update notes while keeping titles and close actions anchored.

## [v1.3.14] - 2026-09-22

### Reliable settings drafts and input saving

- **Workspace draft isolation**: Editing custom browser tabs, terminal tabs, or server presets keeps your in-progress changes isolated until you choose to save or cancel, preventing unrelated actions from committing dirty drafts.
- **Debounced input persistence**: Settings text fields automatically debounce updates during typing and flush immediately on blur, Enter, or when closing the application.
- **Clean theme preview rollback**: Exploring and customizing colors in the Theme Studio safely reverts back to your previous theme if you exit or cancel without applying changes.
- **Early Access brand refinements**: Refreshed brand typography and visual aurora liquid effects across buildwithtabs.com.
- **Keybindings batch importing**: Improved stability and validation when importing custom keybinding configurations.

## [v1.3.13] - 2026-09-21

### In-app desktop updates and release notes preview

- **In-app macOS preview updates**: macOS preview builds now verify and install updates in place, with automatic cryptographic signature and checksum verification.
- **Release notes preview in the sidebar**: Hover over the update button or check About settings to review what changed before downloading or restarting.
- **Clear download progress**: See real-time download percentage directly in the update button tooltip and About settings.
- **Updated website and documentation**: Fresh product screenshots, social cards, and updated release documentation on buildwithtabs.com.

## [v1.3.12] - 2026-09-20

### Work with two agent threads side by side

- **Open a second conversation**: Drag a thread to either side, choose "Open to the side" from its menu, or Alt-click it.
- **Keep each conversation separate**: Each pane has its own draft, attachments, message position, and review view.
- **Follow both responses**: Agent replies continue updating in both panes while you work.
- **Adjust the layout**: Drag the divider, double-click to split the space evenly, or resize it with the keyboard. On narrow windows, Tabs shows one thread at a time with a quick way to switch.
- **Start a fresh thread**: "New Thread" opens in the active pane without closing the other conversation.

## [v1.3.11] - 2026-09-20

### Smoother startup and more reliable saved sessions

- **Smoothed startup animation**: Paced the Solari tile cascade with a relaxed 160ms letter stagger, 250ms scramble lead-in, and a 1.8s hold time.
- **Desktop partition persistence**: Proactively flushes in-memory session cookies and cache partitions before application shutdown, preventing session state loss on exit.
- **Workspace settings**: Improved how existing settings are carried forward when Tabs updates its local storage format.
- **Linux user data**: Tabs can find data from older Linux configuration locations when you update.
- **Reduced motion accessibility**: Honored user accessibility preferences across all core dialog primitives (Alert Dialog, Command Palette, Dialog, and Sheet).
- **Bundled self-contained desktop installers**: Maintained full self-contained desktop packages across macOS (Apple Silicon & Intel), Windows x64, and Linux x64 bundling the complete Code-OSS runtime directly.

## [v1.3.10] - 2026-09-18

### Easier keyboard entry in the time picker

- **Two-digit time entry**: You can type hours such as 11 or 12 without the picker jumping away after the first digit.
- **Scroll selection**: The displayed time now stays in step with the picker wheel while scrolling.

## [v1.3.9] - 2026-09-17

### Desktop installers include the editor

- **Install and launch**: macOS, Windows, and Linux packages contain the editor runtime instead of fetching it on first launch.
- **Startup reliability**: Fixed a dependency issue that could stop the packaged app from opening.

## [v1.3.8] - 2026-09-16

### Updated editor and workspace controls

- **Embedded editor**: Updated the Code workspace with changes from VS Code 1.138.
- **Workspace controls**: Refined the layout, prompt stash, and message queue panels.
- **Time and notification settings**: Improved time picker input and notification preferences.

## [v1.3.7] - 2026-09-16

### Notification history and scheduling improvements

- **Notification system & history panel**: Added a dedicated Notifications History drawer with category filtering, sound/badge settings, auto-dismiss duration controls, and full synchronization with the desktop native overlay.
- **Schedule popover & time picker typing overhaul**: Added modern backdrop blur styling to schedule dialogs and completely overhauled time picker input mechanics—eliminating drum wheel scroll fighting and hour input sticking to provide seamless, intuitive keyboard numeric entry.
- **Prompt stash & message queue panels**: Introduced prompt staging and queue management panels to organize and sequence agent commands without interrupting ongoing execution streams.
- **Session cleanup**: Ending an agent conversation now stops its background updates more reliably.
- **Dynamic Codex reasoning effort & Grok fallback**: Enabled support for dynamic, server-reported reasoning effort levels across models and added resilient fallback routing for Grok model configurations.
- **Theme heading font support**: Added custom `headingFont` selection in Theme Studio with full export/import and system font synchronization.

## [v1.3.6] - 2026-09-15

### Native view notification overlay, persistent editor views, and accessible modal dialogs

- **Topmost native notification overlay**: Embedded Code-OSS, browser preview, and testing web contents views no longer detach or flicker when toasts appear. A dedicated Electron `WebContentsView` overlay managed by the new `NativeViewStackCoordinator` renders notifications seamlessly above native surfaces.
- **Typed notification IPC & focus restoration**: Added typed IPC channels for notification syncing and action dispatching. User interactions with toasts now restore focus to the previously active native editor or web view.
- **Accessible dialogs**: Replaced browser popups with Tabs dialogs across Git reviews, Theme Studio, browser profiles, testing, and settings.
- **UI & styling polish**: Fixed input decoration and icon z-indexing across dark and light themes, modernized select dropdowns in testing journey recorders, and tightened review thread actions.

## [v1.3.5] - 2026-09-14

### Antigravity protocol, collaborative browser engine, PR stacks, and streaming performance

- **Antigravity protocol integration**: Added native Antigravity protocol support with interactive approval options, optimized server logging, and resilient provider streams.
- **Collaborative browser engine**: Implemented real-browser session and cookie import, profile-scoped permissions, passkey capability reporting, CDP operation serialization, human takeover preemption, side-by-side comparison replay, and refined custom tab controls.
- **Pull request stacks & reviews**: Manage and navigate GitHub PR stacks directly from Tabs, link agent threads to PRs, inspect status checks and metadata, view inline review annotations, and edit PRs with provider awareness.
- **Streaming & timeline performance**: Dramatically improved streaming responsiveness with incremental markdown parsing, resumable incremental syntax highlighting, DOM stabilization for streaming code lines, and bounded live timeline rendering.
- **Settings & workspace resilience**: Split heavyweight settings sections into lazy loading panels, made configuration persistence failures recoverable, added keybinding configuration, and preserved per-project active tools across navigation.
- **Composer & chat enhancements**: Added a full prompt stashing workflow, structured workspace file references with review context, assistant citations, and response quoting.

## [v1.3.4] - 2026-09-11

### Toast notifications over native views, clean activity rail, and heartbeat optimization

- **Notification visibility over native views**: Embedded Code-OSS, browser preview, and testing web contents views now temporarily suspend when toasts and notification dialogs are active, ensuring alerts are never occluded underneath native surfaces.
- **Clean Code activity rail**: Filtered out auxiliary bar items from the primary activity bar to keep custom extensions and assistants organized without cluttering main rail navigation.
- **Background heartbeat optimization**: Excluded routine client activity and host power state lease heartbeats from slow RPC latency tracking, avoiding spurious slow request alerts.
- **Concurrency control for activity reporting**: Prevented concurrent overlapping activity lease requests during bursts of user interactions.

## [v1.3.3] - 2026-09-10

### Workspace skills, preview controls, and attachments

- **Workspace skills & slash commands**: Discover and dispatch directory-aware skills for Claude, Cursor, Codex, OpenCode, Antigravity, and Grok with ranked fuzzy search and source badges.
- **Collaborative browser preview**: Added direct viewport resize handles, picture-in-picture, dark/light appearance emulation, per-session audio controls, persistent navigation history, and active session clearing.
- **Composer & attachments**: Added support for general file attachments, persistent prompt stashing, mention preservation when pasting prompts, and dismissible provider warnings.
- **Workbench & desktop stability**: Progressive Code-OSS workbench startup, secondary sidebar and auxiliary bar extension support, workbench preservation across remounts, and cross-environment state storage isolation.
- **Notifications & performance**: Passive toast deduplication window, suppression of replayed keybindings alerts, and deferred native editor services.

## [v1.3.2] - 2026-09-09

### A steadier embedded editor

- Stabilized the embedded Code OSS host and its startup path in the desktop app.
- Fixed a TypeScript declaration issue in the web application's atom registry so release validation can complete reliably.

## [v1.3.1] - 2026-09-05

### Standalone bundled installers

- Shipped self-contained bundled desktop installers for macOS (Apple Silicon & Intel), Windows, and Linux.
