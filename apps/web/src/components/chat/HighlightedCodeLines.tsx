import type { DiffsHighlighter } from "@pierre/diffs";
import React, { cloneElement, memo, type CSSProperties } from "react";

export type HighlightedRoot = ReturnType<DiffsHighlighter["codeToHast"]>;
export type HighlightedNode = HighlightedRoot["children"][number];

function parseStyle(style: unknown): CSSProperties | undefined {
  if (!style || typeof style !== "string") return undefined;
  const result: Record<string, string> = {};
  for (const rule of style.split(";")) {
    const colon = rule.indexOf(":");
    if (colon === -1) continue;
    const prop = rule
      .slice(0, colon)
      .trim()
      .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
    const val = rule.slice(colon + 1).trim();
    if (prop && val) result[prop] = val;
  }
  return result;
}

function elementProps(properties: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!properties) return {};
  const { class: cls, className, style, tabindex, tabIndex, ...rest } = properties;
  const props: Record<string, unknown> = { ...rest };
  const classValue = className ?? cls;
  if (classValue) {
    props.className = Array.isArray(classValue) ? classValue.join(" ") : String(classValue);
  }
  if (style) {
    props.style = typeof style === "string" ? parseStyle(style) : style;
  }
  const ti = tabIndex ?? tabindex;
  if (ti !== undefined) {
    props.tabIndex = typeof ti === "string" ? parseInt(ti, 10) : ti;
  }
  return props;
}

function elementShell(node: Extract<HighlightedNode, { type: "element" }>) {
  return React.createElement(
    node.tagName,
    elementProps(node.properties as Record<string, unknown>),
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toHtml(
  node: HighlightedNode | { type: "root"; children: HighlightedNode[] },
): string {
  if (node.type === "text") {
    return escapeHtml(node.value ?? "");
  }
  if (node.type === "root") {
    return (node.children ?? []).map(toHtml).join("");
  }
  if (node.type === "element") {
    const props = (node.properties ?? {}) as Record<string, unknown>;
    let attrs = "";
    const cls = props.className ?? props.class;
    if (cls) {
      const classVal = Array.isArray(cls) ? cls.join(" ") : String(cls);
      attrs += ` class="${escapeHtml(classVal)}"`;
    }
    if (props.style) {
      attrs += ` style="${escapeHtml(String(props.style))}"`;
    }
    const ti = props.tabIndex ?? props.tabindex;
    if (ti !== undefined) {
      attrs += ` tabindex="${escapeHtml(String(ti))}"`;
    }
    for (const [key, val] of Object.entries(props)) {
      if (["class", "className", "style", "tabindex", "tabIndex"].includes(key)) continue;
      if (val === undefined || val === null || val === false) continue;
      attrs += ` ${key}="${escapeHtml(String(val))}"`;
    }
    const inner = (node.children ?? []).map(toHtml).join("");
    return `<${node.tagName}${attrs}>${inner}</${node.tagName}>`;
  }
  return "";
}

const HighlightedLine = memo(function HighlightedLine({ node }: { node: HighlightedNode }) {
  if (node.type !== "element") return <>{node.type === "text" ? node.value : null}</>;
  return cloneElement(elementShell(node), {
    dangerouslySetInnerHTML: { __html: toHtml({ type: "root", children: node.children ?? [] }) },
  });
});

/** Completed line nodes retain their identity in the incremental highlighter.
 * Keep their DOM mounted too: replacing the entire pre makes the browser parse
 * and resolve styles for thousands of unchanged token spans on each update.
 */
export function HighlightedCodeLines({ root }: { root: HighlightedRoot }) {
  const pre = root.children[0];
  if (pre?.type !== "element" || pre.tagName !== "pre") return null;
  const code = pre.children?.[0];
  if (code?.type !== "element" || code.tagName !== "code") return null;
  return cloneElement(
    elementShell(pre),
    undefined,
    cloneElement(
      elementShell(code),
      undefined,
      (code.children ?? []).map((node, index) => (
        // A line's position is stable as tokens and new lines are appended.
        <HighlightedLine key={index} node={node} />
      )),
    ),
  );
}
