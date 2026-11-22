import "../../index.css";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { POSITION_KEY, TeammatesCornerAvatar } from "./TeammatesCornerAvatar";

const props = (overrides: Partial<Parameters<typeof TeammatesCornerAvatar>[0]> = {}) =>
  ({
    teammate: { id: "tm-notch" as never, name: "Notch" },
    mood: "idle" as const,
    finish: "signature" as const,
    badge: 0,
    needs: [],
    teammates: [{ id: "tm-notch" as never, name: "Notch" }],
    open: false,
    onToggle: vi.fn(),
    onAsk: vi.fn(async (_text: string) => true),
    onOpenChat: vi.fn(),
    onOpenSpace: vi.fn(),
    onPin: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  }) as Parameters<typeof TeammatesCornerAvatar>[0] & { onAsk: ReturnType<typeof vi.fn> };

const avatar = () => page.getByRole("button", { name: /^Notch:/ });
const rect = () => avatar().element().getBoundingClientRect();
const saved = () =>
  JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as { x: number; y: number };

beforeEach(async () => {
  localStorage.removeItem(POSITION_KEY);
  await page.viewport(1440, 900);
});
afterEach(() => localStorage.removeItem(POSITION_KEY));

describe("the Notch avatar", () => {
  it("starts in the bottom-right corner and a plain click opens Teammates", async () => {
    const p = props();
    const view = await render(<TeammatesCornerAvatar {...p} />);
    await expect.poll(() => rect().right).toBeCloseTo(1440 - 16, 0);
    expect(rect().bottom).toBeCloseTo(900 - 16, 0);
    await avatar().click();
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("minimises with its minus without opening Teammates or starting a drag", async () => {
    const p = props();
    const view = await render(<TeammatesCornerAvatar {...p} />);
    await page
      .getByRole("button", { name: "Minimise Notch to the top bar" })
      .click({ force: true });
    expect(p.onHide).toHaveBeenCalledTimes(1);
    expect(p.onToggle).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("drags anywhere, persists normalized x/y, and a tiny wobble still clicks", async () => {
    const p = props();
    const view = await render(
      <>
        <div id="target" style={{ position: "fixed", left: 600, top: 300, width: 8, height: 8 }} />
        <TeammatesCornerAvatar {...p} />
      </>,
    );
    await expect.poll(() => rect().right).toBeGreaterThan(1000);
    await userEvent.dragAndDrop(avatar(), page.elementLocator(document.getElementById("target")!));
    await expect.poll(() => Math.round(rect().left + rect().width / 2)).toBeCloseTo(604, -1);
    expect(Math.round(rect().top + rect().height / 2)).toBeCloseTo(304, -1);
    expect(p.onToggle).not.toHaveBeenCalled();
    const position = saved();
    expect(position.x).toBeGreaterThan(0.2);
    expect(position.x).toBeLessThan(0.6);
    expect(position.y).toBeGreaterThan(0.2);
    expect(position.y).toBeLessThan(0.6);
    await avatar().click();
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("clamps a drop outside the window to the nearest free spot", async () => {
    const p = props();
    const view = await render(
      <>
        <div id="far" style={{ position: "fixed", left: 1438, top: 2, width: 2, height: 2 }} />
        <TeammatesCornerAvatar {...p} />
      </>,
    );
    await userEvent.dragAndDrop(avatar(), page.elementLocator(document.getElementById("far")!));
    await expect.poll(() => rect().right).toBeLessThanOrEqual(1440 - 16 + 0.5);
    expect(rect().top).toBeGreaterThanOrEqual(52 - 0.5);
    expect(rect().left).toBeGreaterThanOrEqual(0);
    expect(saved().x).toBeLessThanOrEqual(1);
    expect(saved().y).toBeGreaterThanOrEqual(0);
    await view.unmount();
  });

  it("moves with the arrow keys (Shift for bigger steps) and stays inside the window", async () => {
    const p = props();
    const view = await render(<TeammatesCornerAvatar {...p} />);
    await expect.poll(() => rect().right).toBeGreaterThan(1000);
    avatar().element().focus();
    const before = rect().left;
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => before - rect().left).toBeCloseTo(16, 0);
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await expect.poll(() => before - rect().left).toBeCloseTo(16 + 64, 0);
    const bottom = rect().bottom;
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect.poll(() => rect().bottom).toBeCloseTo(bottom, 0);
    expect(saved().x).toBeLessThan(1);
    expect(p.onToggle).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("stays inside the window when it shrinks", async () => {
    const p = props();
    const view = await render(<TeammatesCornerAvatar {...p} />);
    await expect.poll(() => rect().right).toBeCloseTo(1440 - 16, 0);
    await page.viewport(640, 480);
    await expect.poll(() => rect().right).toBeLessThanOrEqual(640);
    expect(rect().bottom).toBeLessThanOrEqual(480);
    await view.unmount();
  });

  it("shows a hover card with status, needs-you and a working Ask field", async () => {
    const p = props({
      mood: "needsYou",
      badge: 1,
      needs: [{ id: "i1", title: "Flaky test", question: "Retry or delete the flaky test?" }],
      teammates: [
        { id: "tm-notch" as never, name: "Notch" },
        { id: "tm-rae" as never, name: "Rae" },
      ],
    });
    const view = await render(<TeammatesCornerAvatar {...p} />);
    await avatar().hover();
    const ask = page.getByRole("textbox", { name: "Ask Notch" });
    await expect.element(ask).toBeVisible();
    await expect.element(page.getByText("Retry or delete the flaky test?")).toBeVisible();
    await ask.fill("status?");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => p.onAsk.mock.calls.length).toBe(1);
    expect(p.onAsk).toHaveBeenCalledWith("status?");
    await page.getByRole("button", { name: "Notch menu" }).click();
    await page.getByRole("menuitemradio", { name: "Rae" }).click();
    expect(p.onPin).toHaveBeenCalledWith("tm-rae");
    await expect.element(ask).not.toBeInTheDocument();
    await avatar().hover();
    await page.getByRole("button", { name: "Notch menu" }).click();
    await page.getByRole("menuitem", { name: /Minimise to the top bar/ }).click();
    expect(p.onHide).toHaveBeenCalled();
    await view.unmount();
  });
});
