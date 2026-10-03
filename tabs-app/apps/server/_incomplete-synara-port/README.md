# Incomplete Synara provider port

This directory quarantines unfinished Synara-derived scaffolding that is not
part of the Tabs server runtime or TypeScript build.

The archived files reference provider infrastructure that Tabs does not yet
implement, including Antigravity, Pi, Factory Droid, agent-gateway credentials,
provider discovery, and runtime-event persistence modules. They must not be
moved back under `src` until the shared provider foundation exists and the port
has complete adapters, contracts, registration, and tests.

The active provider runtime is assembled by `apps/server/src/serverLayers.ts`
from the drivers registered in
`apps/server/src/provider/builtInDrivers.ts`.
