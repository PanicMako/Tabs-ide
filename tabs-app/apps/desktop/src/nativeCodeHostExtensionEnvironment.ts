/** Bind extension process identity to the main process's registered owning window. */
export function resolveNativeCodeExtensionEnvironment(
  responseWindowId: number,
  environment: NodeJS.ProcessEnv | undefined,
  projectsByWindow: ReadonlyMap<number, string>,
): NodeJS.ProcessEnv {
  const projectId = projectsByWindow.get(responseWindowId);
  if (!projectId) throw new Error("Extension host requires a registered project window");
  return { ...environment, TABS_PROJECT_ID: projectId };
}
