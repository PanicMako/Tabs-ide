import { describe, expect, it } from "vitest";
import { BACKEND_STARTUP_ERROR_PREFIX, createBackendStartupErrorDecoder } from "./backendStartup";

describe("backend startup diagnostics", () => {
  it("decodes fragmented diagnostics while ignoring normal stderr", () => {
    const errors: string[] = [];
    const decode = createBackendStartupErrorDecoder((message) => errors.push(message));
    const diagnostic = `${BACKEND_STARTUP_ERROR_PREFIX}${JSON.stringify("Saved data preserved\nUse a compatible version.")}\n`;
    decode("ordinary log\n" + diagnostic.slice(0, 15));
    expect(errors).toEqual([]);
    decode(diagnostic.slice(15));
    expect(errors).toEqual(["Saved data preserved\nUse a compatible version."]);
  });
  it("ignores malformed diagnostics and resumes after oversized output", () => {
    const errors: string[] = [];
    const decode = createBackendStartupErrorDecoder((message) => errors.push(message));
    decode(`${BACKEND_STARTUP_ERROR_PREFIX}invalid\n`);
    decode("x".repeat(70_000));
    decode(`${BACKEND_STARTUP_ERROR_PREFIX}"Recovered"\n`);
    expect(errors).toEqual(["Recovered"]);
  });
});
