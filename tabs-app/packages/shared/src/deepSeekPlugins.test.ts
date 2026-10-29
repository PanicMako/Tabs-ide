import { describe, expect, it } from "vitest";
import { deepSeekPluginCommand, parseDeepSeekPluginOverrides } from "./deepSeekPlugins";
describe("DeepSeek plugin configuration", () => {
  it("preserves documented options and disabled state", () => {
    expect(
      parseDeepSeekPluginOverrides('[{"id":"search","disabled":false,"config":{"limit":8}}]'),
    ).toEqual([{ id: "search", disabled: false, config: { limit: 8 } }]);
    expect(parseDeepSeekPluginOverrides("")).toEqual([]);
  });
  it("rejects invalid configuration and changes to managed routing", () => {
    for (const input of [
      "{}",
      "[null]",
      '[{"id":"acp","disabled":true}]',
      '[{"id":"x","insert":[]}]',
      '[{"id":"x","disabled":"false"}]',
    ])
      expect(() => parseDeepSeekPluginOverrides(input)).toThrow();
  });
  it("quotes installation sources and uses the account's actual profile", () => {
    const command = deepSeekPluginCommand(
      { home: "/state/account one's", executable: "/bin/dsh" },
      "add",
      "github:user/plugin#v1",
    );
    expect(command).toContain("DSH_HOME='/state/account one'\\''s'");
    expect(command).toContain("plugin --profile acp add -- 'github:user/plugin#v1'");
    expect(() =>
      deepSeekPluginCommand({ home: "/state", executable: "dsh" }, "add", "--ignore-scripts"),
    ).toThrow();
    expect(
      deepSeekPluginCommand({ home: "C:\\Profile", executable: "dsh" }, "remove", "plugin", true),
    ).toBe("$env:DSH_HOME='C:\\Profile'; & 'dsh' plugin --profile acp remove -- 'plugin'");
  });
});
