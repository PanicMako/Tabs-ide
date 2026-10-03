import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TestingReport, TestingReportInput } from "@tabs/contracts";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { chromium } from "playwright";

import type { TestingGraphStore } from "./graphStore";
import { shortDigest } from "./security";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusColor(status: string): string {
  if (status === "passed") return "166534";
  if (status === "failed") return "991B1B";
  return "7A5A00";
}

function cell(text: string, width: number, header = false): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    ...(header ? { shading: { fill: "F2F4F7", type: ShadingType.CLEAR } } : {}),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0, line: 264 },
        children: [new TextRun({ text, bold: header, size: 20, font: "Calibri" })],
      }),
    ],
  });
}

function resultTable(run: ReturnType<TestingGraphStore["executionRuns"]>["runs"][number]): Table {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1700, 1450, 1250, 4960],
    borders: {
      top: { style: BorderStyle.SINGLE, color: "D1D5DB", size: 4 },
      bottom: { style: BorderStyle.SINGLE, color: "D1D5DB", size: 4 },
      left: { style: BorderStyle.SINGLE, color: "D1D5DB", size: 4 },
      right: { style: BorderStyle.SINGLE, color: "D1D5DB", size: 4 },
      insideHorizontal: { style: BorderStyle.SINGLE, color: "E5E7EB", size: 2 },
      insideVertical: { style: BorderStyle.SINGLE, color: "E5E7EB", size: 2 },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell("Case ID", 1700, true),
          cell("Status", 1450, true),
          cell("Duration", 1250, true),
          cell("Evidence / notes", 4960, true),
        ],
      }),
      ...run.results.map(
        (result) =>
          new TableRow({
            children: [
              cell(result.externalId, 1700),
              cell(result.status.toUpperCase(), 1450),
              cell(`${(result.durationMs / 1000).toFixed(1)} s`, 1250),
              cell(
                result.error?.slice(-400) ||
                  (result.tracePath ? `Trace: ${result.tracePath}` : "No failure evidence"),
                4960,
              ),
            ],
          }),
      ),
    ],
  });
}

export class TestingReporter {
  constructor(
    readonly store: TestingGraphStore,
    readonly testingRoot: string,
  ) {}

