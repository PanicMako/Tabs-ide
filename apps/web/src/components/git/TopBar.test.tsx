import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TopBar } from "./TopBar";

const mockAccounts = [
  {
    host: "github.com",
    login: "mxyxyz9",
    active: true,
    scopes: ["repo", "read:org"],
  },
  {
    host: "github.com",
    login: "octocat",
    active: false,
    scopes: ["repo"],
  },
];

const defaultProps = {
  repoName: "ThrottleClan",
  branchLabel: "main",
  accentDotTone: "ok" as const,
  accounts: mockAccounts,
  activeAccountLogin: "mxyxyz9",
  terminalOpen: false,
  onToggleTerminal: vi.fn(),
  onSwitchAccount: vi.fn(),
  onOpenAccounts: vi.fn(),
  onOpenSignIn: vi.fn(),
};

describe("TopBar header tools", () => {
  it("renders repository name and branch label cleanly", () => {
    const markup = renderToStaticMarkup(<TopBar {...defaultProps} />);

    expect(markup).toContain("ThrottleClan");
    expect(markup).toContain("main");
  });

  it("renders the active GitHub account capsule with avatar and status dot", () => {
    const markup = renderToStaticMarkup(<TopBar {...defaultProps} />);

    expect(markup).toContain("mxyxyz9");
    expect(markup).toContain('aria-label="GitHub account @mxyxyz9 (In sync with remote)"');
    // GitHub avatar URL is targeted
    expect(markup).toContain("https://github.com/mxyxyz9.png?size=48");
    // Status dot color for "ok" tone
    expect(markup).toContain("bg-emerald-500");
  });

  it("renders warning tone for behind remote status", () => {
    const markup = renderToStaticMarkup(<TopBar {...defaultProps} accentDotTone="warn" />);

    expect(markup).toContain("bg-amber-500");
    expect(markup).toContain("Commits behind remote");
  });

  it("renders conflict tone for merge conflicts", () => {
    const markup = renderToStaticMarkup(<TopBar {...defaultProps} accentDotTone="bad" />);

    expect(markup).toContain("bg-rose-500");
    expect(markup).toContain("Merge conflict detected");
  });

  it("renders signed-out state when no active account is present", () => {
    const markup = renderToStaticMarkup(<TopBar {...defaultProps} activeAccountLogin={null} />);

    expect(markup).toContain("Sign in");
    expect(markup).toContain('aria-label="GitHub account sign in"');
  });

  it("renders terminal button in closed state with keyboard shortcut", () => {
    const markup = renderToStaticMarkup(<TopBar {...defaultProps} terminalOpen={false} />);

    expect(markup).toContain("Terminal");
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('aria-label="Open Git terminal drawer"');
    expect(markup).toContain("⌃`");
  });

  it("renders terminal button in active state with live indicator and Active badge", () => {
    const markup = renderToStaticMarkup(<TopBar {...defaultProps} terminalOpen={true} />);

    expect(markup).toContain("Terminal");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="Close Git terminal drawer"');
    expect(markup).toContain("Active");
    expect(markup).toContain("animate-ping");
  });
});
