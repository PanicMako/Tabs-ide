// Test helpers: an in-memory stand-in for `NativeApi.teammates` that behaves like the server
// (deleting the last teammate leaves none) and pushes every change into the teammates store.
import type {
  Teammate,
  TeammateActivity,
  TeammateItem,
  TeammateMemoryFact,
  TeammatesSnapshot,
  TeammateSuggestion,
} from "@tabs/contracts";
import { vi } from "vitest";
import { useTeammatesStore } from "./teammatesStore";

const NOW = "2026-11-21T10:00:00.000Z";

export function makeTeammate(overrides: {
  id: string;
  name: string;
  [key: string]: unknown;
}): Teammate {
  return {
    finish: "signature",
    modelSelection: null,
    projectId: null,
    paused: false,
    lookAround: { enabled: false, preset: "every4h", focus: "", maxSuggestions: 3 },
    notify: { needsYou: true, workDone: true, couldntFinish: true },
    homeThreadId: null,
    lastLookAroundAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as unknown as Teammate;
}

export function makeItem(overrides: {
  id: string;
  teammateId: string;
  title: string;
  [key: string]: unknown;
}): TeammateItem {
  return {
    detail: "",
    status: "todo",
    workerThreadIds: [],
    question: null,
    link: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as unknown as TeammateItem;
}

export function makeSuggestion(overrides: {
  id: string;
  teammateId: string;
  title: string;
  [key: string]: unknown;
}): TeammateSuggestion {
  return {
    why: "",
    ask: "do it",
    link: null,
    status: "open",
    createdAt: NOW,
    ...overrides,
  } as unknown as TeammateSuggestion;
}

export function makeFact(overrides: {
  id: string;
  teammateId: string;
  text: string;
  [key: string]: unknown;
}): TeammateMemoryFact {
  return {
    topic: null,
    source: "owner",
    createdAt: NOW,
    ...overrides,
  } as unknown as TeammateMemoryFact;
}

export function makeActivity(
  teammateId: string,
  overrides: Partial<TeammateActivity> = {},
): TeammateActivity {
  return {
    teammateId,
    mood: "idle",
    thinkingCount: 0,
    workingCount: 0,
    needsYouCount: 0,
    ...overrides,
  } as TeammateActivity;
}

type Fake = ReturnType<typeof createFakeTeammatesApi>;
let current: Fake | null = null;
/** `nativeApi.ts` caches the first object it sees, so tests install one stable object that follows `current`. */
const stableNativeApi = {
  get teammates() {
    return current!.api;
  },
  get orchestration() {
    return { dispatchCommand: current!.dispatchCommand };
  },
  server: { getConfig: async () => null, updateSettings: async () => ({}) },
};

export function createFakeTeammatesApi(initial: Partial<TeammatesSnapshot> = {}) {
  let snapshot: TeammatesSnapshot = {
    teammates: [],
    items: [],
    suggestions: [],
    activity: [],
    notices: [],
    hiddenThreadIds: [],
    ...initial,
  };
  const facts = new Map<string, TeammateMemoryFact[]>();
  const souls = new Map<string, string>();
  const push = (next: Partial<TeammatesSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    useTeammatesStore.getState().setSnapshot(snapshot);
  };
  let counter = 0;
  const api = {
    list: vi.fn(async () => snapshot),
    subscribe: vi.fn(() => () => {}),
    create: vi.fn(async (input: { name?: string; soul?: string; finish?: string }) => {
      counter += 1;
      const teammate = makeTeammate({
        id: `tm-new-${counter}`,
        name: input.name ?? "Notch",
        ...(input.finish ? { finish: input.finish as Teammate["finish"] } : {}),
      });
      souls.set(teammate.id, input.soul ?? "");
      push({
        teammates: [...snapshot.teammates, teammate],
        activity: [...snapshot.activity, makeActivity(teammate.id)],
      });
      return { teammate };
    }),
    update: vi.fn(async (input: { id: string; patch: Record<string, unknown> }) => {
      const current = snapshot.teammates.find((teammate) => teammate.id === input.id)!;
      const { lookAround, notify, ...rest } = input.patch as Record<string, any>;
      const teammate = {
        ...current,
        ...rest,
        lookAround: { ...current.lookAround, ...lookAround },
        notify: { ...current.notify, ...notify },
      } as unknown as Teammate;
      push({
        teammates: snapshot.teammates.map((entry) => (entry.id === input.id ? teammate : entry)),
      });
      return { teammate };
    }),
    delete: vi.fn(async (input: { id: string }) => {
      push({
        teammates: snapshot.teammates.filter((teammate) => teammate.id !== input.id),
        items: snapshot.items.filter((item) => item.teammateId !== input.id),
        suggestions: snapshot.suggestions.filter((entry) => entry.teammateId !== input.id),
        activity: snapshot.activity.filter((entry) => entry.teammateId !== input.id),
      });
      return { id: input.id };
    }),
    openHome: vi.fn(async (input: { id: string }) => ({
      teammateId: input.id,
      threadId: `home-${input.id}`,
      projectId: "project-1",
    })),
    updateItem: vi.fn(async (input: { id: string; patch: Record<string, unknown> }) => {
      const current = snapshot.items.find((item) => item.id === input.id)!;
      const item = { ...current, ...input.patch } as TeammateItem;
      push({ items: snapshot.items.map((entry) => (entry.id === input.id ? item : entry)) });
      return { item };
    }),
    startSuggestion: vi.fn(async (input: { id: string }) => {
      const current = snapshot.suggestions.find((entry) => entry.id === input.id)!;
      const suggestion = { ...current, status: "started" } as TeammateSuggestion;
      push({
        suggestions: snapshot.suggestions.map((entry) =>
          entry.id === input.id ? suggestion : entry,
        ),
      });
      return {
        suggestion,
        item: makeItem({ id: "it", teammateId: current.teammateId, title: current.title }),
        workerThreadId: "worker-1",
      };
    }),
    dismissSuggestion: vi.fn(async (input: { id: string }) => {
      const current = snapshot.suggestions.find((entry) => entry.id === input.id)!;
      push({ suggestions: snapshot.suggestions.filter((entry) => entry.id !== input.id) });
      return { suggestion: { ...current, status: "dismissed" } };
    }),
    listMemory: vi.fn(async (input: { teammateId: string }) => ({
      facts: facts.get(input.teammateId) ?? [],
    })),
    forgetMemory: vi.fn(async (input: { id: string }) => {
      for (const [key, list] of facts)
        facts.set(
          key,
          list.filter((fact) => fact.id !== input.id),
        );
      return { id: input.id };
    }),
    lookAroundNow: vi.fn(async () => ({ status: "started", threadId: "look-1" })),
    getSoul: vi.fn(async (input: { id: string }) => ({
      id: input.id,
      soul: souls.get(input.id) ?? "# Notch\n\nDescribe Notch here.\n",
    })),
    setSoul: vi.fn(async (input: { id: string; soul: string }) => {
      souls.set(input.id, input.soul);
      return input;
    }),
  };
  const dispatchCommand = vi.fn(async (_command: Record<string, unknown>) => ({}));
  const fake = {
    api,
    dispatchCommand,
    setFacts: (teammateId: string, list: TeammateMemoryFact[]) => facts.set(teammateId, list),
    setSoul: (teammateId: string, soul: string) => souls.set(teammateId, soul),
    /** Installs the fake as `window.nativeApi` (before the app first reads it). */
    install: () => {
      current = fake;
      const target = window as unknown as { nativeApi?: unknown };
      target.nativeApi ??= stableNativeApi;
      push({});
    },
    push,
    get snapshot() {
      return snapshot;
    },
  };
  return fake;
}
