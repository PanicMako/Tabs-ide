import type {
  TestingLocatorCoverageMode,
  TestingLocatorEntry,
  TestingLocatorVerificationStatus,
  TestingLocatorPreviewSnapshot,
} from "@tabs/contracts";

import type { LocatorCandidate } from "./locatorLibrary";
import { TESTING_LOCATOR_DOM_FUNCTION } from "@tabs/shared/testingLocatorDom";
import {
  extractAccessibilityYaml,
  extractPageUrl,
  type PlaywrightMcpSession,
} from "./playwrightMcp";
import {
  normalizeAccessibilityForStorage,
  redactCredentialLikeText,
  sanitizeAccessibilitySnapshot,
  structuralHash,
  shortDigest,
  tokenizePii,
} from "./security";

const ACTION_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);
const ASSERTION_ROLES = new Set([
  "alert",
  "alertdialog",
  "dialog",
  "heading",
  "log",
  "progressbar",
  "status",
  "table",
  "tabpanel",
]);
const SNAPSHOT_NODE = /^\s*-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?/i;

function candidateKey(role: string, name: string, index: number): string {
  const cleanName = name
    .replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, "")
    .trim();
  const base = `${role}-${cleanName || "unnamed"}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  const key = /[^\x00-\x7f]/.test(cleanName) ? `${base}-${shortDigest(cleanName)}` : base;
  return index === 0 ? key : `${key}-${index + 1}`;
}

function classificationForRole(role: string): TestingLocatorEntry["classification"] {
  if (ACTION_ROLES.has(role)) return "action";
  if (ASSERTION_ROLES.has(role)) return "assertion";
  return "content";
}

export interface LocatorCaptureSnapshot {
  readonly resolvedCounts?: ReadonlyMap<string, number>;
  readonly rawUrl: string;
  readonly fingerprint: string;
  readonly storedSnapshot: string;
  readonly observedElements: number;
  readonly truncatedElements: number;
  readonly candidates: ReadonlyArray<LocatorCandidate>;
  readonly matchCounts: ReadonlyMap<string, number>;
  readonly injectionFlags: ReadonlyArray<string>;
}

export function locatorCandidatesFromSnapshot(input: {
  readonly projectId: string;
  readonly snapshot: string;
  readonly coverage: TestingLocatorCoverageMode;
  readonly maxElements: number;
  readonly taskContext?: string;
}): Omit<LocatorCaptureSnapshot, "rawUrl" | "fingerprint"> {
  const sanitized = sanitizeAccessibilitySnapshot(input.snapshot, {
    maxDepth: 12,
  });
  const tokenized = tokenizePii(input.projectId, redactCredentialLikeText(sanitized.sanitized));
  const storedSnapshot = normalizeAccessibilityForStorage(tokenized.tokenized);
  const nodes: Array<{ role: string; name: string }> = [];
  for (const line of storedSnapshot.split("\n")) {
    const match = SNAPSHOT_NODE.exec(line);
    if (!match?.[1]) continue;
    const role = match[1].toLowerCase();
    const rawName = (match[2] ?? "").replace(/\\"/g, '"').trim();
    const name = rawName
      .replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, "")
      .trim();
    const classification = classificationForRole(role);
    if (input.coverage === "actions-only" && classification !== "action") continue;
    if (input.coverage === "actions-assertions" && classification === "content") continue;
    if (!name && classification !== "action" && input.coverage !== "everything-accessible")
      continue;
    nodes.push({ role, name });
  }
  const taskWords = new Set(
    (input.taskContext ?? "")
      .toLocaleLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3),
  );
  const scopedNodes =
    taskWords.size === 0
      ? nodes
      : nodes.filter((node) => {
          const words = `${node.role} ${node.name}`.toLocaleLowerCase().split(/[^a-z0-9]+/);
          return words.some((word) => taskWords.has(word));
        });
  const matchCounts = new Map<string, number>();
  for (const node of scopedNodes) {
    const signature = `${node.role}\0${node.name.toLocaleLowerCase()}`;
    matchCounts.set(signature, (matchCounts.get(signature) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const candidates = scopedNodes.slice(0, input.maxElements).map((node) => {
    const signature = `${node.role}\0${node.name.toLocaleLowerCase()}`;
    const duplicateIndex = seen.get(signature) ?? 0;
    seen.set(signature, duplicateIndex + 1);
    return {
      locatorKey: candidateKey(node.role, node.name, duplicateIndex),
      classification: classificationForRole(node.role),
      strategy: "role" as const,
      arguments: { role: node.role, ...(node.name ? { name: node.name } : {}) },
      semanticContext: `${node.role}${node.name ? ` ${node.name}` : ""}`,
      source: "discovered" as const,
      fragile: (matchCounts.get(signature) ?? 0) > 1,
      // Discovery proposes candidates. A human chooses which entries become
      // part of the generated page object, including candidates that happen
      // to resolve uniquely in the capture environment.
      lifecycleStatus: "draft" as const,
    };
  });
  return {
    storedSnapshot,
    observedElements: scopedNodes.length,
    truncatedElements: Math.max(0, scopedNodes.length - candidates.length),
    candidates,
    matchCounts,
    injectionFlags: sanitized.flags,
  };
}

export async function captureLocatorSnapshot(input: {
  readonly projectId: string;
  readonly session: PlaywrightMcpSession | null;
  readonly previewSnapshot?: TestingLocatorPreviewSnapshot;
  readonly coverage: TestingLocatorCoverageMode;
  readonly maxElements: number;
  readonly fallbackUrl: string;
  readonly taskContext?: string;
}): Promise<LocatorCaptureSnapshot> {
  if (!input.previewSnapshot && !input.session) throw new Error("No browser available for capture");
  const response = input.previewSnapshot
    ? ""
    : await input.session!.call("browser_snapshot", { depth: 12, boxes: true });
  const rawSnapshot = input.previewSnapshot?.snapshot ?? extractAccessibilityYaml(response);
  const parsed = locatorCandidatesFromSnapshot({
    projectId: input.projectId,
    snapshot: rawSnapshot,
    coverage: input.coverage,
    maxElements: input.maxElements,
    ...(input.taskContext ? { taskContext: input.taskContext } : {}),
  });
  const domSnapshot = input.previewSnapshot?.elements
    ? input.previewSnapshot
    : input.session
      ? parseLocatorDomResult(
          await input.session.call("browser_evaluate", {
            function: TESTING_LOCATOR_DOM_FUNCTION,
          }),
        )
      : undefined;
  if (domSnapshot?.elements) {
    const dom = locatorCandidatesFromDom({
      projectId: input.projectId,
      elements: domSnapshot.elements,
      coverage: input.coverage,
      maxElements: input.maxElements,
      ...(input.taskContext ? { taskContext: input.taskContext } : {}),
    });
    const snapshotUrl = input.previewSnapshot?.url ?? extractPageUrl(response);
    if (snapshotUrl && domSnapshot.url && snapshotUrl !== domSnapshot.url) {
      throw new Error(
        "The preview navigated while locators were being captured. Scan the current page again.",
      );
    }
    const rawUrl = domSnapshot.url || snapshotUrl || input.fallbackUrl;
    return {
      ...parsed,
      ...dom,
      rawUrl,
      fingerprint: structuralHash(parsed.storedSnapshot),
    };
  }
  return {
    ...parsed,
    rawUrl: input.previewSnapshot?.url ?? extractPageUrl(response) ?? input.fallbackUrl,
    fingerprint: structuralHash(parsed.storedSnapshot),
  };
}

export function parseLocatorDomResult(
  response: string,
): Pick<TestingLocatorPreviewSnapshot, "url" | "elements"> {
  const json = response.match(/### Result\s*\n([\s\S]*?)(?=\n### |$)/)?.[1] ?? response;
  const value = JSON.parse(json.trim()) as Pick<TestingLocatorPreviewSnapshot, "url" | "elements">;
  if (typeof value.url !== "string" || !Array.isArray(value.elements))
    throw new Error("Playwright did not return DOM locator details.");
  return value;
}

export function locatorCandidatesFromDom(input: {
  readonly projectId: string;
  readonly elements: NonNullable<TestingLocatorPreviewSnapshot["elements"]>;
  readonly coverage: TestingLocatorCoverageMode;
  readonly maxElements: number;
  readonly taskContext?: string;
}) {
  const relevant = input.elements.filter((element) => {
    const classification = classificationForRole(element.role);
    if (input.coverage === "actions-only" && classification !== "action") return false;
    if (input.coverage === "actions-assertions" && classification === "content") return false;
    if (
      input.taskContext &&
      !input.taskContext
        .toLocaleLowerCase()
        .split(/\s+/)
        .some((word) => word.length > 2 && element.name.toLocaleLowerCase().includes(word))
    )
      return false;
    return true;
  });
  const resolvedCounts = new Map<string, number>();
  const candidates: LocatorCandidate[] = relevant.slice(0, input.maxElements).map((element) => {
    const cleanName = element.name
      .replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, "")
      .trim();
    const sanitize = (text: string) =>
      tokenizePii(input.projectId, redactCredentialLikeText(text)).tokenized;
    const name = sanitize(cleanName);
    const selector = sanitize(element.selector);
    const testId = sanitize(element.testId);

    // Locator priority: test ID → role/name → label → placeholder → stable attribute/text → CSS fallback
    let strategy: TestingLocatorEntry["strategy"] = "css";
    let args: Record<string, string | number | boolean> = { selector };
    let isSemantic = false;

    if (testId) {
      strategy = "test-id";
      args = { testId };
      isSemantic = true;
    } else if (element.role && name) {
      strategy = "role";
      args = { role: element.role, name };
      isSemantic = true;
    } else if (element.tag === "label" && name) {
      strategy = "label";
      args = { text: name };
      isSemantic = true;
    } else if (
      (element.tag === "input" || element.tag === "textarea") &&
      element.selector.includes("[placeholder=") &&
      name
    ) {
      strategy = "placeholder";
      args = { text: name };
      isSemantic = true;
    } else if (name && !element.fragile && element.matchCount === 1) {
      strategy = "text";
      args = { text: name };
      isSemantic = true;
    } else {
      strategy = "css";
      args = { selector };
      isSemantic = false;
    }

    const locatorKey = `${candidateKey(element.role || element.tag, cleanName, 0).slice(0, 44)}-${shortDigest(element.selector)}`;
    const sensitive = /<(?:PII_|REDACTED_)/.test(`${name} ${selector} ${testId}`);
    resolvedCounts.set(locatorKey, element.matchCount);

    const isFragile = element.fragile || element.matchCount !== 1 || !isSemantic;

    return {
      locatorKey,
      classification: classificationForRole(element.role),
      strategy,
      arguments: args,
      semanticContext: `${element.role || element.tag} ${name}`.trim(),
      source: "discovered",
      fragile: isFragile,
      lifecycleStatus: sensitive ? "manual-required" : "draft",
      elementFingerprint: shortDigest(`${element.tag}\0${element.role}\0${selector}`),
    };
  });
  return {
    candidates,
    resolvedCounts,
    observedElements: relevant.length,
    truncatedElements: Math.max(0, relevant.length - candidates.length),
  };
}

export function countLocatorMatches(
  snapshot: string,
  entry: Pick<TestingLocatorEntry, "strategy" | "arguments">,
): number {
  const strategy = entry.strategy;
  const args = entry.arguments;
  if (strategy === "role") {
    const role = String(args.role ?? "").toLowerCase();
    const name = String(args.name ?? "").toLocaleLowerCase();
    let count = 0;
    for (const line of snapshot.split("\n")) {
      const match = SNAPSHOT_NODE.exec(line);
      if (!match?.[1] || match[1].toLowerCase() !== role) continue;
      const candidateName = (match[2] ?? "").replace(/\\"/g, '"').trim().toLocaleLowerCase();
      if (!name || candidateName === name) count += 1;
    }
    return count;
  }
  const expected = String(
    args.label ??
      args.testId ??
      args.placeholder ??
      args.altText ??
      args.title ??
      args.text ??
      args.selector ??
      "",
  ).toLocaleLowerCase();
  if (!expected) return 0;
  return snapshot.split("\n").filter((line) => line.toLocaleLowerCase().includes(expected)).length;
}

export function verificationStatusForCount(count: number): TestingLocatorVerificationStatus {
  if (count === 0) return "missing";
  if (count === 1) return "verified";
  return "ambiguous";
}
