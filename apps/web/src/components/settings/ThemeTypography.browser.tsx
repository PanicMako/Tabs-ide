import "../../index.css";
import "../agents/companion/companion.css";
import { useState, type CSSProperties } from "react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Input } from "../ui/input";
function Typography() {
  const [font, setFont] = useState("Arial");
  return (
    <div
      style={
        {
          "--font-sans": font,
          "--font-mono": "Courier New",
          fontFamily: "var(--font-sans)",
        } as CSSProperties
      }
    >
      <Input aria-label="Profile name" />
      <textarea aria-label="Description" />
      <div className="font-mono">
        <input aria-label="Code input" />
      </div>
      <pre>
        <code>const code = true;</code>
      </pre>
      <span className="stash-draft-title">Saved draft</span>
      <button onClick={() => setFont("Verdana")}>Change font</button>
    </div>
  );
}
it("theme fonts reach forms and companion titles while code inputs keep the code font", async () => {
  const view = await render(<Typography />);
  const font = (label: string) =>
    getComputedStyle(page.getByRole("textbox", { name: label }).element()).fontFamily;
  try {
    expect(font("Profile name")).toContain("Arial");
    expect(font("Description")).toContain("Arial");
    expect(font("Code input")).toContain("Courier New");
    expect(getComputedStyle(page.getByText("const code = true;").element()).fontFamily).toContain(
      "Courier New",
    );
    expect(getComputedStyle(page.getByText("Saved draft").element()).fontFamily).toContain("Arial");
    await page.getByRole("button", { name: "Change font" }).click();
    expect(font("Profile name")).toContain("Verdana");
    expect(font("Description")).toContain("Verdana");
    expect(font("Code input")).toContain("Courier New");
    expect(getComputedStyle(page.getByText("const code = true;").element()).fontFamily).toContain(
      "Courier New",
    );
    expect(getComputedStyle(page.getByText("Saved draft").element()).fontFamily).toContain(
      "Verdana",
    );
  } finally {
    await view.unmount();
  }
});
