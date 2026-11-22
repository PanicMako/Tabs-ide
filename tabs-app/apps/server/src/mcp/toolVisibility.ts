/**
 * Removes tools from a `tools/list` response body (JSON or SSE) so an agent does not see tools it
 * cannot use: desktop control while its Labs switch is off, the teammate tools outside a
 * teammate's own chats. Bodies that do not parse pass through. Hiding is advertising only; every
 * tool still refuses an unauthorized call itself.
 */
export function hideTools(
  body: string,
  contentType: string,
  isHidden: (toolName: string) => boolean,
): string {
  const strip = (text: string) => {
    let payload: { result?: { tools?: Array<{ name?: unknown }> } };
    try {
      payload = JSON.parse(text);
    } catch {
      return text;
    }
    const tools = payload.result?.tools;
    if (!Array.isArray(tools)) return text;
    payload.result!.tools = tools.filter(
      (tool) => typeof tool.name !== "string" || !isHidden(tool.name),
    );
    return JSON.stringify(payload);
  };
  return contentType.includes("text/event-stream")
    ? body
        .split("\n")
        .map((line) => (line.startsWith("data:") ? `data: ${strip(line.slice(5).trim())}` : line))
        .join("\n")
    : strip(body);
}
