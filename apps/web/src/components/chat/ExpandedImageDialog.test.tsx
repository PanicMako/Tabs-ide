import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildExpandedImagePreview,
  downloadMedia,
  readMediaBlob,
  type ExpandedImagePreview,
} from "./ExpandedImagePreview";
import { ExpandedImageDialog } from "./ExpandedImageDialog";

beforeAll(() => {
  vi.stubGlobal("window", {
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("document", {
    activeElement: null,
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    createElement: (tag: string) => {
      if (tag === "a") {
        return {
          href: "",
          download: "",
          click: vi.fn(),
        };
      }
      return {};
    },
  });
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:mock-url"),
    revokeObjectURL: vi.fn(),
  });
});

describe("buildExpandedImagePreview", () => {
  it("returns null when no previewable images exist", () => {
    const preview = buildExpandedImagePreview([], "img-1");
    expect(preview).toBeNull();
  });

  it("returns null when selected image id is not found", () => {
    const preview = buildExpandedImagePreview(
      [{ id: "img-1", name: "Photo 1", previewUrl: "blob:1" }],
      "img-2",
    );
    expect(preview).toBeNull();
  });

  it("builds preview collection with correct active index", () => {
    const images = [
      { id: "img-1", name: "Photo 1", previewUrl: "blob:1" },
      { id: "img-2", name: "Photo 2", previewUrl: "blob:2" },
      { id: "img-3", name: "Photo 3", previewUrl: "blob:3" },
    ];
    const preview = buildExpandedImagePreview(images, "img-2");
    expect(preview).not.toBeNull();
    expect(preview?.images).toHaveLength(3);
    expect(preview?.index).toBe(1);
    expect(preview?.images[1]?.name).toBe("Photo 2");
    expect(preview?.images[1]?.src).toBe("blob:2");
  });

  it("identifies video attachments when present", () => {
    const items = [{ id: "v-1", name: "recording.mp4", previewUrl: "blob:video", type: "video" }];
    const preview = buildExpandedImagePreview(items, "v-1");
    expect(preview).not.toBeNull();
    expect(preview?.images[0]?.type).toBe("video");
  });
});

describe("downloadMedia", () => {
  it("creates object url and triggers anchor download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["mock content"], { type: "image/png" })),
      }),
    );

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement;
    document.createElement = vi.fn().mockImplementation((tag: string) => {
      if (tag === "a") {
        return {
          href: "",
          download: "",
          click: clickSpy,
        };
      }
      return originalCreateElement(tag);
    });

    await downloadMedia("https://example.com/test.png", "saved.png");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe("ExpandedImageDialog component markup", () => {
  it("renders image dialog with controls and counter", () => {
    const preview: ExpandedImagePreview = {
      images: [
        { src: "https://example.com/1.png", name: "First Image" },
        { src: "https://example.com/2.png", name: "Second Image" },
      ],
      index: 0,
    };

    const markup = renderToStaticMarkup(
      <ExpandedImageDialog preview={preview} onClose={() => {}} disablePortal />,
    );

    // Verifies accessibility & roles
    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain("First Image");
    expect(markup).toContain("(1 / 2)");

    // Verifies action buttons
    expect(markup).toContain("Zoom out");
    expect(markup).toContain("100%");
    expect(markup).toContain("Zoom in");
    expect(markup).toContain("Fit to screen");
    expect(markup).toContain("Copy image");
    expect(markup).toContain("Save image to disk");
    expect(markup).toContain("Close dialog");

    // Verifies navigation chevrons for multi-image preview
    expect(markup).toContain("Previous image");
    expect(markup).toContain("Next image");

    // Verifies image tag with proper src & alt
    expect(markup).toContain('src="https://example.com/1.png"');
    expect(markup).toContain('alt="First Image"');
  });

  it("omits navigation buttons when only one image is in preview", () => {
    const singlePreview: ExpandedImagePreview = {
      images: [{ src: "https://example.com/solo.png", name: "Solo" }],
      index: 0,
    };

    const markup = renderToStaticMarkup(
      <ExpandedImageDialog preview={singlePreview} onClose={() => {}} disablePortal />,
    );

    expect(markup).toContain("Solo");
    expect(markup).not.toContain("Previous image");
    expect(markup).not.toContain("Next image");
    expect(markup).not.toContain("(1 / 1)");
  });

  it("renders video element with controls and fullscreen button when item type is video", () => {
    const videoPreview: ExpandedImagePreview = {
      images: [{ src: "https://example.com/clip.mp4", name: "Clip.mp4", type: "video" }],
      index: 0,
    };

    const markup = renderToStaticMarkup(
      <ExpandedImageDialog preview={videoPreview} onClose={() => {}} disablePortal />,
    );

    expect(markup).toContain("<video");
    expect(markup).toContain('src="https://example.com/clip.mp4"');
    expect(markup).toContain("controls");
    expect(markup).toContain("Enter fullscreen");
  });
});
