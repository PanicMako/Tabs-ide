## Relay puts Quick Actions saves in All notes

Relay 0.2.1 brings quick notes, to-dos, and reminders into the project notebook on compatible Tabs development builds. Open Relay to find what you saved and pick up where you left off.

### What changed

- See notes and to-dos saved with `@relay` at the top of **All notes**, marked **via @relay**. Pin an item to find it again in **Pinned**.
- Open **Ask** to jot down a reminder or hand a larger request to a Tabs agent. Use **From agents** to review items added to your project notebook.
- Check the version published on Exchange from the terminal. Download `relay-version.mjs` below and run `node relay-version.mjs`.

### Upgrade notes

- The archive requires a Tabs development build with extension API 1.11 and Agent notebook support. Load it using **Settings → Extensions → Discover → Load local package**, then enable Relay for your project.
- Exchange installations update through the signed Exchange channel. The local archive uses a separate profile. Export a Relay backup before switching sources and choose **Retain local data and profiles** if you uninstall the Exchange copy.
