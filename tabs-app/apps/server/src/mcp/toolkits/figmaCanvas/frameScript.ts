import { createHash } from "node:crypto";

export interface FigmaFrameScriptInput {
  readonly parentNodeId: string;
  readonly operationId: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}

const nodeIdPattern = /^\d{1,16}:\d{1,16}$/u;

function frameScriptPrelude(input: FigmaFrameScriptInput): string {
  const { parentNodeId, operationId, name, width, height, text } = input;
  if (typeof parentNodeId !== "string" || !nodeIdPattern.test(parentNodeId)) {
    throw new Error("Invalid Figma parent node ID.");
  }
  if (typeof operationId !== "string" || operationId.length === 0 || operationId.length > 256) {
    throw new Error("Invalid Figma frame operation ID.");
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 256) {
    throw new Error("Invalid Figma frame name.");
  }
  if (
    ![width, height].every(
      (dimension) => Number.isFinite(dimension) && dimension >= 0.01 && dimension <= 100_000,
    )
  ) {
    throw new Error("Invalid Figma frame dimensions.");
  }
  if (typeof text !== "string" || text.length === 0 || text.length > 8192) {
    throw new Error("Invalid Figma frame text.");
  }

  // Shared plugin data is public. Store only an opaque operation marker on the frame.
  const marker = createHash("sha256")
    .update(JSON.stringify([parentNodeId, operationId]))
    .digest("hex");
  const scriptInput = JSON.stringify({ parentNodeId, marker, name, width, height, text })
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

  return `
const input = ${scriptInput};
const nodeIdPattern = ${nodeIdPattern};
const namespace = "t3code";
const markerKey = "frameOperationV1";

function editablePage(parent) {
  if (!parent || parent.id !== input.parentNodeId ||
      !["PAGE", "SECTION", "FRAME"].includes(parent.type)) {
    throw new Error("The approved Figma parent is missing or unsupported.");
  }
  if (parent.type === "FRAME" && parent.layoutMode !== "NONE") {
    throw new Error("The approved Figma parent uses auto layout.");
  }
  for (let node = parent; node; node = node.parent) {
    if (node.removed) break;
    if (node.type === "PAGE") {
      if (!node.isPageDivider) return node;
      break;
    }
    if (("locked" in node && node.locked) ||
        ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(node.type)) {
      break;
    }
  }
  throw new Error("The approved Figma parent is not editable.");
}

function readMarkedFrame(parent) {
  let frame;
  for (const child of parent.children) {
    if (child.getSharedPluginData(namespace, markerKey) !== input.marker) continue;
    if (frame) throw new Error("Duplicate Figma frame operation markers.");
    frame = child;
  }
  if (!frame) return null;

  if (frame.type !== "FRAME" || frame.parent?.id !== parent.id || frame.removed || frame.locked ||
      frame.name !== input.name || frame.children.length !== 1 ||
      Math.fround(frame.width) !== Math.fround(input.width) ||
      Math.fround(frame.height) !== Math.fround(input.height)) {
    throw new Error("The marked Figma frame does not match the approved structure.");
  }
  const text = frame.children[0];
  if (text.type !== "TEXT" || text.parent?.id !== frame.id || text.removed || text.locked ||
      text.characters !== input.text ||
      typeof frame.id !== "string" || !nodeIdPattern.test(frame.id) ||
      typeof text.id !== "string" || !nodeIdPattern.test(text.id) ||
      frame.id === parent.id || text.id === frame.id || text.id === parent.id) {
    throw new Error("The marked Figma frame does not match the approved structure.");
  }

  return { parentNodeId: parent.id, frameNodeId: frame.id, textNodeId: text.id };
}

if (figma.editorType !== "figma") throw new Error("A Figma Design file is required.");
const parent = await figma.getNodeByIdAsync(input.parentNodeId);
const page = editablePage(parent);
await page.loadAsync();
if (editablePage(parent).id !== page.id) throw new Error("The approved Figma parent moved.");
const existing = readMarkedFrame(parent);
`;
}

export function buildFigmaFrameProbe(input: FigmaFrameScriptInput): string {
  return `${frameScriptPrelude(input)}
return existing ? { status: "existing", ...existing } : { status: "absent", parentNodeId: parent.id };
`;
}

export function buildFigmaFrameScript(input: FigmaFrameScriptInput): string {
  return `${frameScriptPrelude(input)}
if (existing) return { status: "existing", ...existing };

const font = { family: "Inter", style: "Regular" };
await figma.loadFontAsync(font);
if (figma.currentPage.id !== page.id) await figma.setCurrentPageAsync(page);
if (figma.currentPage.id !== page.id || editablePage(parent).id !== page.id) {
  throw new Error("The approved Figma parent moved.");
}

// Check again after the async setup, then complete all canvas writes synchronously.
const current = readMarkedFrame(parent);
if (current) return { status: "existing", ...current };

let x = 0;
if (parent.type === "PAGE") {
  for (const child of parent.children) {
    const bounds = child.absoluteBoundingBox;
    if (bounds) x = Math.max(x, bounds.x + bounds.width);
  }
  x += 64;
}

let frame;
let text;
try {
  frame = figma.createFrame();
  frame.setSharedPluginData(namespace, markerKey, input.marker);
  if (parent.type !== "PAGE") parent.appendChild(frame);
  frame.name = input.name;
  frame.resize(input.width, input.height);
  frame.x = x;
  frame.y = 0;

  text = figma.createText();
  text.fontName = font;
  frame.appendChild(text);
  text.x = 0;
  text.y = 0;
  text.characters = input.text;

  const created = readMarkedFrame(parent);
  if (created?.frameNodeId !== frame.id || created.textNodeId !== text.id) {
    throw new Error("The created Figma frame could not be verified.");
  }
  return { status: "created", ...created };
} catch (error) {
  // Creation APIs attach to the active page first. Remove only nodes allocated here.
  try {
    if (text && text.parent?.id !== frame?.id) text.remove();
  } finally {
    frame?.remove();
  }
  throw error;
}
`;
}
