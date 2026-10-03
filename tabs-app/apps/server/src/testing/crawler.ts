import { basename, join } from "node:path";

import {
  DEFAULT_TESTING_EXPLORATION_SCOPE,
  DEFAULT_TESTING_MAX_STATES,
  MAX_TESTING_DURATION_SECONDS,
  MAX_TESTING_MAX_STATES,
  type TestingExplorationInput,
  type TestingExplorationResult,
  type TestingExplorationScope,
} from "@tabs/contracts";

import { TestingGraphStore } from "./graphStore";
import {
  createPlaywrightMcpSession,
  extractAccessibilityYaml,
  extractPageUrl,
  type PlaywrightMcpSession,
} from "./playwrightMcp";
import {
  normalizeAccessibilityForStorage,
  sanitizeAccessibilitySnapshot,
  sanitizePersistedUrl,
  shortDigest,
  splitStaticSubtrees,
  structuralHash,
  tokenizePii,
} from "./security";

interface CrawlAction {
  readonly role: string;
  readonly name: string;
  readonly ref: string;
}

interface PlannedState {
  readonly path: ReadonlyArray<Pick<CrawlAction, "role" | "name">>;
  readonly depth: number;
  readonly priority: number;
  readonly parentStateId?: string;
  readonly action?: Pick<CrawlAction, "role" | "name">;
}

const ACTION_LINE =
  /^\s*-\s+(button|link|menuitem|tab|treeitem)\s+"((?:[^"\\]|\\.)*)"[^\n]*\[ref=([^\]\s]+)\]/;
const DANGEROUS_ACTION =
  /\b(delete|remove|destroy|logout|log out|sign out|sign in|log in|purchase|pay|submit order|confirm order|add project|open file|clone from git|capture login|finish(?: &)? save session|start exploration|run task|new terminal|restore defaults)\b/i;
const CHROME_ACTION = /\b(home|previous|next|menu|navigation|page \d+|settings)\b/i;
const TRANSIENT_OVERLAY_RETRY_SECONDS = 2;

export function isTabsStartupSnapshot(snapshot: string): boolean {
  return /^\s*-\s+generic(?:\s+\[[^\]]+\])?:\s+TABS\s*$/m.test(snapshot);
}

async function waitForSettledNavigation(session: PlaywrightMcpSession): Promise<void> {
  let previousHash: string | null = null;
  let stableSnapshots = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await session.call("browser_snapshot", { depth: 4, boxes: false });
    const snapshot = extractAccessibilityYaml(response);
    if (snapshot.trim().length === 0 || isTabsStartupSnapshot(snapshot)) {
      previousHash = null;
      stableSnapshots = 0;
      await session.call("browser_wait_for", { time: 0.5 });
      continue;
    }
    const currentHash = structuralHash(normalizeAccessibilityForStorage(snapshot));
    stableSnapshots = currentHash === previousHash ? stableSnapshots + 1 : 1;
    previousHash = currentHash;
    if (stableSnapshots >= 5) return;
    await session.call("browser_wait_for", { time: 0.5 });
  }
  throw new Error("Timed out waiting for a settled accessibility snapshot after navigation");
}

async function clickWithTransientOverlayRetry(
  session: PlaywrightMcpSession,
  action: CrawlAction,
): Promise<void> {
  const click = () =>
    session.call("browser_click", {
      target: action.ref,
      element: `${action.role} ${action.name}`,
    });
  try {
    await click();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/intercepts pointer events|not stable|detached from the DOM/i.test(message)) {
      throw error;
    }
    await session.call("browser_wait_for", { time: TRANSIENT_OVERLAY_RETRY_SECONDS });
    await click();
  }
}

export function parseActionableElements(snapshot: string): ReadonlyArray<CrawlAction> {
  const actions: CrawlAction[] = [];
  for (const line of snapshot.split("\n")) {
    const match = ACTION_LINE.exec(line);
    if (!match?.[1] || !match[2] || !match[3] || DANGEROUS_ACTION.test(match[2])) continue;
    actions.push({
      role: match[1],
      name: match[2].replace(/\\"/g, '"'),
      ref: match[3],
    });
  }
  return actions;
}

function actionKey(action: Pick<CrawlAction, "role" | "name">): string {
  return `${action.role}\0${action.name.toLowerCase()}`;
}

function explorationPriority(input: {
  readonly depth: number;
  readonly action: CrawlAction;
  readonly seenCount: number;
}): number {
  const depthBias = input.depth * 20;
  const novelty = Math.max(0, 12 - input.seenCount * 4);
  const chromePenalty = CHROME_ACTION.test(input.action.name) ? 18 : 0;
  return depthBias + novelty - chromePenalty;
}

function titleFromSnapshot(snapshot: string, pageUrl: string): string {
  const heading = snapshot.match(/^\s*-\s+heading\s+"([^"]+)"/m)?.[1];
  if (heading) return heading;
  try {
    return basename(new URL(pageUrl).pathname) || new URL(pageUrl).hostname;
  } catch {
    return pageUrl;
  }
}

