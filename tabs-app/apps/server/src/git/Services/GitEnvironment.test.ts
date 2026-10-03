import { describe, expect, it } from "vitest";

import { parseGitHubAuthStatus } from "./GitEnvironment.ts";

describe("parseGitHubAuthStatus", () => {
  it("returns no accounts when not authenticated", () => {
    const output = ["You are not logged into any GitHub hosts. To log in, run: gh auth login"].join(
      "\n",
    );
    expect(parseGitHubAuthStatus(output)).toEqual([]);
  });

  it("parses a single signed-in account with scopes", () => {
    const output = [
      "github.com",
      "  ✓ Logged in to github.com account octocat (keyring)",
      "  - Active account: true",
      "  - Git operations protocol: https",
      "  - Token scopes: 'gist', 'read:org', 'repo'",
    ].join("\n");

    expect(parseGitHubAuthStatus(output)).toEqual([
      {
        host: "github.com",
        login: "octocat",
        active: true,
        scopes: ["gist", "read:org", "repo"],
      },
    ]);
  });

  it("parses multiple accounts and marks the active one", () => {
    const output = [
      "github.com",
      "  ✓ Logged in to github.com account work-user (keyring)",
      "  - Active account: true",
      "  - Token scopes: 'repo'",
      "  ✓ Logged in to github.com account personal-user (keyring)",
      "  - Active account: false",
      "  - Token scopes: 'repo', 'workflow'",
    ].join("\n");

    const accounts = parseGitHubAuthStatus(output);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ login: "work-user", active: true });
    expect(accounts[1]).toMatchObject({ login: "personal-user", active: false });
    expect(accounts.find((account) => account.active)?.login).toBe("work-user");
  });

  it("parses multiple hosts", () => {
    const output = [
      "github.com",
      "  ✓ Logged in to github.com account octocat (keyring)",
      "  - Active account: true",
      "github.example.com",
      "  ✓ Logged in to github.example.com account enterprise-user (keyring)",
      "  - Active account: true",
    ].join("\n");

    const accounts = parseGitHubAuthStatus(output);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ host: "github.com", login: "octocat" });
    expect(accounts[1]).toMatchObject({
      host: "github.example.com",
      login: "enterprise-user",
    });
  });

  it("handles the legacy 'as <login>' phrasing", () => {
    const output = [
      "github.com",
      "  ✓ Logged in to github.com as octocat (oauth_token)",
      "  ✓ Git operations for github.com configured to use https protocol.",
    ].join("\n");

    expect(parseGitHubAuthStatus(output)).toEqual([
      { host: "github.com", login: "octocat", active: false, scopes: [] },
    ]);
  });
});
