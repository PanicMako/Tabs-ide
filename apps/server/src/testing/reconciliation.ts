import { join } from "node:path";

import type { TestingCaseSummary, TestingMismatch } from "@tabs/contracts";

import { parseActionableElements } from "./crawler";
import type { StoredGraphEdge, StoredGraphNode, TestingGraphStore } from "./graphStore";
import { createPlaywrightMcpSession, extractAccessibilityYaml } from "./playwrightMcp";
import { sanitizeAccessibilitySnapshot, shortDigest, tokenizePii } from "./security";
import type { ParsedWorkbookCase } from "./workbookParser";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "activate",
  "button",
  "by",
  "click",
  "for",
  "from",
  "in",
  "into",
  "link",
  "of",
  "on",
  "press",
  "select",
  "the",
  "then",
  "to",
  "with",
]);

function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word)),
  );
}

function semanticScore(expected: string, candidate: string): number {
  const expectedWords = words(expected);
  const candidateWords = words(candidate);
  if (expectedWords.size === 0 || candidateWords.size === 0) return 0;
  let overlap = 0;
  for (const word of expectedWords) if (candidateWords.has(word)) overlap += 1;
  const union = new Set([...expectedWords, ...candidateWords]).size;
  const jaccard = overlap / union;
  const phraseBonus = expected.toLowerCase().includes(candidate.toLowerCase()) ? 0.45 : 0;
  return Math.min(1, jaccard + phraseBonus);
}

function shortestPath(
  startStateId: string,
  targetStateId: string,
  edges: ReadonlyArray<StoredGraphEdge>,
): ReadonlyArray<StoredGraphEdge> | null {
  if (startStateId === targetStateId) return [];
  const queue: Array<{ stateId: string; path: ReadonlyArray<StoredGraphEdge> }> = [
    { stateId: startStateId, path: [] },
  ];
  const visited = new Set([startStateId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges.filter((item) => item.fromStateId === current.stateId)) {
      if (visited.has(edge.toStateId)) continue;
      const path = [...current.path, edge];
      if (edge.toStateId === targetStateId) return path;
      visited.add(edge.toStateId);
      queue.push({ stateId: edge.toStateId, path });
    }
  }
  return null;
}

function entryNode(nodes: ReadonlyArray<StoredGraphNode>, edges: ReadonlyArray<StoredGraphEdge>) {
  const incoming = new Set(edges.map((edge) => edge.toStateId));
  return nodes.find((node) => !incoming.has(node.stateId)) ?? nodes[0] ?? null;
}

export interface ReconciledWorkbookCase {
  readonly externalId: string;
  readonly description: string;
  readonly steps: ReadonlyArray<string>;
  readonly expectedResults: ReadonlyArray<string>;
  readonly expectedResult: string;
  readonly sourceSheet: string;
  readonly sourceRow: number;
  readonly status: TestingCaseSummary["status"];
  readonly mismatches: ReadonlyArray<TestingMismatch>;
  readonly matchedStateIds: ReadonlyArray<string>;
}

export function reconcileWorkbookCase(
  parsedCase: ParsedWorkbookCase,
  graph: {
    readonly nodes: ReadonlyArray<StoredGraphNode>;
    readonly edges: ReadonlyArray<StoredGraphEdge>;
  },
): ReconciledWorkbookCase & { readonly matchedEdges: ReadonlyArray<StoredGraphEdge> } {
  const mismatches: TestingMismatch[] = parsedCase.errors.map((error) => ({
    stepIndex: null,
    expected: parsedCase.externalId,
    actual: error,
    kind: error.startsWith("Duplicate") ? "duplicate" : "parse",
  }));
  const start = entryNode(graph.nodes, graph.edges);
  if (!start) {
    mismatches.push({
      stepIndex: null,
      expected: parsedCase.description,
      actual: "The project graph has no reachable states. Explore the target before importing.",
      kind: "unreachable",
    });
  }

  let currentStateId = start?.stateId ?? "";
  const matchedEdges: StoredGraphEdge[] = [];
  const matchedStateIds: string[] = start ? [start.stateId] : [];
  parsedCase.steps.forEach((step, stepIndex) => {
    if (!start) return;
    const ranked = graph.edges
      .map((edge) => ({ edge, score: semanticScore(step, `${edge.role} ${edge.name}`) }))
      .filter((item) => item.score >= 0.2)
      .toSorted((left, right) => right.score - left.score);
    let selected: {
      edge: StoredGraphEdge;
      score: number;
      prefix: ReadonlyArray<StoredGraphEdge>;
    } | null = null;
    for (const candidate of ranked) {
      const prefix = shortestPath(currentStateId, candidate.edge.fromStateId, graph.edges);
      if (prefix) {
        selected = { ...candidate, prefix };
        break;
      }
    }
    if (!selected) {
      const available = graph.edges
        .filter((edge) => edge.fromStateId === currentStateId)
        .map((edge) => `${edge.role} "${edge.name}"`)
        .slice(0, 5)
        .join(", ");
      mismatches.push({
        stepIndex,
        expected: step,
        actual: available || "No reachable actions were found from the current state",
        kind: "unreachable",
      });
      return;
    }
    for (const edge of [...selected.prefix, selected.edge]) {
      if (!matchedEdges.some((item) => item === edge)) matchedEdges.push(edge);
      if (matchedStateIds.at(-1) !== edge.toStateId) matchedStateIds.push(edge.toStateId);
    }
    currentStateId = selected.edge.toStateId;
  });

  parsedCase.expectedResults.forEach((expectedResult, stepIndex) => {
    if (!expectedResult || !start) return;
    const matchedStateId = matchedStateIds[Math.min(stepIndex + 1, matchedStateIds.length - 1)];
    const matchedNode = graph.nodes.find((node) => node.stateId === matchedStateId);
    const maxScore = matchedNode
      ? Math.max(
          semanticScore(expectedResult, matchedNode.pageTitle),
          semanticScore(expectedResult, matchedNode.pageUrl),
          semanticScore(expectedResult, matchedNode.snapshot),
        )
      : 0;
    if (maxScore < 0.2) {
      mismatches.push({
        stepIndex,
        expected: expectedResult,
        actual: "The state reached by this step does not match its expected result",
        kind: "expected-result",
      });
    }
  });

  const status =
    parsedCase.errors.length > 0 || !start
      ? "blocked"
      : mismatches.length > 0
        ? "needs-review"
        : "matches";
  return { ...parsedCase, status, mismatches, matchedStateIds, matchedEdges };
}

