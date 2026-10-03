import { basename, extname } from "node:path";

import ExcelJS from "exceljs";

export interface ParsedWorkbookCase {
  readonly externalId: string;
  readonly description: string;
  readonly steps: ReadonlyArray<string>;
  readonly expectedResults: ReadonlyArray<string>;
  readonly expectedResult: string;
  readonly sourceSheet: string;
  readonly sourceRow: number;
  readonly errors: ReadonlyArray<string>;
}

export interface ParsedWorkbook {
  readonly workbookName: string;
  readonly cases: ReadonlyArray<ParsedWorkbookCase>;
}

const HEADER_ALIASES = {
  caseId: new Set(["caseid", "testcaseid", "testid", "id", "case"]),
  description: new Set(["description", "testdescription", "scenario", "title", "testcase"]),
  steps: new Set(["steps", "teststeps", "procedure", "actions", "testprocedure"]),
} as const;

const EXPECTED_RESULT_ALIASES = new Set([
  "expectedresult",
  "expectedresults",
  "expectedoutcome",
  "outcome",
  "expected",
]);

function normalizedHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value)
      return value.richText
        .map((part) => part.text)
        .join("")
        .trim();
  }
  return String(value).trim();
}

export function parseSteps(value: string): ReadonlyArray<string> {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const numbered = normalized
    .split(/\n|(?=\s*\d+[.)]\s+)/)
    .map((step) => step.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter(Boolean);
  return numbered.length > 0 ? numbered : [normalized];
}

export function parseExpectedResults(value: string, stepCount: number): ReadonlyArray<string> {
  if (stepCount === 0) return [];
  const parsed = parseSteps(value);
  if (parsed.length > 1) {
    return Array.from({ length: stepCount }, (_, index) => parsed[index] ?? "");
  }
  return Array.from({ length: stepCount }, (_, index) =>
    index === stepCount - 1 ? (parsed[0] ?? "") : "",
  );
}

function findHeaderRow(worksheet: ExcelJS.Worksheet): {
  rowNumber: number;
  columns: Record<keyof typeof HEADER_ALIASES, number> & { readonly expectedResult?: number };
} | null {
  const lastCandidate = Math.min(worksheet.rowCount, 20);
  for (let rowNumber = 1; rowNumber <= lastCandidate; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const columns: Partial<Record<keyof typeof HEADER_ALIASES, number>> & {
      expectedResult?: number;
    } = {};
    row.eachCell((cell, columnNumber) => {
      const header = normalizedHeader(cell.value);
      for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
        [keyof typeof HEADER_ALIASES, ReadonlySet<string>]
      >) {
        if (!columns[field] && aliases.has(header)) columns[field] = columnNumber;
      }
      if (!columns.expectedResult && EXPECTED_RESULT_ALIASES.has(header)) {
        columns.expectedResult = columnNumber;
      }
    });
    if (columns.caseId && columns.description && columns.steps) {
      return {
        rowNumber,
        columns: {
          caseId: columns.caseId,
          description: columns.description,
          steps: columns.steps,
          ...(columns.expectedResult !== undefined
            ? { expectedResult: columns.expectedResult }
            : {}),
        },
      };
    }
  }
  return null;
}

export async function parseTestingWorkbook(workbookPath: string): Promise<ParsedWorkbook> {
  if (extname(workbookPath).toLowerCase() !== ".xlsx") {
    throw new Error("Testing imports require an .xlsx workbook");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const parsedCases: ParsedWorkbookCase[] = [];
  let foundRequiredColumns = false;

  for (const worksheet of workbook.worksheets) {
    const header = findHeaderRow(worksheet);
    if (!header) continue;
    foundRequiredColumns = true;
    for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const externalId = cellText(row.getCell(header.columns.caseId).value);
      const description = cellText(row.getCell(header.columns.description).value);
      const rawSteps = cellText(row.getCell(header.columns.steps).value);
      const expectedResult = header.columns.expectedResult
        ? cellText(row.getCell(header.columns.expectedResult).value)
        : "";
      if (!externalId && !description && !rawSteps) continue;
      const errors: string[] = [];
      if (!externalId) errors.push("Case ID is blank");
      if (!description) errors.push("Description is blank");
      const steps = parseSteps(rawSteps);
      const expectedResults = parseExpectedResults(expectedResult, steps.length);
      if (steps.length === 0) errors.push("Steps are blank or malformed");
      parsedCases.push({
        externalId: externalId || `ROW-${rowNumber}`,
        description,
        steps,
        expectedResults,
        expectedResult,
        sourceSheet: worksheet.name,
        sourceRow: rowNumber,
        errors,
      });
    }
  }

  if (!foundRequiredColumns) {
    throw new Error(
      "No worksheet contains the required Case ID, Description, and Steps columns (common aliases are accepted)",
    );
  }

  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const parsedCase of parsedCases) {
    const key = parsedCase.externalId.trim().toLowerCase();
    if (seenIds.has(key)) duplicateIds.add(key);
    seenIds.add(key);
  }

  return {
    workbookName: basename(workbookPath),
    cases: parsedCases.map((parsedCase) =>
      duplicateIds.has(parsedCase.externalId.trim().toLowerCase())
        ? { ...parsedCase, errors: [...parsedCase.errors, "Duplicate Case ID"] }
        : parsedCase,
    ),
  };
}
