import DataRecoverySettings from "./DataRecoverySettings";

/** This screen deliberately imports no router, auth shell or workspace stores. */
export default function DataRecoveryScreen({ error }: { error: string }) {
  return (
    <main className="h-full overflow-y-auto bg-background p-6 text-foreground">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-lg font-normal">Recover your Tabs workspace</h1>
        <p role="alert" className="whitespace-pre-wrap text-sm text-muted-foreground">
          {error}
        </p>
        <DataRecoverySettings />
      </div>
    </main>
  );
}
