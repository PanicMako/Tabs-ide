import "../../../index.css";
import JSZip from "jszip";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { OfficePreview } from "./OfficePreview";

async function blobUrl(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
}

it("shows the text of a Word document", async () => {
  const url = await blobUrl({
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Meeting notes</w:t></w:r></w:p></w:body></w:document>',
  });
  const view = await render(<OfficePreview url={url} extension="docx" />);
  try {
    await expect.element(page.getByText("Meeting notes")).toBeVisible();
  } finally {
    await view.unmount();
    URL.revokeObjectURL(url);
  }
});

it("shows a spreadsheet as a table under its sheet name", async () => {
  const url = await blobUrl({
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Budget"/></sheets></workbook>',
    "xl/worksheets/sheet1.xml":
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Rent</t></is></c><c r="B1"><v>900</v></c></row></sheetData></worksheet>',
  });
  const view = await render(<OfficePreview url={url} extension="xlsx" />);
  try {
    await expect.element(page.getByText("Budget", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Rent", { exact: true })).toBeVisible();
    await expect.element(page.getByText("900", { exact: true })).toBeVisible();
  } finally {
    await view.unmount();
    URL.revokeObjectURL(url);
  }
});

it("explains a file that is not a real Office document", async () => {
  const url = URL.createObjectURL(new Blob(["not a zip"]));
  const view = await render(<OfficePreview url={url} extension="docx" />);
  try {
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(page.getByText(/could not be opened/)).toBeVisible();
  } finally {
    await view.unmount();
    URL.revokeObjectURL(url);
  }
});
