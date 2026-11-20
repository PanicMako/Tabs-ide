import { describe, expect, it } from "vitest";
import { OTLP_SIGNALS, otlpUrlProblem } from "./observabilityExport.logic";

describe("otlpUrlProblem", () => {
  it("accepts empty (off) and http or https addresses", () => {
    expect(otlpUrlProblem("")).toBeNull();
    expect(otlpUrlProblem("   ")).toBeNull();
    expect(otlpUrlProblem("http://localhost:4318/v1/traces")).toBeNull();
    expect(otlpUrlProblem("https://collector.example.com/v1/logs")).toBeNull();
  });
  it("explains anything else", () => {
    expect(otlpUrlProblem("localhost:4318")).toContain("http");
    expect(otlpUrlProblem("not a url")).toContain("web address");
    expect(otlpUrlProblem("ftp://example.com")).toContain("http");
  });
  it("covers all three signals with distinct setting keys", () => {
    expect(new Set(OTLP_SIGNALS.map((entry) => entry.key)).size).toBe(3);
  });
});