export async function verifyReconciledCaseLive(input: {
  readonly projectId: string;
  readonly targetUrl: string;
  readonly cdpEndpoint?: string;
  readonly testingRoot: string;
  readonly store: TestingGraphStore;
  readonly reconciled: ReconciledWorkbookCase & {
    readonly matchedEdges: ReadonlyArray<StoredGraphEdge>;
  };
}): Promise<ReconciledWorkbookCase> {
  if (input.reconciled.status === "blocked" || input.reconciled.matchedEdges.length === 0) {
    return input.reconciled;
  }
  const session = await createPlaywrightMcpSession({
    profilePath: join(input.testingRoot, "auth", shortDigest(input.projectId)),
    outputPath: join(input.testingRoot, "mcp-output", `reconcile-${crypto.randomUUID()}`),
    headless: true,
    ...(input.cdpEndpoint ? { cdpEndpoint: input.cdpEndpoint } : {}),
  });
  const mismatches = [...input.reconciled.mismatches];
  try {
    await session.call("browser_navigate", { url: input.targetUrl });
    for (const [stepIndex, edge] of input.reconciled.matchedEdges.entries()) {
      const response = await session.call("browser_snapshot", { depth: 12, boxes: true });
      const sanitized = sanitizeAccessibilitySnapshot(extractAccessibilityYaml(response), {
        maxDepth: 12,
      });
      const tokenized = tokenizePii(input.projectId, sanitized.sanitized);
      input.store.storePiiTokens(input.projectId, tokenized.tokens);
      const action = parseActionableElements(tokenized.tokenized).find(
        (candidate) => candidate.role === edge.role && candidate.name === edge.name,
      );
      if (!action) {
        mismatches.push({
          stepIndex,
          expected: `${edge.role} "${edge.name}"`,
          actual: "The intent locator did not resolve in the live accessibility snapshot",
          kind: "live-verification",
        });
        break;
      }
      await session.call("browser_click", {
        target: action.ref,
        element: `${action.role} ${action.name}`,
      });
    }
  } catch (error) {
    mismatches.push({
      stepIndex: null,
      expected: "The reconciled graph path should replay against the live target",
      actual: error instanceof Error ? error.message : String(error),
      kind: "live-verification",
    });
  } finally {
    await session.close();
  }
  return {
    ...input.reconciled,
    mismatches,
    status: mismatches.length > 0 ? "needs-review" : "matches",
  };
}

export function scenariosFromGraph(graph: {
  readonly nodes: ReadonlyArray<StoredGraphNode>;
  readonly edges: ReadonlyArray<StoredGraphEdge>;
}): ReadonlyArray<{
  readonly externalId: string;
  readonly description: string;
  readonly steps: ReadonlyArray<string>;
  readonly expectedResults: ReadonlyArray<string>;
  readonly expectedResult: string;
  readonly matchedStateIds: ReadonlyArray<string>;
}> {
  const start = entryNode(graph.nodes, graph.edges);
  if (!start) return [];
  return graph.edges.slice(0, 25).map((edge, index) => {
    const target = graph.nodes.find((node) => node.stateId === edge.toStateId);
    const path = shortestPath(start.stateId, edge.toStateId, graph.edges) ?? [edge];
    const targetLabel = target?.pageTitle || target?.pageUrl || edge.toStateId;
    const expectedResults = path.map((item) => {
      const stepTarget = graph.nodes.find((node) => node.stateId === item.toStateId);
      return stepTarget?.pageTitle
        ? `${stepTarget.pageTitle} page is displayed`
        : `Application reaches ${stepTarget?.pageUrl ?? item.toStateId}`;
    });
    return {
      externalId: `DISCOVERED-${String(index + 1).padStart(3, "0")}`,
      description: `Reach ${targetLabel}`,
      steps: path.map((item) => `Activate ${item.role} "${item.name}"`),
      expectedResults,
      expectedResult: expectedResults.filter(Boolean).join("\n"),
      matchedStateIds: [start.stateId, ...path.map((item) => item.toStateId)],
    };
  });
}
