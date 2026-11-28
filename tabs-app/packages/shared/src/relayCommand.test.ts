import { describe, expect, it } from "vitest";

import { isRelayMessage, parseRelayCommand, stripRelayMention } from "./relayCommand.ts";

// Friday 27 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 27, 10, 0, 0).getTime();
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute, 0).getTime();

describe("parseRelayCommand", () => {
  it("sets reminders with relative and clock times", () => {
    expect(parseRelayCommand("@relay remind me to call mom in 2 hours", NOW)).toMatchObject({
      type: "create",
      kind: "reminder",
      title: "Call mom",
      due: at(27, 12),
    });
    expect(
      parseRelayCommand("@relay remind me tomorrow at 9am to send the invoice", NOW),
    ).toMatchObject({ kind: "reminder", title: "Send the invoice", due: at(28, 9) });
  });

  it("reads a bare afternoon hour as PM", () => {
    expect(parseRelayCommand("remind me to call Sam tomorrow at 4", NOW)).toMatchObject({
      title: "Call Sam",
      due: at(28, 16),
    });
  });

  it("guesses tomorrow morning for a reminder without a time, and says so", () => {
    expect(parseRelayCommand("@relay remind me to stretch", NOW)).toMatchObject({
      due: at(28, 9),
      guessedTime: true,
    });
  });

  it("adds to-dos with tags and optional due dates", () => {
    expect(parseRelayCommand("@relay todo fix the sidebar width #bug", NOW)).toMatchObject({
      kind: "todo",
      title: "Fix the sidebar width",
      tags: ["bug"],
      due: null,
    });
    expect(parseRelayCommand("@relay need to email Priya friday", NOW)).toMatchObject({
      kind: "todo",
      title: "Email Priya",
      due: at(27 + 7, 9),
    });
  });

  it("keeps context and notes", () => {
    expect(parseRelayCommand("@relay remember we deploy from main", NOW)).toMatchObject({
      kind: "context",
      title: "We deploy from main",
    });
    expect(parseRelayCommand("@relay the login flow feels slow", NOW)).toMatchObject({
      kind: "note",
      title: "The login flow feels slow",
    });
  });

  it("ticks things off", () => {
    expect(parseRelayCommand("@relay done sidebar", NOW)).toEqual({
      type: "complete",
      query: "sidebar",
    });
  });

  it("hands outside work and chat references to the agent", () => {
    for (const text of [
      "@relay fetch me the latest issues from GitHub and update the to-do list",
      "@relay add this",
      "@relay save that as context",
      "@relay can you organize my notes?",
    ]) {
      expect(parseRelayCommand(text, NOW).type).toBe("agent");
    }
  });

  it("detects and strips the mention", () => {
    expect(isRelayMessage("hey @relay todo x")).toBe(true);
    expect(isRelayMessage("email me@relay.dev")).toBe(false);
    expect(stripRelayMention("@relay: todo x")).toBe("todo x");
    expect(parseRelayCommand("@relay", NOW)).toEqual({ type: "empty" });
  });
});
