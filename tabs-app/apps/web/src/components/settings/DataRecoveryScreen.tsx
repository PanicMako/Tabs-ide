import DataRecoverySettings from "./DataRecoverySettings";

/** This screen deliberately imports no router, auth shell or workspace stores. */
export default function DataRecoveryScreen({ error }: { error: string }) {
  return (
    <main className="flex min-h-dvh h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full flex-1 max-w-2xl flex-col justify-center gap-8 px-6 py-12 sm:px-8">
        <header className="space-y-3">
          <h1 className="text-2xl font-medium tracking-tight">Recover your Tabs workspace</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Tabs could not finish the backup required to open your workspace safely. Startup is
            paused before your saved data is opened.
          </p>
        </header>
        <section aria-labelledby="recovery-cause" className="space-y-2 rounded-xl bg-muted/50 p-5">
          <h2 id="recovery-cause" className="text-sm font-medium">
            What stopped startup
          </h2>
          <p
            role="alert"
            className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
          >
            {error}
          </p>
          <p className="text-sm leading-relaxed">
            Restart to retry the backup. If the same error returns, another restart will not resolve
            it; keep these details for troubleshooting.
          </p>
        </section>
        <DataRecoverySettings recovery className="p-0 sm:p-0" />
      </div>
    </main>
  );
}
