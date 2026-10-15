# CLI uninstall review

Batch295: Full222-line source and37-line test reviewed. One native temporary filesystem test passed1.26s/exit0, verifying only own-home launcher is claimed and foreign/plain launchers excluded. Plan selects service only when installedBaseDir matches home; removal leaves userdata out of deletion paths, requires interactive confirmation or --yes, stops service before launcher/runtime removal. No uninstall was executed.

Windows branch schedules detached cmd cleanup after a fixed ping delay rather than waiting for parent exit, does not observe removal success, and the Effect.try handles synchronous spawn exceptions only; asynchronous child errors have no explicit listener. These paths lack Windows runtime proof. Ownership is checked during planning, with no identity recheck before removal; concurrent replacement remains untested. Native service implementation and config-selected home semantics remain separate audit obligations.
