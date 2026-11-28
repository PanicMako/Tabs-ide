import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { buildFigmaFrameProbe, buildFigmaFrameScript } from "./frameScript.ts";

class FakeNode {
  readonly data = new Map<string, string>();
  readonly layers: FakeNode[] = [];
  parent: FakeNode | null = null;
  name = "";
  width = 100;
  height = 100;
  x = 0;
  y = 0;
  loaded = false;
  locked = false;
  removed = false;
  isPageDivider = false;
  layoutMode = "NONE";

  constructor(
    readonly id: string,
    readonly type: string,
  ) {}

  get children(): readonly FakeNode[] {
    if (this.type === "PAGE" && !this.loaded) throw new Error("Page contents are unloaded");
    return [...this.layers];
  }

  get absoluteBoundingBox() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  async loadAsync() {
    this.loaded = true;
  }

  resize(width: number, height: number) {
    this.width = Math.fround(width);
    this.height = Math.fround(height);
  }

  appendChild(child: FakeNode) {
    child.detach();
    child.parent = this;
    this.layers.push(child);
  }

  remove() {
    this.detach();
    this.removed = true;
  }

  getSharedPluginData(namespace: string, key: string) {
    return this.data.get(`${namespace}/${key}`) ?? "";
  }

  setSharedPluginData(namespace: string, key: string, value: string) {
    this.data.set(`${namespace}/${key}`, value);
  }

  private detach() {
    if (this.parent) this.parent.layers.splice(this.parent.layers.indexOf(this), 1);
    this.parent = null;
  }
}

class FakeText extends FakeNode {
  fontName: { family: string; style: string } | undefined;
  private value = "";

  constructor(
    id: string,
    private readonly checkFont: (font: FakeText["fontName"]) => void,
  ) {
    super(id, "TEXT");
  }

  get characters() {
    return this.value;
  }

  set characters(value: string) {
    this.checkFont(this.fontName);
    this.value = value;
  }
}

const input = {
  operationId: "operation-123",
  parentNodeId: "2:4",
  name: 'Review "draft" \\ 日本語',
  width: 320.1,
  height: 180,
  text: '` ${arbitraryCode()} \\"; figma.createFrame(); //\nSecond line\u2028\u2029',
};

function setup() {
  const firstPage = new FakeNode("0:1", "PAGE");
  const targetPage = new FakeNode("2:1", "PAGE");
  const parent = new FakeNode(input.parentNodeId, "FRAME");
  const decoy = new FakeNode("2:3", "FRAME");
  const sibling = new FakeNode("2:5", "RECTANGLE");
  firstPage.loaded = true;
  firstPage.appendChild(decoy);
  targetPage.appendChild(parent);
  parent.appendChild(sibling);
  decoy.name = parent.name = input.name;
  sibling.name = "Existing rectangle";

  let nextId = 1;
  let loadedFont: { family: string; style: string } | undefined;
  const figma = {
    editorType: "figma",
    currentPage: firstPage,
    getNodeByIdAsync: vi.fn(async (id: string) => {
      return [firstPage, targetPage, parent, decoy, sibling].find((node) => node.id === id) ?? null;
    }),
    setCurrentPageAsync: vi.fn(async (page: FakeNode) => {
      await page.loadAsync();
      figma.currentPage = page;
    }),
    loadFontAsync: vi.fn(async (font: NonNullable<typeof loadedFont>) => {
      loadedFont = font;
    }),
    createFrame: vi.fn(() => {
      if (!loadedFont) throw new Error("Created frame before loading font");
      const frame = new FakeNode(`9:${nextId++}`, "FRAME");
      figma.currentPage.appendChild(frame);
      return frame;
    }),
    createText: vi.fn(() => {
      if (!loadedFont) throw new Error("Created text before loading font");
      const text = new FakeText(`9:${nextId++}`, (font) => {
        if (font?.family !== loadedFont?.family || font?.style !== loadedFont?.style) {
          throw new Error("Text has unloaded font");
        }
      });
      figma.currentPage.appendChild(text);
      return text;
    }),
  };

  function run(script: string): Promise<unknown> {
    // use_figma evaluates the script body in an async context and serializes its return value.
    return runInNewContext(`(async () => {\n${script}\n})()`, { figma }, { timeout: 1000 });
  }

  return { run, figma, firstPage, targetPage, parent, decoy, sibling };
}