export function validateTestingCdpEndpoint(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const endpoint = new URL(trimmed);
  const isLoopback =
    endpoint.hostname === "localhost" ||
    endpoint.hostname === "127.0.0.1" ||
    endpoint.hostname === "[::1]";
  if ((endpoint.protocol !== "http:" && endpoint.protocol !== "https:") || !isLoopback) {
    throw new Error("Electron CDP endpoint must be an http(s) loopback URL");
  }
  return endpoint.href;
}

function pathMatchesPrefix(candidatePath: string, targetPath: string): boolean {
  const prefix = targetPath === "/" ? "/" : targetPath.replace(/\/+$/u, "");
  return prefix === "/" || candidatePath === prefix || candidatePath.startsWith(`${prefix}/`);
}

function hashRoutePath(url: URL): string | null {
  if (!url.hash.startsWith("#/")) return null;
  return new URL(url.hash.slice(1), "http://testing-scope.local").pathname;
}

export function isUrlWithinTestingScope(
  target: URL,
  candidate: URL,
  scope: TestingExplorationScope,
): boolean {
  if (candidate.origin !== target.origin) return false;
  if (scope === "origin") return true;
  if (scope === "page") {
    return (
      candidate.pathname === target.pathname &&
      candidate.search === target.search &&
      candidate.hash === target.hash
    );
  }

  const targetHashPath = hashRoutePath(target);
  if (targetHashPath) {
    const candidateHashPath = hashRoutePath(candidate);
    return candidateHashPath !== null && pathMatchesPrefix(candidateHashPath, targetHashPath);
  }
  return pathMatchesPrefix(candidate.pathname, target.pathname);
}

export class TestingCrawler {
  constructor(
    private readonly store: TestingGraphStore,
    private readonly testingRoot: string,
    private readonly shouldContinue: () => boolean = () => true,
    private readonly mayActivate: (action: CrawlAction) => boolean = () => true,
  ) {}

