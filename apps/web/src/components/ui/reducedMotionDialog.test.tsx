import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Dialog, DialogBackdrop } from "./dialog";
import { AlertDialog, AlertDialogBackdrop } from "./alert-dialog";
import { CommandDialog, CommandDialogBackdrop } from "./command";
import { Sheet, SheetBackdrop } from "./sheet";

describe("Reduced Motion in Dialog and Overlay Primitives", () => {
  it("includes Tailwind motion-reduce utility classes on dialog and overlay backdrops", () => {
    const dialogHtml = renderToStaticMarkup(
      <Dialog open>
        <DialogBackdrop />
      </Dialog>,
    );
    expect(dialogHtml).toContain("motion-reduce:transition-none");
    expect(dialogHtml).toContain("motion-reduce:duration-0");
    expect(dialogHtml).toContain('data-slot="dialog-backdrop"');

    const alertHtml = renderToStaticMarkup(
      <AlertDialog open>
        <AlertDialogBackdrop />
      </AlertDialog>,
    );
    expect(alertHtml).toContain("motion-reduce:transition-none");
    expect(alertHtml).toContain("motion-reduce:duration-0");
    expect(alertHtml).toContain('data-slot="alert-dialog-backdrop"');

    const commandHtml = renderToStaticMarkup(
      <CommandDialog open>
        <CommandDialogBackdrop />
      </CommandDialog>,
    );
    expect(commandHtml).toContain("motion-reduce:transition-none");
    expect(commandHtml).toContain("motion-reduce:duration-0");
    expect(commandHtml).toContain('data-slot="command-dialog-backdrop"');

    const sheetHtml = renderToStaticMarkup(
      <Sheet open>
        <SheetBackdrop />
      </Sheet>,
    );
    expect(sheetHtml).toContain("motion-reduce:transition-none");
    expect(sheetHtml).toContain("motion-reduce:duration-0");
    expect(sheetHtml).toContain('data-slot="sheet-backdrop"');
  });

  it("disables popup transitions without removing their final layout transforms", () => {
    const files = ["dialog.tsx", "alert-dialog.tsx", "command.tsx", "sheet.tsx"];
    for (const file of files) {
      const filePath = resolve(__dirname, file);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("motion-reduce:transition-none");
      expect(content).toContain("motion-reduce:duration-0");
      expect(content).not.toContain("motion-reduce:transform-none");
    }
  });

  it("declares global reduced-motion overrides in index.css for media query and data-reduced-motion attribute", () => {
    const cssPath = resolve(__dirname, "../../index.css");
    const cssContent = readFileSync(cssPath, "utf-8");

    expect(cssContent).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssContent).toContain('html[data-reduced-motion="reduce"]');

    const requiredSlots = [
      '[data-slot="dialog-backdrop"]',
      '[data-slot="dialog-popup"]',
      '[data-slot="alert-dialog-backdrop"]',
      '[data-slot="alert-dialog-popup"]',
      '[data-slot="command-dialog-backdrop"]',
      '[data-slot="command-dialog-popup"]',
      '[data-slot="sheet-backdrop"]',
      '[data-slot="sheet-popup"]',
    ];

    for (const slot of requiredSlots) {
      expect(cssContent).toContain(slot);
    }

    expect(cssContent).toContain("transition: none !important");
    expect(cssContent).toContain("animation: none !important");
    expect(cssContent).not.toContain("transform: none !important");
  });
});