describe("Figma frame scripts", () => {
  it("creates one native frame and text under the exact approved parent on another page", async () => {
    const { run, figma, firstPage, targetPage, parent, decoy, sibling } = setup();

    await expect(run(buildFigmaFrameScript(input))).resolves.toEqual({
      status: "created",
      parentNodeId: parent.id,
      frameNodeId: "9:1",
      textNodeId: "9:2",
    });

    const frame = parent.children[1]!;
    expect(frame.type).toBe("FRAME");
    expect(frame.name).toBe(input.name);
    expect(frame.width).toBe(Math.fround(input.width));
    expect(frame.height).toBe(input.height);
    expect(frame.children).toHaveLength(1);
    expect(frame.children[0]).toMatchObject({ type: "TEXT", characters: input.text });
    expect([...frame.data.values()]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
    expect(figma.getNodeByIdAsync.mock.calls).toEqual([[parent.id]]);
    expect(figma.setCurrentPageAsync.mock.calls).toEqual([[targetPage]]);
    expect(firstPage.children).toEqual([decoy]);
    expect(targetPage.children).toEqual([parent]);
    expect(decoy.children).toEqual([]);
    expect(parent.children).toEqual([sibling, frame]);
    expect(sibling.name).toBe("Existing rectangle");
    expect(sibling.data.size).toBe(0);
  });

  it("uses only the operation marker and recognizes an existing frame without writing", async () => {
    const { run, figma, firstPage, parent } = setup();
    const identical = new FakeNode("2:6", "FRAME");
    identical.name = input.name;
    identical.resize(input.width, input.height);
    const label = new FakeText("2:7", () => {});
    label.characters = input.text;
    identical.appendChild(label);
    parent.appendChild(identical);

    await expect(run(buildFigmaFrameProbe(input))).resolves.toEqual({
      status: "absent",
      parentNodeId: parent.id,
    });
    expect(figma.currentPage).toBe(firstPage);
    expect(figma.createFrame).not.toHaveBeenCalled();
    await run(buildFigmaFrameScript(input));

    figma.currentPage = firstPage;
    figma.setCurrentPageAsync.mockClear();
    figma.loadFontAsync.mockClear();
    const expected = {
      status: "existing",
      parentNodeId: parent.id,
      frameNodeId: "9:1",
      textNodeId: "9:2",
    };
    await expect(run(buildFigmaFrameProbe(input))).resolves.toEqual(expected);
    await expect(run(buildFigmaFrameScript(input))).resolves.toEqual(expected);
    expect(figma.setCurrentPageAsync).not.toHaveBeenCalled();
    expect(figma.loadFontAsync).not.toHaveBeenCalled();
    expect(figma.createFrame).toHaveBeenCalledTimes(1);
    expect(figma.createText).toHaveBeenCalledTimes(1);
    expect(identical.children).toEqual([label]);
    expect(identical.data.size).toBe(0);
  });

  it("rejects both partial and duplicate markers before loading a font or creating layers", async () => {
    const { run, figma, parent } = setup();
    await run(buildFigmaFrameScript(input));
    figma.loadFontAsync.mockClear();
    const markedFrame = parent.children[1]!;
    markedFrame.children[0]!.remove();

    for (const build of [buildFigmaFrameScript, buildFigmaFrameProbe]) {
      await expect(run(build(input))).rejects.toThrow("does not match the approved structure");
    }

    const duplicate = new FakeNode("2:6", "FRAME");
    for (const [key, value] of markedFrame.data) duplicate.data.set(key, value);
    parent.appendChild(duplicate);
    for (const build of [buildFigmaFrameScript, buildFigmaFrameProbe]) {
      await expect(run(build(input))).rejects.toThrow("Duplicate Figma frame operation markers");
    }
    expect(figma.loadFontAsync).not.toHaveBeenCalled();
    expect(figma.createFrame).toHaveBeenCalledTimes(1);
    expect(figma.createText).toHaveBeenCalledTimes(1);
  });

  it("refuses a mismatched lookup, unsupported parent, or parent inside an instance", async () => {
    const { run, figma, targetPage, parent, decoy, sibling } = setup();
    figma.getNodeByIdAsync.mockResolvedValueOnce(decoy);
    await expect(run(buildFigmaFrameScript(input))).rejects.toThrow("missing or unsupported");
    await expect(
      run(buildFigmaFrameScript({ ...input, parentNodeId: sibling.id })),
    ).rejects.toThrow("missing or unsupported");

    const instance = new FakeNode("2:6", "INSTANCE");
    targetPage.appendChild(instance);
    instance.appendChild(parent);
    await expect(run(buildFigmaFrameScript(input))).rejects.toThrow("not editable");
    expect(figma.createFrame).not.toHaveBeenCalled();
  });

  it("refuses auto-layout parents that could reposition siblings", async () => {
    const { run, figma, parent } = setup();
    parent.layoutMode = "VERTICAL";
    await expect(run(buildFigmaFrameScript(input))).rejects.toThrow("uses auto layout");
    expect(figma.createFrame).not.toHaveBeenCalled();
  });

  it("can create directly on the approved page beside its existing content", async () => {
    const { run, figma, firstPage, parent, targetPage } = setup();
    await expect(
      run(buildFigmaFrameScript({ ...input, parentNodeId: targetPage.id })),
    ).resolves.toMatchObject({ status: "created", parentNodeId: targetPage.id });
    expect(figma.currentPage).toBe(targetPage);
    expect(firstPage.children).toHaveLength(1);
    expect(targetPage.children).toEqual([parent, expect.objectContaining({ x: 164 })]);
  });

  it("checks for an existing operation again after loading the font", async () => {
    const { run, figma } = setup();
    const loadFont = figma.loadFontAsync.getMockImplementation()!;
    figma.loadFontAsync.mockImplementationOnce(async () => {
      await run(buildFigmaFrameScript(input));
      await loadFont({ family: "Inter", style: "Regular" });
    });

    await expect(run(buildFigmaFrameScript(input))).resolves.toMatchObject({
      status: "existing",
      frameNodeId: "9:1",
    });
    expect(figma.createFrame).toHaveBeenCalledTimes(1);
    expect(figma.createText).toHaveBeenCalledTimes(1);
  });

  it("leaves the canvas alone on font failure and cleans up only newly allocated layers on write failure", async () => {
    const { run, figma, parent, sibling, targetPage } = setup();
    figma.loadFontAsync.mockRejectedValueOnce(new Error("Font unavailable"));
    await expect(run(buildFigmaFrameScript(input))).rejects.toThrow("Font unavailable");
    expect(figma.createFrame).not.toHaveBeenCalled();
    expect(figma.createText).not.toHaveBeenCalled();

    figma.createText.mockImplementationOnce(() => {
      throw new Error("Text creation failed");
    });
    await expect(run(buildFigmaFrameScript(input))).rejects.toThrow("Text creation failed");
    expect(parent.children).toEqual([sibling]);
    expect(targetPage.children).toEqual([parent]);
    await expect(run(buildFigmaFrameProbe(input))).resolves.toEqual({
      status: "absent",
      parentNodeId: parent.id,
    });
  });

  it("rejects invalid operation input before generating executable source", () => {
    expect(() => buildFigmaFrameScript({ ...input, parentNodeId: "2-4" })).toThrow("node ID");
    expect(() => buildFigmaFrameProbe({ ...input, operationId: "" })).toThrow("operation ID");
    expect(() => buildFigmaFrameScript({ ...input, width: Infinity })).toThrow("dimensions");
    expect(() => buildFigmaFrameProbe({ ...input, height: 0 })).toThrow("dimensions");
    expect(() => buildFigmaFrameScript({ ...input, name: " " })).toThrow("frame name");
    expect(() => buildFigmaFrameProbe({ ...input, text: "a".repeat(8193) })).toThrow("frame text");
  });
});
