# Server configuration boundary

Batch328: Complete282-line config source reviewed. Tabs service namespace/OTLP identity, dev versus explicit userdata paths, statev2.sqlite, secrets/cache/log paths and startup directory sweep traced. Runtime config types retain both legacy authToken and newer devAuthToken; types alone do not validate runtime inputs (CLI loader reviewed separately). staticDir prefers bundled client/index.html then web/dist by existence; errors become absent. Test config defaults separate web mode and no desktop descriptors. Prior native temp-path tests reused rather than repeated.

DesktopTelemetryReceiver345–465 partial inspection: control writes serialized by semaphore, encoding then writeAllToFileDescriptor, failures degrade health. Full receiver source/test remains pending; no complete credit. compile cache flush caller serverRuntimeStartup654 found.
