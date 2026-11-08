import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// These are independent esbuild media projects, not extension-host main entrypoints.
export const CODE_OSS_EXTENSION_MEDIA = [
  "ipynb/notebook-out/cellAttachmentRenderer.js",
  "markdown-language-features/notebook-out/index.js",
  "markdown-language-features/media/index.js",
  "markdown-language-features/media/pre.js",
  "markdown-language-features/markdown-editor-out/editor.js",
  "markdown-language-features/markdown-editor-out/editor.css",
  "markdown-math/notebook-out/katex.js",
  "markdown-math/notebook-out/katex.min.css",
  "mermaid-markdown-features/chat-webview-out/index.js",
  "mermaid-markdown-features/markdown-preview-out/index.js",
  "mermaid-markdown-features/notebook-out/index.js",
  "mermaid-markdown-features/markdown-editor-out/index.js",
  "notebook-renderers/renderer-out/index.js",
  "simple-browser/media/index.js",
  "simple-browser/media/codicon.css",
] as const;

function cssUrls(value: string): string[] {
  return [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

/** Reject incomplete packaged webviews, including missing lazy chunks, CSS and fonts. */
export function verifyCodeOssExtensionMedia(
  extensionsRoot: string,
  entrypoints: readonly string[] = CODE_OSS_EXTENSION_MEDIA,
): { filesChecked: number } {
  const root = path.resolve(extensionsRoot);
  const pending = entrypoints.map((name) => path.resolve(root, name));
  const visited = new Set<string>();
  const resolveReference = (owner: string, reference: string): string | undefined => {
    if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(reference)) return undefined;
    const resolved = fileURLToPath(new URL(reference, pathToFileURL(owner)));
    const relative = path.relative(root, resolved);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Code-OSS media reference escapes extensions: ${owner}: ${reference}`);
    }
    return resolved;
  };
  while (pending.length) {
    const filename = pending.pop()!;
    if (visited.has(filename)) continue;
    visited.add(filename);
    if (
      !fs.existsSync(filename) ||
      !fs.statSync(filename).isFile() ||
      fs.statSync(filename).size === 0
    ) {
      throw new Error(`Missing Code-OSS extension media: ${path.relative(root, filename)}`);
    }
    if (filename.endsWith(".js")) {
      const source = ts.createSourceFile(
        filename,
        fs.readFileSync(filename, "utf8"),
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.JS,
      );
      const visit = (node: ts.Node): void => {
        let reference: string | undefined;
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          reference = node.moduleSpecifier.text;
        } else if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          reference = node.arguments[0].text;
        } else if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "URL" &&
          node.arguments?.[0] &&
          ts.isStringLiteral(node.arguments[0]) &&
          node.arguments[1]?.getText(source) === "import.meta.url"
        ) {
          reference = node.arguments[0].text;
        }
        if (reference?.startsWith(".")) {
          const dependency = resolveReference(filename, reference);
          if (dependency) pending.push(dependency);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    } else if (filename.endsWith(".css")) {
      let css = fs.readFileSync(filename, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      // Font declarations intentionally offer alternative formats; upstream ships woff2 only.
      css = css.replace(/\bsrc\s*:\s*([^;}]+)/g, (declaration) => {
        const candidates = cssUrls(declaration);
        if (
          candidates.length &&
          !candidates.some((url) => {
            const candidate = resolveReference(filename, url);
            return !candidate || (fs.existsSync(candidate) && fs.statSync(candidate).size > 0);
          })
        )
          throw new Error(`Missing Code-OSS media font in ${path.relative(root, filename)}`);
        return "";
      });
      for (const reference of cssUrls(css)) {
        const dependency = resolveReference(filename, reference);
        if (dependency) pending.push(dependency);
      }
      for (const match of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
        const dependency = resolveReference(filename, match[1]!);
        if (dependency) pending.push(dependency);
      }
    }
  }
  return { filesChecked: visited.size };
}