  async explore(input: TestingExplorationInput): Promise<TestingExplorationResult> {
    const target = new URL(input.targetUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Testing exploration requires an http:// or https:// target URL");
    }
    const maxStates = input.maxStates ?? DEFAULT_TESTING_MAX_STATES;
    const scope = input.scope ?? DEFAULT_TESTING_EXPLORATION_SCOPE;
    const maxDurationSeconds = input.maxDurationSeconds;
    const cdpEndpoint = validateTestingCdpEndpoint(input.cdpEndpoint);
    if (!Number.isSafeInteger(maxStates) || maxStates < 1 || maxStates > MAX_TESTING_MAX_STATES) {
      throw new Error(
        `Testing exploration maxStates must be an integer from 1 to ${MAX_TESTING_MAX_STATES}`,
      );
    }
    if (
      maxDurationSeconds !== undefined &&
      (!Number.isSafeInteger(maxDurationSeconds) ||
        maxDurationSeconds < 1 ||
        maxDurationSeconds > MAX_TESTING_DURATION_SECONDS)
    ) {
      throw new Error(
        `Testing exploration maxDurationSeconds must be an integer from 1 to ${MAX_TESTING_DURATION_SECONDS}`,
      );
    }
    const startedAt = Date.now();
    const deadline =
      maxDurationSeconds === undefined ? null : startedAt + maxDurationSeconds * 1_000;
    const runId = this.store.beginRun(input.projectId, sanitizePersistedUrl(target.href), {
      scope,
      maxStates,
      ...(maxDurationSeconds === undefined ? {} : { maxDurationSeconds }),
    });
    const profilePath = join(this.testingRoot, "auth", shortDigest(input.projectId));
    const outputPath = join(this.testingRoot, "mcp-output", runId);
    const session = await createPlaywrightMcpSession({
      profilePath,
      outputPath,
      headless: true,
      ...(cdpEndpoint ? { cdpEndpoint } : {}),
    });
    const queue: PlannedState[] = [{ path: [], depth: 0, priority: 0 }];
    const visitedStates = new Set<string>();
    const plannedPaths = new Set<string>([""]);
    const actionFrequency = new Map<string, number>();
    const injectionFlags = new Set<string>();
    let piiTokenCount = 0;
    let transitionsObserved = 0;
    let timeBudgetReached = false;

    try {
      while (queue.length > 0 && visitedStates.size < maxStates) {
        if (!this.shouldContinue()) {
          throw new Error("Locator-first discovery was disabled during this session");
        }
        if (deadline !== null && Date.now() >= deadline) {
          timeBudgetReached = true;
          break;
        }
        queue.sort((left, right) => right.priority - left.priority);
        const plan = queue.shift()!;
        await session.call("browser_navigate", { url: target.href });
        if (!this.shouldContinue()) {
          throw new Error("Locator-first discovery was disabled during this session");
        }
        await waitForSettledNavigation(session);

        let replayFailed = false;
        for (const step of plan.path) {
          if (!this.shouldContinue()) {
            throw new Error("Locator-first discovery was disabled during this session");
          }
          if (deadline !== null && Date.now() >= deadline) {
            timeBudgetReached = true;
            break;
          }
          const replayResponse = await session.call("browser_snapshot", { depth: 12, boxes: true });
          const replayPageUrl = extractPageUrl(replayResponse);
          if (
            replayPageUrl &&
            !isUrlWithinTestingScope(target, new URL(replayPageUrl, target.href), scope)
          ) {
            replayFailed = true;
            break;
          }
          const replaySnapshot = extractAccessibilityYaml(replayResponse);
          const replaySanitized = sanitizeAccessibilitySnapshot(replaySnapshot, { maxDepth: 12 });
          const replayTokenized = tokenizePii(input.projectId, replaySanitized.sanitized);
          this.store.storePiiTokens(input.projectId, replayTokenized.tokens);
          const matchingAction = parseActionableElements(replayTokenized.tokenized).find(
            (action) => action.role === step.role && action.name === step.name,
          );
          if (!matchingAction) {
            replayFailed = true;
            break;
          }
          try {
            await clickWithTransientOverlayRetry(session, matchingAction);
          } catch {
            replayFailed = true;
            break;
          }
          if (!this.shouldContinue()) {
            throw new Error("Locator-first discovery was disabled during this session");
          }
        }
        if (timeBudgetReached) break;
        if (replayFailed) continue;

        const response = await session.call("browser_snapshot", { depth: 12, boxes: true });
        const rawSnapshot = extractAccessibilityYaml(response);
        const pageUrl = extractPageUrl(response) ?? target.href;
        if (!isUrlWithinTestingScope(target, new URL(pageUrl, target.href), scope)) continue;

        const sanitized = sanitizeAccessibilitySnapshot(rawSnapshot, { maxDepth: 12 });
        sanitized.flags.forEach((flag) => injectionFlags.add(flag));
        const tokenized = tokenizePii(input.projectId, sanitized.sanitized);
        this.store.storePiiTokens(input.projectId, tokenized.tokens);
        piiTokenCount += tokenized.tokens.length;
        const storedSnapshot = normalizeAccessibilityForStorage(tokenized.tokenized);
        for (const subtree of splitStaticSubtrees(storedSnapshot)) {
          this.store.cacheSubtree(input.projectId, shortDigest(subtree), subtree);
        }

        const stateId = structuralHash(storedSnapshot);
        const isNewState = !visitedStates.has(stateId);
        if (!this.shouldContinue()) {
          throw new Error("Locator-first discovery was disabled during this session");
        }
        this.store.upsertNode({
          projectId: input.projectId,
          runId,
          stateId,
          pageUrl: sanitizePersistedUrl(pageUrl),
          pageTitle: titleFromSnapshot(storedSnapshot, pageUrl),
          snapshot: storedSnapshot,
        });

        if (plan.parentStateId && plan.action) {
          transitionsObserved += 1;
          this.store.upsertEdge({
            projectId: input.projectId,
            runId,
            fromStateId: plan.parentStateId,
            toStateId: stateId,
            role: plan.action.role,
            name: plan.action.name,
          });
        }

        if (!isNewState) continue;
        visitedStates.add(stateId);
        const actions = parseActionableElements(tokenized.tokenized)
          .filter((action) => this.mayActivate(action))
          .slice(0, 12);
        for (const action of actions) {
          const key = actionKey(action);
          const occurrencesInPath = plan.path.filter((step) => actionKey(step) === key).length;
          if (occurrencesInPath >= 2) continue;
          const seenCount = actionFrequency.get(key) ?? 0;
          actionFrequency.set(key, seenCount + 1);
          const path = [...plan.path, { role: action.role, name: action.name }];
          const pathKey = path.map(actionKey).join("\n");
          if (plannedPaths.has(pathKey)) continue;
          plannedPaths.add(pathKey);
          queue.push({
            path,
            depth: plan.depth + 1,
            priority: explorationPriority({ depth: plan.depth + 1, action, seenCount }),
            parentStateId: stateId,
            action: { role: action.role, name: action.name },
          });
        }

        if (visitedStates.size % 2 === 0) {
          this.store.updateRunProgress(runId, visitedStates.size, transitionsObserved);
        }
      }

      const terminationReason = timeBudgetReached
        ? "time-budget"
        : queue.length > 0
          ? "max-states"
          : "plateaued";
      const durationMs = Date.now() - startedAt;
      this.store.finishRun(runId, "completed", null, {
        terminationReason,
        statesVisited: visitedStates.size,
        transitionsObserved,
        durationMs,
      });
      return {
        ...this.store.summary(input.projectId),
        runId,
        injectionFlags: [...injectionFlags],
        piiTokenCount,
        statesVisited: visitedStates.size,
        transitionsObserved,
        durationMs,
        maxStates,
        maxDurationSeconds: maxDurationSeconds ?? null,
        scope,
        terminationReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.finishRun(runId, "failed", message);
      throw error;
    } finally {
      await session.close();
    }
  }
}
