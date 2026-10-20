import "../../../index.css";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CompanionEmpty, CompanionHeading } from "./CompanionChrome";
import { SurfaceChooser } from "./SurfaceTabs";

it.each([280, 360])("contains long project names and errors at %ipx", async (width) => {
  const token = "very-long-unbroken-project-or-error".repeat(30);
  const view = await render(
    <div style={{ width }}>
      <CompanionHeading
        kind="files"
        title={token}
        detail={token}
        actions={<button>Retry</button>}
      />
      <CompanionEmpty kind="browser" title={token}>
        {token}
      </CompanionEmpty>
    </div>,
  );
  try {
    for (const selector of [".companion-heading", ".companion-empty"]) {
      const element = document.querySelector<HTMLElement>(selector)!;
      expect(element.scrollWidth).toBeLessThanOrEqual(
        Math.ceil(element.getBoundingClientRect().width),
      );
    }
  } finally {
    await view.unmount();
  }
});

it.each([280, 360])("fits surface choices and shortcut hints at %ipx", async (width) => {
  const view = await render(
    <div style={{ width, height: 680, display: "flex" }}>
      <SurfaceChooser onSelect={() => {}} />
    </div>,
  );
  try {
    const chooser = document.querySelector<HTMLElement>(".surface-chooser")!;
    expect(chooser.scrollWidth).toBeLessThanOrEqual(chooser.clientWidth);
  } finally {
    await view.unmount();
  }
});
