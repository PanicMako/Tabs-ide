import { describe, expect, it, vi } from "vitest";

import { writeClipboardTextWithNativeFallback } from "./useCopyToClipboard";

describe("writeClipboardTextWithNativeFallback", () => {
  it("uses the native desktop clipboard when renderer access is denied", async () => {
    const rendererWriteText = vi.fn().mockRejectedValue(new Error("denied"));
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);

    await writeClipboardTextWithNativeFallback("/workspace/file.ts", {
      rendererWriteText,
      nativeWriteText: writeClipboardText,
    });

    expect(rendererWriteText).toHaveBeenCalledWith("/workspace/file.ts");
    expect(writeClipboardText).toHaveBeenCalledWith("/workspace/file.ts");
  });
});
