import "../../index.css";
import "./providers.css";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { OpenRouterIcon, CopilotIcon, KiloIcon, OpenCodeIcon } from "../Icons";

it.each([
  { theme: "light", router: "rgb(118, 36, 244)", copilot: "rgb(133, 52, 243)" },
  { theme: "dark", router: "rgb(200, 255, 0)", copilot: "rgb(184, 112, 255)" },
])(
  "preserves $theme brand colors in selected directory rows and the header",
  async ({ theme, router, copilot }) => {
    const view = await render(
      <div className={theme === "dark" ? "dark" : ""}>
        <div className="provider-directory-list">
          <button
            className="provider-directory-select"
            type="button"
            aria-current="true"
            aria-label="OpenRouter"
          >
            <span className="provider-directory-icon">
              <OpenRouterIcon className="provider-brand-icon" data-provider="openrouter" />
            </span>
          </button>
        </div>
        <div className="provider-identity">
          <span className="provider-logo">
            <OpenRouterIcon className="provider-brand-icon" data-provider="openrouter" />
          </span>
          <CopilotIcon className="provider-brand-icon" data-provider="copilot" />
          <OpenCodeIcon className="size-4" />
          <KiloIcon className="provider-brand-icon" data-provider="kilo" />
        </div>
      </div>,
    );
    try {
      for (const icon of document.querySelectorAll('[data-provider="openrouter"]')) {
        expect(getComputedStyle(icon).color).toBe(router);
      }
      const openCodeIcon = document.querySelector('[data-provider="opencode"]')!;
      const outline = openCodeIcon.querySelectorAll("path")[1]!;
      expect(getComputedStyle(outline).fill).toBe(getComputedStyle(openCodeIcon).color);
      const copilotIcon = document.querySelector('[data-provider="copilot"]')!;
      expect(getComputedStyle(copilotIcon).color).toBe(copilot);
      const kiloIcon = document.querySelector('[data-provider="kilo"]')!;
      expect(getComputedStyle(kiloIcon).color).toBe("rgb(0, 0, 0)");
      expect(getComputedStyle(kiloIcon).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    } finally {
      await view.unmount();
    }
  },
);
