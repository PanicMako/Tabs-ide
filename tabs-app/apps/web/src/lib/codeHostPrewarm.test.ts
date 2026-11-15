import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  forgetCodePrewarmProject,
  readRememberedCodePrewarmProject,
  rememberCodePrewarmProject,
} from "./codeHostPrewarm";

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    },
  });
  return store;
}

describe("remembered Code prewarm project", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("round-trips the project", () => {
    rememberCodePrewarmProject({ id: "p1", cwd: "/work/p1" });
    expect(readRememberedCodePrewarmProject()).toEqual({ id: "p1", cwd: "/work/p1" });
  });

  it("forgets the project once Code is turned off for it", () => {
    rememberCodePrewarmProject({ id: "p1", cwd: "/work/p1" });
    forgetCodePrewarmProject();
    expect(readRememberedCodePrewarmProject()).toBeNull();
  });

  it("ignores missing or malformed data", () => {
    expect(readRememberedCodePrewarmProject()).toBeNull();
    store.set("tabs:code-prewarm-project:v1", "{not json");
    expect(readRememberedCodePrewarmProject()).toBeNull();
    store.set("tabs:code-prewarm-project:v1", JSON.stringify({ id: 4, cwd: "" }));
    expect(readRememberedCodePrewarmProject()).toBeNull();
  });
});
