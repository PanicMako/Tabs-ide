# Hello Tabs development extension

Start Tabs desktop in development mode. Open Settings > Extensions > Discover,
choose **Load development folder**, and select this directory. In Installed,
enable the tool globally or for a project. The **Hello** entry appears in that
project's toolbar and fills the workspace area when selected.

This experimental format is UI-only. Its JavaScript runs in an isolated
Chromium view without Node, direct network access, or a privileged host bridge.
The `project` and `profile` URL parameters are display context, not credentials.
Named profiles isolate browser storage. This example requests no privileged
capabilities; other examples exercise the host broker. See `docs/extensions.md`
and the website's `/developers/extensions` guide for the SDK, package workflow,
and experimental Exchange installation requirements. Official public publishing
is not open yet.
