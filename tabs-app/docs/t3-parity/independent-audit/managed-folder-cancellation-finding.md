# Named folder survives cancellation before project registration

ManagedProjectFolders.createNamedProject cleanup onExit covers scaffoldRepository and UUID allocation. Once those finish, projects.create has only tapError cleanup. An interruption during registration does not run that typed-error handler, leaving an unowned completed repository folder. This contradicts the service contract stating cancellation before the project exists removes the folder.

Independent diagnostic uses actual Git init/add/commit, actual temporary filesystem and memorySQLite ProjectService. A wrapper suspends create before any registration and signals a Deferred; interrupting the actual createNamedProject fiber leaves projects.snapshot empty but projects/registration-cancel present. Fresh Node24:1failed,13skipped,4.38s session81570 terminal1. Fixture preserved here; restore to apps/server/src/project/ for its original relative imports. Temp directory removed by outer test scope after assertion.

Scope: confirmed cancellation boundary defect with deliberately gated registration, not proof of production interruption incidence. After accepted registration an interrupt must preserve the owned folder; a repair needs to distinguish ownership/outcome rather than unconditional deletion. Existing cancellation test only holds git init, before this boundary. Production unchanged.