  async generate(input: TestingReportInput): Promise<TestingReport> {
    const runs = this.store.executionRuns(input.projectId).runs;
    const run = runs.find((candidate) => candidate.id === input.runId);
    if (!run) throw new Error("Execution run not found");
    if (run.mode !== "standalone" || !run.completedAt) {
      throw new Error("Sign-off reports require a completed Standalone/UAT run");
    }
    const completedAt = run.completedAt;
    const reportId = shortDigest(`${run.id}:${Date.now()}`);
    const reportRoot = join(this.testingRoot, "reports", reportId);
    await mkdir(reportRoot, { recursive: true });
    const docxPath = join(reportRoot, `testing-signoff-${reportId}.docx`);
    const pdfPath = join(reportRoot, `testing-signoff-${reportId}.pdf`);
    const passed = run.results.filter((result) => result.status === "passed").length;
    const failed = run.results.filter((result) => result.status === "failed").length;
    const blocked = run.results.filter((result) => result.status === "blocked").length;
    const currentIds = run.results
      .map((result) => result.caseId)
      .toSorted()
      .join("|");
    const previous = runs.find(
      (candidate) =>
        candidate.id !== run.id &&
        candidate.mode === "standalone" &&
        candidate.results
          .map((result) => result.caseId)
          .toSorted()
          .join("|") === currentIds,
    );
    const changes = run.results.map((result) => {
      const prior = previous?.results.find((candidate) => candidate.caseId === result.caseId);
      return `${result.externalId}: ${prior ? `${prior.status} -> ${result.status}` : "first verification"}`;
    });
    const metadata: ReadonlyArray<readonly [string, string]> = [
      ["Tester", input.testerName.trim() || "Not supplied"],
      ["Environment", input.environmentLabel?.trim() || run.targetUrl],
      ["Build", input.buildLabel?.trim() || run.artifactRevision],
      ["Completed", completedAt],
    ];
    const document = new Document({
      styles: {
        default: {
          document: {
            run: { font: "Calibri", size: 22 },
            paragraph: { spacing: { after: 120, line: 264 } },
          },
        },
        paragraphStyles: [
          {
            id: "Title",
            name: "Title",
            basedOn: "Normal",
            next: "Normal",
            run: { font: "Calibri", size: 46, bold: true, color: "0B2545" },
            paragraph: { spacing: { before: 0, after: 100 } },
          },
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { font: "Calibri", size: 32, bold: true, color: "2E74B5" },
            paragraph: { spacing: { before: 320, after: 160 } },
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { font: "Calibri", size: 26, bold: true, color: "2E74B5" },
            paragraph: { spacing: { before: 240, after: 120 } },
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440,
                header: 708,
                footer: 708,
              },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "TABS TESTING | SIGN-OFF REPORT",
                      color: "64748B",
                      size: 18,
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: "Page ", color: "64748B", size: 18 }),
                    new TextRun({ children: [PageNumber.CURRENT], color: "64748B", size: 18 }),
                  ],
                }),
              ],
            }),
          },
          children: [
            new Paragraph({
              heading: HeadingLevel.TITLE,
              children: [new TextRun("UAT Sign-off Report")],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Run ${run.id}`, color: "64748B", size: 22 })],
            }),
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun("Executive summary")],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `${passed} passed`, bold: true, color: statusColor("passed") }),
                new TextRun(
                  ` | ${failed} failed | ${blocked} blocked | ${run.results.length} total`,
                ),
              ],
            }),
            new Paragraph({
              text: `Overall result: ${run.status.toUpperCase()}. Flaky cases remain visible and quarantined rather than silently removed.`,
            }),
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun("Environment and verification")],
            }),
            ...metadata.map(
              ([label, value]) =>
                new Paragraph({
                  children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)],
                }),
            ),
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun("Case results")],
            }),
            resultTable(run),
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun("Round-over-round changes")],
            }),
            ...changes.map((change) => new Paragraph({ text: change, bullet: { level: 0 } })),
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun("Healing, visuals, and evidence")],
            }),
            new Paragraph({
              text: `${run.healingProposals.length} locator proposals were recorded. ${run.results.filter((result) => result.quarantined).length} cases are flaky/quarantined. ${run.results.filter((result) => result.visualStatus === "changed" || result.visualStatus === "review-required").length} visual changes require review.`,
            }),
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              children: [new TextRun("Traceability statement")],
            }),
            new Paragraph({
              text: "Every row above is linked in the local Testing database to its original Excel or generated case, generated artifact, execution evidence, and healing history.",
            }),
          ],
        },
      ],
    });
    await writeFile(docxPath, await Packer.toBuffer(document));

    const rows = run.results
      .map(
        (result) =>
          `<tr><td>${escapeHtml(result.externalId)}</td><td class="${result.status}">${escapeHtml(result.status.toUpperCase())}</td><td>${(result.durationMs / 1000).toFixed(1)} s</td><td>${escapeHtml(result.error?.slice(-400) || "No failure evidence")}</td></tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:Letter}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;font-size:11pt;line-height:1.4}h1{font-size:25pt;color:#0b2545;margin:0 0 4px}h2{font-size:16pt;color:#2e74b5;margin:24px 0 10px}h3{font-size:13pt;color:#2e74b5}.muted{color:#64748b}.summary{border-left:5px solid #2e74b5;background:#f4f6f9;padding:14px 16px;margin:18px 0}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d1d5db;padding:8px;vertical-align:top;overflow-wrap:anywhere}th{background:#f2f4f7;text-align:left}.passed{color:#166534;font-weight:700}.failed{color:#991b1b;font-weight:700}</style></head><body><h1>UAT Sign-off Report</h1><div class="muted">Run ${escapeHtml(run.id)} | ${escapeHtml(completedAt)}</div><div class="summary"><strong>${passed} passed</strong> | ${failed} failed | ${blocked} blocked | ${run.results.length} total<br>Overall: ${escapeHtml(run.status.toUpperCase())}</div><h2>Environment and verification</h2>${metadata.map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join("")}<h2>Case results</h2><table><thead><tr><th style="width:18%">Case ID</th><th style="width:15%">Status</th><th style="width:13%">Duration</th><th>Evidence / notes</th></tr></thead><tbody>${rows}</tbody></table><h2>Round-over-round changes</h2><ul>${changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul><h2>Traceability</h2><p>Every result maps to its original case, generated artifact, execution evidence, and healing history in the local Testing database.</p></body></html>`;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({
        path: pdfPath,
        format: "Letter",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font:9px Arial;color:#64748b;padding:0 1in;display:flex;justify-content:space-between"><span>Tabs Testing sign-off</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
        margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
      });
    } finally {
      await browser.close();
    }
    const saved = this.store.saveReport(run.id, docxPath, pdfPath);
    return { id: saved.id, runId: run.id, docxPath, pdfPath, createdAt: saved.createdAt };
  }
}
