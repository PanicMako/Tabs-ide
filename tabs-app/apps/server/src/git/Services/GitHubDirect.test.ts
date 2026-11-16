import { describe, expect, it, vi } from "vitest";

import { directGraphqlFromGhArgs, parseGitHubRemote } from "./GitHubDirect.ts";

describe("parseGitHubRemote", () => {
  it.each([
    ["https://github.com/tabs/app.git", "github.com", "tabs", "app"],
    ["https://github.com/tabs/app", "github.com", "tabs", "app"],
    ["git@github.com:tabs/app.git", "github.com", "tabs", "app"],
    ["ssh://git@ghe.example.com/tabs/app.git", "ghe.example.com", "tabs", "app"],
  ])("reads %s", (url, host, owner, name) => {
    expect(parseGitHubRemote(url)).toEqual({ host, owner, name });
  });

  it("rejects what is not a remote", () => {
    expect(parseGitHubRemote("/local/path")).toBeNull();
  });
});

describe("resolveGitHubRepository", () => {
  const run = async (config: string, remoteUrl: string, env?: string) => {
    vi.resetModules();
    vi.doMock("../../processRunner", () => ({
      runProcess: vi.fn(async (_command: string, args: string[]) => ({
        stdout: args[0] === "config" ? config : remoteUrl,
        stderr: "",
        code: args[0] === "config" && config === "" ? 1 : 0,
        signal: null,
        timedOut: false,
      })),
    }));
    if (env === undefined) delete process.env.GH_REPO;
    else process.env.GH_REPO = env;
    const mod = await import("./GitHubDirect.ts");
    return mod.resolveGitHubRepository("/repo");
  };

  it("uses origin when gh has no default", async () => {
    expect(await run("", "git@github.com:me/fork.git\n")).toEqual({
      host: "github.com",
      owner: "me",
      name: "fork",
    });
  });

  it("follows `gh repo set-default` to another remote", async () => {
    expect(
      await run("remote.upstream.gh-resolved base\n", "https://github.com/org/app.git\n"),
    ).toEqual({ host: "github.com", owner: "org", name: "app" });
  });

  it("follows a default that names another repository", async () => {
    expect(
      await run("remote.origin.gh-resolved org/other\n", "https://github.com/me/fork.git\n"),
    ).toEqual({ host: "github.com", owner: "org", name: "other" });
  });

  it("lets GH_REPO win", async () => {
    expect(await run("", "https://github.com/me/fork.git\n", "acme/tool")).toEqual({
      host: "github.com",
      owner: "acme",
      name: "tool",
    });
    delete process.env.GH_REPO;
  });
});

describe("directGraphqlFromGhArgs", () => {
  const withFetch = async (run: () => Promise<unknown>, body: string, status = 200) => {
    process.env.TABS_FORCE_DIRECT_GRAPHQL = "1";
    const fetchMock = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      return { result: await run(), fetchMock };
    } finally {
      delete process.env.TABS_FORCE_DIRECT_GRAPHQL;
      vi.unstubAllGlobals();
    }
  };

  it("sends -f/-F fields as typed variables with the pinned token", async () => {
    const { result, fetchMock } = await withFetch(
      () =>
        directGraphqlFromGhArgs({
          cwd: "/r",
          token: "tok",
          args: [
            "api",
            "graphql",
            "--hostname",
            "github.com",
            "-f",
            "query=query{x}",
            "-F",
            "n=7",
            "-f",
            "s=7",
          ],
        }),
      '{"data":{"x":1}}',
    );
    expect(result).toBe('{"data":{"x":1}}');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      query: "query{x}",
      variables: { n: 7, s: "7" },
    });
    expect((init.headers as Record<string, string>).authorization).toBe("bearer tok");
  });

  it("reads --input - documents from stdin", async () => {
    const { result, fetchMock } = await withFetch(
      () =>
        directGraphqlFromGhArgs({
          cwd: "/r",
          token: "tok",
          args: ["api", "graphql", "--hostname", "ghe.example.com", "--input", "-"],
          stdin: JSON.stringify({ query: "query{y}", variables: { a: "b" } }),
        }),
      '{"data":{}}',
    );
    expect(result).toBe('{"data":{}}');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://ghe.example.com/api/graphql",
    );
  });

  it("declines what it cannot reproduce, and GraphQL errors, so the CLI runs", async () => {
    const decline = (args: string[]) =>
      withFetch(() => directGraphqlFromGhArgs({ cwd: "/r", token: "t", args }), "{}");
    expect((await decline(["api", "--paginate", "graphql"])).result).toBeNull();
    expect(
      (await decline(["api", "graphql", "-F", "owner={owner}", "-f", "query=q"])).result,
    ).toBeNull();
    expect((await decline(["api", "graphql", "--jq", ".x", "-f", "query=q"])).result).toBeNull();
    expect(
      (
        await withFetch(
          () =>
            directGraphqlFromGhArgs({
              cwd: "/r",
              token: "t",
              args: ["api", "graphql", "-f", "query=q"],
            }),
          '{"errors":[{"message":"bad"}]}',
        )
      ).result,
    ).toBeNull();
  });
});
