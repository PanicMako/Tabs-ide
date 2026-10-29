import { beforeEach, describe, expect, it, vi } from "vitest";
import { render as renderComponent } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
const render = (element: ReactElement) =>
  renderComponent(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      {element}
    </QueryClientProvider>,
  );
import { useState } from "react";
import { page } from "vitest/browser";
import {
  useT3ProjectFileScripts,
  useT3ProjectFileState,
} from "../../hooks/useT3ProjectFileScripts";

const mockReadFile = vi.fn();

vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    projects: {
      readFile: mockReadFile,
    },
  }),
}));

function StateProbe({
  environmentId,
  cwd,
  onState,
}: {
  environmentId: string | undefined;
  cwd: string | null;
  onState: (state: ReturnType<typeof useT3ProjectFileState>) => void;
}) {
  const state = useT3ProjectFileState(environmentId, cwd);
  onState(state);
  return null;
}

function ScriptsProbe({
  environmentId,
  cwd,
  onScripts,
}: {
  environmentId: string | undefined;
  cwd: string | null;
  onScripts: (scripts: ReturnType<typeof useT3ProjectFileScripts>) => void;
}) {
  const scripts = useT3ProjectFileScripts(environmentId, cwd);
  onScripts(scripts);
  return null;
}

describe("useT3ProjectFileState and useT3ProjectFileScripts", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it("clears scripts synchronously on a machine switch while the next read is pending", async () => {
    mockReadFile.mockResolvedValueOnce({
      contents: JSON.stringify({ scripts: [{ name: "Old machine", command: "old-command" }] }),
      truncated: false,
    });
    mockReadFile.mockImplementationOnce(() => new Promise(() => {}));
    const observations: Array<{ environment: string; scripts: ReadonlyArray<unknown> }> = [];
    function SwitchingProbe() {
      const [environment, setEnvironment] = useState("first");
      const scripts = useT3ProjectFileScripts(environment, "/same-path");
      observations.push({ environment, scripts });
      return <button onClick={() => setEnvironment("second")}>Switch machine</button>;
    }
    const view = await render(<SwitchingProbe />);
    try {
      await expect.poll(() => observations.at(-1)?.scripts.length).toBe(1);
      await page.getByRole("button", { name: "Switch machine" }).click();
      await expect.poll(() => observations.at(-1)?.environment).toBe("second");
      expect(
        observations
          .filter((entry) => entry.environment === "second")
          .every((entry) => entry.scripts.length === 0),
      ).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it("returns missing status and empty scripts when cwd is null", async () => {
    let latestState: any = null;
    const view = await render(
      <StateProbe
        environmentId="env-1"
        cwd={null}
        onState={(s) => {
          latestState = s;
        }}
      />,
    );
    try {
      expect(latestState.status).toBe("missing");
      expect(latestState.file).toBeNull();
      expect(latestState.scripts).toEqual([]);
    } finally {
      await view.unmount();
    }
  });

  it("loads and parses scripts from t3.json", async () => {
    mockReadFile.mockResolvedValue({
      relativePath: "t3.json",
      contents: JSON.stringify({
        scripts: [
          {
            name: "Build",
            command: "bun run build",
            icon: "build",
          },
          {
            name: "Test",
            command: "bun test",
            icon: "test",
          },
        ],
      }),
      byteLength: 100,
      truncated: false,
    });

    let latestScripts: any = [];
    const view = await render(
      <ScriptsProbe
        environmentId="env-1"
        cwd="/workspace"
        onScripts={(s) => {
          latestScripts = s;
        }}
      />,
    );
    try {
      await expect.poll(() => latestScripts.length).toBe(2);
      expect(latestScripts).toEqual([
        { name: "Build", command: "bun run build", icon: "build" },
        { name: "Test", command: "bun test", icon: "test" },
      ]);
    } finally {
      await view.unmount();
    }
  });

  it("handles truncated file content as invalid status", async () => {
    mockReadFile.mockResolvedValue({
      relativePath: "t3.json",
      contents: '{"scripts":',
      byteLength: 1000000,
      truncated: true,
    });

    let latestState: any = null;
    const view = await render(
      <StateProbe
        environmentId="env-1"
        cwd="/workspace"
        onState={(s) => {
          latestState = s;
        }}
      />,
    );
    try {
      await expect.poll(() => latestState?.status).toBe("invalid");
      expect(latestState.scripts).toEqual([]);
      expect(latestState.file).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it("handles unparseable json as invalid status", async () => {
    mockReadFile.mockResolvedValue({
      relativePath: "t3.json",
      contents: "not json at all",
      byteLength: 20,
      truncated: false,
    });

    let latestState: any = null;
    const view = await render(
      <StateProbe
        environmentId="env-1"
        cwd="/workspace"
        onState={(s) => {
          latestState = s;
        }}
      />,
    );
    try {
      await expect.poll(() => latestState?.status).toBe("invalid");
      expect(latestState.scripts).toEqual([]);
    } finally {
      await view.unmount();
    }
  });

  it("handles readFile failure gracefully by marking status missing", async () => {
    mockReadFile.mockRejectedValue(new Error("File not found"));

    let latestState: any = null;
    const view = await render(
      <StateProbe
        environmentId="env-1"
        cwd="/workspace"
        onState={(s) => {
          latestState = s;
        }}
      />,
    );
    try {
      await expect.poll(() => latestState?.status).toBe("missing");
      expect(latestState.scripts).toEqual([]);
    } finally {
      await view.unmount();
    }
  });
});
