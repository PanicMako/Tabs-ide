# Hello Tabs development extension

Start Tabs desktop in development mode. Open Settings > Extensions > Discover,
choose **Load development extension**, and select this directory. In Installed,
enable the tool globally or for a project. The **Hello** entry appears in that
project's toolbar and fills the workspace area when selected.

This experimental format is UI-only. Its JavaScript runs in an isolated
Chromium view without Node, direct network access, or a privileged host bridge.
The `project` and `profile` URL parameters are display context, not credentials.
Named profiles currently isolate browser storage; account APIs and public
package installation are not available yet.
