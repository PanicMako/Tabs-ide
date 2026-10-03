import { lstat, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type {
  TestingLocatorRepositoryApplyInput,
  TestingLocatorRepositoryApplyResult,
  TestingLocatorRepositoryPreviewInput,
  TestingLocatorRepositoryProposal,
} from "@tabs/contracts";

import { shortDigest } from "./security";
import { LocatorLibraryStore } from "./locatorLibrary";

function staysInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function validateFileName(value: string): string {
  const fileName = value.trim();
  if (
    fileName.length > 120 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tsx?$/u.test(fileName) ||
    fileName.includes("..")
  ) {
    throw new Error("Use a simple TypeScript filename such as landing.page.ts");
  }
  return fileName;
}

async function destination(input: {
  readonly projectPath: string;
  readonly destinationFolder: string;
  readonly fileName: string;
}): Promise<{
  readonly projectRoot: string;
  readonly folderRoot: string;
  readonly destinationPath: string;
  readonly fileName: string;
  readonly relativePath: string;
}> {
  const projectRoot = await realpath(input.projectPath);
  const folderRoot = await realpath(input.destinationFolder);
  if (!staysInside(projectRoot, folderRoot)) {
    throw new Error("The page-object folder must stay inside the selected project");
  }
  const fileName = validateFileName(input.fileName);
  const destinationPath = resolve(folderRoot, fileName);
  if (!staysInside(folderRoot, destinationPath) || !staysInside(projectRoot, destinationPath)) {
    throw new Error("The page-object file must stay inside the selected folder and project");
  }
  return {
    projectRoot,
    folderRoot,
    destinationPath,
    fileName,
    relativePath: relative(projectRoot, destinationPath).replaceAll(sep, "/"),
  };
}

async function existingSource(path: string): Promise<{
  readonly code: string;
  readonly hash: string | null;
  readonly mode: number;
}> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error("Repository output cannot replace a symbolic link");
    if (!stats.isFile()) throw new Error("Repository output destination must be a file");
    const code = await readFile(path, "utf8");
    return { code, hash: shortDigest(code), mode: stats.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { code: "", hash: null, mode: 0o644 };
    }
    throw error;
  }
}

export async function previewLocatorRepositoryWrite(
  input: TestingLocatorRepositoryPreviewInput & { readonly store: LocatorLibraryStore },
): Promise<TestingLocatorRepositoryProposal> {
  const page = input.store
    .library(input.projectId)
    .pages.find((value) => value.id === input.pageId);
  if (!page?.pageObject)
    throw new Error("Generate a page object before choosing repository output");
  const target = await destination(input);
  const existing = await existingSource(target.destinationPath);
  const proposedCode = page.pageObject.code;
  const changeKind =
    existing.hash === null ? "create" : existing.code === proposedCode ? "unchanged" : "update";
  const selectedLocatorCount = page.entries.filter(
    (entry) =>
      entry.lifecycleStatus === "accepted" &&
      !Object.values(entry.arguments).some(
        (value) => typeof value === "string" && /<(?:PII_|REDACTED_)[^>]*>/u.test(value),
      ),
  ).length;
  if (selectedLocatorCount === 0) {
    throw new Error("Select at least one safe locator before writing a page object");
  }
  return {
    projectId: input.projectId,
    pageId: page.id,
    pageName: page.name,
    className: page.pageObject.className,
    fileName: target.fileName,
    relativePath: target.relativePath,
    artifactSourceHash: page.pageObject.sourceHash,
    destinationSourceHash: existing.hash,
    existingCode: existing.code,
    proposedCode,
    changeKind,
    selectedLocatorCount,
  };
}

export async function applyLocatorRepositoryWrite(
  input: TestingLocatorRepositoryApplyInput & { readonly store: LocatorLibraryStore },
): Promise<TestingLocatorRepositoryApplyResult> {
  const proposal = await previewLocatorRepositoryWrite({ ...input, store: input.store });
  if (proposal.artifactSourceHash !== input.expectedArtifactSourceHash) {
    throw new Error("The selected locators changed after this proposal was reviewed");
  }
  if (proposal.destinationSourceHash !== input.expectedDestinationSourceHash) {
    throw new Error("The repository file changed after this proposal was reviewed");
  }
  const target = await destination(input);
  if (proposal.changeKind !== "unchanged") {
    const reviewedDestination = await existingSource(target.destinationPath);
    if (reviewedDestination.hash !== input.expectedDestinationSourceHash) {
      throw new Error("The repository file changed while the reviewed update was being prepared");
    }
    const temporaryPath = resolve(
      target.folderRoot,
      `.${target.fileName}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, proposal.proposedCode, {
        encoding: "utf8",
        flag: "wx",
        mode: reviewedDestination.mode,
      });
      await rename(temporaryPath, target.destinationPath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
  const library = input.store.saveRepositoryTarget({
    projectId: input.projectId,
    pageId: input.pageId,
    folderPath: target.folderRoot,
    fileName: target.fileName,
    relativePath: target.relativePath,
    artifactSourceHash: proposal.artifactSourceHash,
  });
  return { proposal, library, appliedAt: new Date().toISOString() };
}
