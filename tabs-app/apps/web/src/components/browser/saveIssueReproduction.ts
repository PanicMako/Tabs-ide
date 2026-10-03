import type { IssueReproduction } from "./RecordIssueDialog";

interface ReproductionDestination {
  cwd: string;
  writeFile?: (input: { cwd: string; relativePath: string; contents: string }) => Promise<unknown>;
  dispatch?: (reproduction: IssueReproduction) => Promise<void>;
}

/** A retry uses the same immutable reproduction and command identity. */
export async function saveIssueReproduction(
  reproduction: IssueReproduction,
  destination: ReproductionDestination,
): Promise<void> {
  if (
    !destination.cwd.trim() ||
    !destination.writeFile ||
    !destination.dispatch ||
    !reproduction.taskId ||
    !reproduction.specPath
  )
    throw new Error(
      "A project directory, available task, and write/dispatch services are required.",
    );
  await destination.writeFile({
    cwd: destination.cwd,
    relativePath: reproduction.specPath,
    contents: reproduction.generatedCode,
  });
  await destination.writeFile({
    cwd: destination.cwd,
    relativePath: `tests/e2e/reproductions/${reproduction.id}.json`,
    contents: JSON.stringify(
      {
        ...reproduction,
        steps: reproduction.steps.map((step) =>
          step.action === "fill" || step.action === "selectOption"
            ? { ...step, value: undefined }
            : step,
        ),
      },
      null,
      2,
    ),
  });
  await destination.dispatch(reproduction);
}
