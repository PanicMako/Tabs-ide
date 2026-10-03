import type {
  TestingLocatorDiscoverySession,
  TestingLocatorPreviewSnapshot,
} from "@tabs/contracts";
import { TESTING_LOCATOR_DOM_FUNCTION } from "@tabs/shared/testingLocatorDom";

export function locatorPageForCapture(result: TestingLocatorDiscoverySession) {
  return result.library.pages.find((page) => page.urlPattern === result.currentUrl);
}

export function normalizeLocatorUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Enter an HTTP or HTTPS URL.");
  }
  return url.href;
}

export function locatorPreviewSnapshot(value: unknown): { url: string; snapshot: string } {
  const result = value as {
    url?: string;
    loading?: boolean;
    accessibilityTree?: {
      nodes?: Array<{ ignored?: boolean; role?: { value?: string }; name?: { value?: string } }>;
    };
  };
  if (!result?.url || result.loading)
    throw new Error("Wait for the preview to finish loading, then scan again.");
  const nodes = result.accessibilityTree?.nodes;
  if (!nodes?.length)
    throw new Error("The preview did not return an accessibility tree. Try scanning again.");
  return {
    url: normalizeLocatorUrl(result.url),
    snapshot: nodes
      .filter((node) => !node.ignored && /^[a-z]+$/i.test(node.role?.value ?? ""))
      .map((node) => `- ${node.role!.value} ${JSON.stringify(node.name?.value ?? "")}`)
      .join("\n"),
  };
}

export async function captureTestingPreview(
  projectId: string,
): Promise<TestingLocatorPreviewSnapshot | undefined> {
  const bridge = window.desktopBridge;
  if (!bridge) return undefined;
  const snapshot = locatorPreviewSnapshot(
    await bridge.runBrowserAutomation({
      source: "human",
      projectId,
      sessionId: `testing:${projectId}`,
      operation: "snapshot",
    }),
  );
  const dom = (await bridge.runBrowserAutomation({
    source: "human",
    projectId,
    sessionId: `testing:${projectId}`,
    operation: "evaluate",
    input: { expression: `${TESTING_LOCATOR_DOM_FUNCTION}()` },
  })) as { url: string; elements: NonNullable<TestingLocatorPreviewSnapshot["elements"]> };
  if (dom.url !== snapshot.url)
    throw new Error("The preview navigated during capture. Scan again when the page is ready.");
  return { ...snapshot, elements: dom.elements };
}
