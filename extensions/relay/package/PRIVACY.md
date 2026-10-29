# Relay data and privacy

Relay 0.1.0 has no network service, analytics, telemetry, AI integration, credentials, or workspace/file broker access. It requests no Tabs capabilities.

Notes, folders, templates, board columns, preferences, project logos, Trash, and drafts use Chromium localStorage in the extension's assigned Tabs profile. Attachment payloads use IndexedDB in the same browser partition. Shared profiles deliberately share their notebook across Tabs projects; project-isolated profiles keep browser storage separate. Relay's internal projects are notebook collections and are not automatically synchronized with Tabs workspace projects.

Uploaded project logos are reduced to at most 256×256 pixels and saved locally as PNG. Attachments are limited to 5 MB each and 12 per note. Storage can fill up: Relay reports failed writes and cancels folder deletion if the resulting state cannot be saved.

Moving a folder to Trash preserves its notes, attachments, and folder structure. Permanent deletion removes the Trash records and attempts to remove attachment payloads not referenced elsewhere; this is not secure erasure. Existing backups can retain copies. Uninstalling or clearing browser profile data can remove local writing. Keep backups outside the application.

Full JSON backups include Trash and attachment payloads. The current Tabs extension host has no file-save broker, so Relay provides selectable/copyable export text. Save that text to a .json file. Restore uses a local file picker and replaces the active notebook after an explicit review. Logo and attachment data never leave the device unless you copy or share an export yourself.
