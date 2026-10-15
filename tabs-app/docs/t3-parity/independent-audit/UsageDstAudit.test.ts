import { expect, it, vi } from "vitest";
import { makeWindow, formatHourShort } from "./usageFormat.ts";
it("keeps seven calendar days across spring and fall DST", () => {
  try {
    vi.stubEnv("TZ", "America/New_York");
    for (const [instant, since, until] of [
      ["2026-03-09T04:15:00Z", "2026-03-03", "2026-03-09"],
      ["2026-11-02T05:15:00Z", "2026-10-27", "2026-11-02"],
    ]) {
      const result = makeWindow(7, new Date(instant));
      expect(result.sinceDay).toBe(since);
      expect(result.untilDay).toBe(until);
    }
  } finally {
    vi.unstubAllEnvs();
  }
});
it("distinguishes repeated wall-clock hour labels during Lord Howe half-hour rollback", () => {
  const a = "2026-04-04T14:45:00Z",
    b = "2026-04-04T15:15:00Z";
  expect(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Australia/Lord_Howe",
      hour: "numeric",
      minute: "numeric",
    }).format(new Date(a)),
  ).toBe(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Australia/Lord_Howe",
      hour: "numeric",
      minute: "numeric",
    }).format(new Date(b)),
  );
  expect(formatHourShort(a, "Australia/Lord_Howe")).not.toBe(
    formatHourShort(b, "Australia/Lord_Howe"),
  );
});
