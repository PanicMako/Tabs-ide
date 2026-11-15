import { describe, expect, it } from "vitest";
import { seenUserMessageIds } from "./UserReadReceipt";

const user = (id: string) => ({ kind: "message", id: `row-${id}`, message: { id, role: "user" } });
const assistant = (id: string) => ({
  kind: "message",
  id: `row-${id}`,
  message: { id, role: "assistant" },
});

describe("seenUserMessageIds", () => {
  it("leaves a prompt unseen until the agent has done anything after it", () => {
    expect(seenUserMessageIds([user("a")]).has("a")).toBe(false);
  });

  it("marks a prompt seen once a reply, work or the working indicator follows", () => {
    expect(seenUserMessageIds([user("a"), assistant("r")]).has("a")).toBe(true);
    expect(seenUserMessageIds([user("a"), { kind: "work", id: "w" }]).has("a")).toBe(true);
    expect(seenUserMessageIds([user("a"), { kind: "working", id: "x" }]).has("a")).toBe(true);
  });

  it("only marks earlier prompts: the newest unanswered one stays unseen", () => {
    const seen = seenUserMessageIds([user("a"), assistant("r"), user("b")]);
    expect(seen.has("a")).toBe(true);
    expect(seen.has("b")).toBe(false);
  });
});
