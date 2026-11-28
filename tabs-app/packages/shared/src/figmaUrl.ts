const EDITORS = ["design", "file", "proto", "board", "slides", "site"] as const;
const FILE_KEY = /^[\w-]{1,128}$/u;
const SIMPLE_NODE_ID = /^\d{1,16}(?:-|:)\d{1,16}$/u;

export function isFigmaHostname(hostname: string): boolean {
  return hostname === "figma.com" || hostname === "www.figma.com";
}

/** Figma shares a branch as /design/<main file>/branch/<branch key>/<name>. */
export function figmaFileLocation(url: URL) {
  if (!isFigmaHostname(url.hostname.replace(/\.$/u, ""))) return null;
  const [, route, mainFileKey, segment, branchKey] = url.pathname.split("/", 6);
  const editor = EDITORS.find((candidate) => candidate === route);
  if (!editor || !mainFileKey || !FILE_KEY.test(mainFileKey)) return null;

  let suffix: string;
  try {
    suffix = decodeURIComponent(segment ?? "");
  } catch {
    return null;
  }
  if (suffix.startsWith("branch/")) return null;
  const fileKey = suffix === "branch" ? branchKey : mainFileKey;
  if (!fileKey || !FILE_KEY.test(fileKey)) return null;

  const [nodeId, ...duplicateNodes] = url.searchParams.getAll("node-id");
  return {
    editor,
    mainFileKey,
    fileKey,
    nodeId:
      nodeId && duplicateNodes.length === 0 && SIMPLE_NODE_ID.test(nodeId)
        ? nodeId.replace("-", ":")
        : null,
    branchParameters: url.searchParams.getAll("branch-id"),
  };
}

/** Canvas writes require a selected, editable Design node with one explicit ID. */
export function figmaDesignSelection(url: URL) {
  if (url.protocol !== "https:" || url.username || url.password || !isFigmaHostname(url.host))
    return null;
  const location = figmaFileLocation(url);
  if (
    !location?.nodeId ||
    (location.editor !== "design" && location.editor !== "file") ||
    location.branchParameters.some((key) => key !== location.fileKey)
  )
    return null;
  return { mainFileKey: location.mainFileKey, fileKey: location.fileKey, nodeId: location.nodeId };
}
