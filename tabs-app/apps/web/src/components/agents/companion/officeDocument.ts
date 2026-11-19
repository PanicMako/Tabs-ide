import JSZip from "jszip";

export const OFFICE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 200;
const MAX_COLUMNS = 50;
const MAX_PARAGRAPHS = 2000;

export type OfficeDocument =
  | {
      readonly kind: "document";
      readonly paragraphs: ReadonlyArray<string>;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "spreadsheet";
      readonly sheets: ReadonlyArray<{
        readonly name: string;
        readonly rows: ReadonlyArray<ReadonlyArray<string>>;
        readonly truncated: boolean;
      }>;
    }
  | {
      readonly kind: "presentation";
      readonly slides: ReadonlyArray<ReadonlyArray<string>>;
    };

export function officeKindForExtension(extension: string): "docx" | "xlsx" | "pptx" | null {
  const value = extension.toLowerCase();
  return value === "docx" || value === "xlsx" || value === "pptx" ? value : null;
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

/** Elements by local name, whatever namespace prefix the file used. */
function byName(root: Document | Element, name: string): Element[] {
  return [...root.getElementsByTagNameNS("*", name)];
}

function paragraphText(paragraph: Element, textName: string): string {
  let text = "";
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (child.localName === textName) text += child.textContent ?? "";
      else if (child.localName === "tab") text += "\t";
      else if (child.localName === "br") text += "\n";
      else walk(child);
    }
  };
  walk(paragraph);
  return text;
}

function numericSuffix(path: string): number {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/** "AB12" is column 27 (zero based). */
export function columnIndex(reference: string): number {
  const letters = /^[A-Za-z]+/.exec(reference)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

async function readDocx(zip: JSZip): Promise<OfficeDocument> {
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("This Word document has no readable text.");
  const all = byName(parseXml(xml), "p").map((paragraph) => paragraphText(paragraph, "t"));
  return {
    kind: "document",
    paragraphs: all.slice(0, MAX_PARAGRAPHS),
    truncated: all.length > MAX_PARAGRAPHS,
  };
}

async function readPptx(zip: JSZip): Promise<OfficeDocument> {
  const paths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .toSorted((left, right) => numericSuffix(left) - numericSuffix(right));
  const slides: string[][] = [];
  for (const path of paths) {
    const xml = await zip.file(path)!.async("string");
    slides.push(
      byName(parseXml(xml), "p")
        .map((paragraph) => paragraphText(paragraph, "t"))
        .filter((text) => text.trim().length > 0),
    );
  }
  return { kind: "presentation", slides };
}

async function readXlsx(zip: JSZip): Promise<OfficeDocument> {
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const shared = sharedXml
    ? byName(parseXml(sharedXml), "si").map((item) =>
        byName(item, "t")
          .map((t) => t.textContent ?? "")
          .join(""),
      )
    : [];
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const names = workbookXml
    ? byName(parseXml(workbookXml), "sheet").map((sheet) => sheet.getAttribute("name") ?? "Sheet")
    : [];
  const paths = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .toSorted((left, right) => numericSuffix(left) - numericSuffix(right));
  const sheets = [];
  for (const [index, path] of paths.entries()) {
    const sheet = parseXml(await zip.file(path)!.async("string"));
    const rows: string[][] = [];
    let truncated = false;
    for (const row of byName(sheet, "row")) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      for (const cell of byName(row, "c")) {
        const column = columnIndex(cell.getAttribute("r") ?? "A1");
        if (column >= MAX_COLUMNS) continue;
        const type = cell.getAttribute("t");
        const raw = byName(cell, "v")[0]?.textContent ?? "";
        const value =
          type === "s"
            ? (shared[Number(raw)] ?? "")
            : type === "inlineStr"
              ? byName(cell, "t")
                  .map((t) => t.textContent ?? "")
                  .join("")
              : raw;
        while (cells.length < column) cells.push("");
        cells[column] = value;
      }
      rows.push(cells);
    }
    sheets.push({ name: names[index] ?? `Sheet ${index + 1}`, rows, truncated });
  }
  return { kind: "spreadsheet", sheets };
}

/** Reads the text of a Word, Excel or PowerPoint file in the browser. Nothing is written anywhere. */
export async function readOfficeDocument(
  bytes: ArrayBuffer,
  extension: string,
): Promise<OfficeDocument> {
  const kind = officeKindForExtension(extension);
  if (!kind) throw new Error("This file type has no preview.");
  if (bytes.byteLength > OFFICE_MAX_BYTES) {
    throw new Error("This file is over 16 MB. Open it in its own app.");
  }
  const zip = await JSZip.loadAsync(bytes).catch(() => {
    throw new Error("This file could not be opened. It may be damaged or password protected.");
  });
  return kind === "docx" ? readDocx(zip) : kind === "xlsx" ? readXlsx(zip) : readPptx(zip);
}
