import "../../index.css";
import "../../localFonts.css";
import { expect, it } from "vitest";
import { CURATED_FONT_COMBOS as FONT_COMBOS } from "../../lib/themes";

it("loads every personality preset's actual interface and heading font from bundled assets", async () => {
  for (const combo of FONT_COMBOS.filter((item) => !item.isNeutral)) {
    for (const [family, italic] of [
      [combo.uiFont, false],
      [combo.headingFont, combo.id === "syne-dropped"],
    ] as const) {
      const name = family.split(",")[0]!;
      const faces = await document.fonts.load(
        `${italic ? "italic " : ""}400 28px ${name}`,
        "Themes General Notifications",
      );
      expect(faces.length, `${combo.name}: ${name}`).toBeGreaterThan(0);
      expect(faces.every((face) => face.status === "loaded")).toBe(true);
    }
  }
});
