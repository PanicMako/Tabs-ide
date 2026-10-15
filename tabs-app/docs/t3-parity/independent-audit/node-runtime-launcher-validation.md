# Node runtime and compatibility launcher

HEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9. Four new files447lines fully read. Fresh12/12,1.45s session28804 terminal0. Runtime tests exercise real temp copies/links, fresh retry cache, self-script versus simulated SEA, missing PATH guidance and simulated Windows EXE-only wrapper rejection. They do not launch Electron, real SEA binaries or native Windows. Generic runtime tests use a device feature label but no Labs/device operations or implementations reviewed.

Launcher test writes emitted script and fixture executable in a temp package tree, actually forks it, roundtrips IPC, preserves arguments with spaces and forwards SIGTERM to yield exit23. Covers POSIX; Windows skipped by design. No malformed IPC/child spawn failure/disconnect/grandchild test. Source generator retains @t3code package names; searched scripts have no generator consumer, so build/package integration remains unverified rather than inferred from green fixture.

Self-invocation consumers exist in V2 ACP registry/Grok adapters; selected AcpAdapterV2 680–710 injects command/entrypoint arguments and ELECTRON_RUN_AS_NODE=1, credentials in env. HostProcessIsExecutable selected70–100 defaults to checkIsSea. Full host-process detection and packaged hidden-command behavior remain open. No new defect confirmed.
