import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODE_OSS_EXTENSION_MEDIA, verifyCodeOssExtensionMedia } from "./code-oss-media";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-media-"));
  roots.push(root);
  for (const entry of CODE_OSS_EXTENSION_MEDIA) write(root, entry, "/* generated */");
  return root;
}
function write(root: string, name: string, value: string) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("packaged Code-OSS extension media", () => {
  it.each(CODE_OSS_EXTENSION_MEDIA)(
    "rejects missing %s despite a present extension main",
    (entry) => {
      const root = fixture();
      write(root, "markdown-language-features/dist/extension.js", "/* extension host */");
      fs.unlinkSync(path.join(root, entry));
      expect(() => verifyCodeOssExtensionMedia(root)).toThrow("Missing Code-OSS extension media");
    },
  );
  it("follows static and lazy JavaScript imports without confusing strings for imports", () => {
    const root = fixture();
    const editor = "markdown-language-features/markdown-editor-out/editor.js";
    write(
      root,
      editor,
      'import "./chunk.js"; import("./lazy.js"); const example = "import \\\"./not-an-import.js\\\"";',
    );
    write(root, editor.replace("editor.js", "chunk.js"), "/* chunk */");
    expect(() => verifyCodeOssExtensionMedia(root)).toThrow("lazy.js");
    write(root, editor.replace("editor.js", "lazy.js"), "/* lazy */");
    expect(verifyCodeOssExtensionMedia(root).filesChecked).toBe(
      CODE_OSS_EXTENSION_MEDIA.length + 2,
    );
  });
  it("requires assets referenced through import.meta.url", () => {
    const root = fixture();
    write(root, CODE_OSS_EXTENSION_MEDIA[0], 'new URL("./worker.js", import.meta.url)');
    expect(() => verifyCodeOssExtensionMedia(root)).toThrow("worker.js");
  });
  it("requires CSS assets and accepts available font format alternatives", () => {
    const root = fixture();
    const css = "markdown-language-features/markdown-editor-out/editor.css";
    write(
      root,
      css,
      '@font-face{src:url("./font.woff2") format("woff2"),url("./font.ttf") format("truetype")}',
    );
    expect(() => verifyCodeOssExtensionMedia(root)).toThrow("media font");
    write(root, css.replace("editor.css", "font.woff2"), "font");
    expect(() => verifyCodeOssExtensionMedia(root)).not.toThrow();
    write(root, css, '.icon{background:url("./missing.svg")}');
    expect(() => verifyCodeOssExtensionMedia(root)).toThrow("missing.svg");
  });
  it("rejects empty output", () => {
    const root = fixture();
    write(root, CODE_OSS_EXTENSION_MEDIA[0], "");
    expect(() => verifyCodeOssExtensionMedia(root)).toThrow("Missing Code-OSS extension media");
  });
});
