import JSZip from "jszip";
import { expect, it } from "vitest";
import { columnIndex, readOfficeDocument } from "./officeDocument";

async function build(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "arraybuffer" });
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

it("reads the paragraphs of a Word document, with tabs and line breaks", async () => {
  const bytes = await build({
    "word/document.xml": `<w:document ${W}><w:body>
      <w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p>
      <w:p><w:r><w:t>Revenue</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>up</w:t><w:br/><w:t>again</w:t></w:r></w:p>
    </w:body></w:document>`,
  });
  const document = await readOfficeDocument(bytes, "docx");
  expect(document).toEqual({
    kind: "document",
    paragraphs: ["Quarterly report", "Revenue\tup\nagain"],
    truncated: false,
  });
});

it("reads sheets with shared strings, inline strings, numbers and gaps", async () => {
  const bytes = await build({
    "xl/workbook.xml": `<workbook ${S}><sheets><sheet name="Sales"/><sheet name="Notes"/></sheets></workbook>`,
    "xl/sharedStrings.xml": `<sst ${S}><si><t>Item</t></si><si><t>Total</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet ${S}><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Pens</t></is></c><c r="C2"><v>42</v></c></row>
    </sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData></worksheet>`,
  });
  const document = await readOfficeDocument(bytes, "xlsx");
  expect(document.kind).toBe("spreadsheet");
  if (document.kind !== "spreadsheet") return;
  expect(document.sheets.map((sheet) => sheet.name)).toEqual(["Sales", "Notes"]);
  expect(document.sheets[0]?.rows).toEqual([
    ["Item", "", "Total"],
    ["Pens", "", "42"],
  ]);
  expect(document.sheets[1]?.rows).toEqual([["hello"]]);
});

it("reads the text of each slide in order", async () => {
  const slide = (text: string) =>
    `<p:sld xmlns:p="x" ${A}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const bytes = await build({
    "ppt/slides/slide10.xml": slide("Last"),
    "ppt/slides/slide2.xml": slide("Second"),
    "ppt/slides/slide1.xml": slide("First"),
  });
  const document = await readOfficeDocument(bytes, "pptx");
  expect(document).toEqual({ kind: "presentation", slides: [["First"], ["Second"], ["Last"]] });
});

it("explains files it cannot read", async () => {
  await expect(readOfficeDocument(new TextEncoder().encode("nope").buffer, "docx")).rejects.toThrow(
    /could not be opened/,
  );
  await expect(readOfficeDocument(new ArrayBuffer(0), "doc")).rejects.toThrow(/no preview/);
});

it("turns column letters into positions", () => {
  expect(columnIndex("A1")).toBe(0);
  expect(columnIndex("Z9")).toBe(25);
  expect(columnIndex("AB12")).toBe(27);
});
