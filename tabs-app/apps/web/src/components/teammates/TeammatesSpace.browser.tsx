import "../../index.css";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TeammatesPanel } from "./TeammatesPanel";
import { TeammateMemory } from "./TeammateMemory";
import {
  createFakeTeammatesApi,
  makeActivity,
  makeFact,
  makeItem,
  makeSuggestion,
  makeTeammate,
} from "./teammates.testkit";
import { useTeammatesStore, useTeammatesUiStore } from "./teammatesStore";

type Fake = ReturnType<typeof createFakeTeammatesApi>;

function mount(ui: ReactNode) {
  const root = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

const NOTCH = makeTeammate({ id: "tm-notch", name: "Notch" });
const RAE = makeTeammate({ id: "tm-rae", name: "Rae", finish: "ivory-ink" });

function seed(overrides: Parameters<typeof createFakeTeammatesApi>[0] = {}): Fake {
  const fake = createFakeTeammatesApi({
    teammates: [NOTCH],
    activity: [makeActivity(NOTCH.id)],
    ...overrides,
  });
  fake.install();
  return fake;
}

function openSpace(introSeen = true) {
  useTeammatesUiStore.setState({
    panelOpen: true,
    spaceMode: "teammate",
    activeTeammateId: null,
    pinnedTeammateId: null,
    introSeen,
  });
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  document.documentElement.classList.remove("dark");
});
afterEach(() => {
  useTeammatesStore.getState().setSnapshot(null);
  useTeammatesUiStore.setState({ panelOpen: false, spaceMode: "teammate" });
});

describe("the Teammates space", () => {
  it("closes with the X button, with Escape, and sits below the window's drag region", async () => {
    seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    const dialog = page.getByRole("dialog", { name: "Teammates" });
    await expect.element(dialog).toBeVisible();
    const close = page.getByRole("button", { name: "Close Teammates" });
    const box = close.element().getBoundingClientRect();
    // The X is the topmost element at its own centre and below the 52px title bar.
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    expect(close.element().contains(hit)).toBe(true);
    expect(box.top).toBeGreaterThanOrEqual(52);
    // Electron drag regions swallow clicks: the whole surface must opt out.
    const popup = dialog.element() as HTMLElement;
    expect(popup.classList.contains("no-drag")).toBe(true);
    await close.click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(useTeammatesUiStore.getState().panelOpen).toBe(false);

    openSpace();
    useTeammatesUiStore.getState().setPanelOpen(true);
    await expect.element(page.getByRole("dialog", { name: "Teammates" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Teammates" })).not.toBeInTheDocument();
    await view.unmount();
  });

  it("deletes the only teammate after confirming, and stays deleted", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("button", { name: "More for Notch" }).click();
    await page.getByRole("menuitem", { name: /Delete Notch/ }).click();
    const confirm = page.getByRole("alertdialog");
    await expect.element(confirm).toBeVisible();
    await expect.element(confirm).toHaveTextContent(/Removed for good/);
    await expect.element(confirm).toHaveTextContent(/threads its workers started/);
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => fake.api.delete.mock.calls.length).toBe(1);
    expect(fake.api.delete).toHaveBeenCalledWith({ id: "tm-notch" });
    await expect
      .element(page.getByRole("heading", { name: "Create your first teammate" }))
      .toBeVisible();
    expect(fake.snapshot.teammates).toHaveLength(0);
    // The space is still open: the confirm did not take it down with it.
    await expect.element(page.getByRole("dialog", { name: "Teammates" })).toBeVisible();
    await view.unmount();
  });

  it("cancelling the confirm deletes nothing; deleting one of two keeps the other", async () => {
    const fake = seed({
      teammates: [NOTCH, RAE],
      activity: [makeActivity(NOTCH.id), makeActivity(RAE.id)],
    });
    openSpace();
    useTeammatesUiStore.setState({ activeTeammateId: RAE.id });
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("button", { name: "More for Rae" }).click();
    await page.getByRole("menuitem", { name: /Delete Rae/ }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(fake.api.delete).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "More for Rae" }).click();
    await page.getByRole("menuitem", { name: /Delete Rae/ }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => fake.snapshot.teammates.map((t) => t.name)).toEqual(["Notch"]);
    await expect.element(page.getByRole("button", { name: "More for Notch" })).toBeVisible();
    await view.unmount();
  });

  it("renames in place with Enter and cancels with Escape", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("button", { name: "Rename Notch" }).click();
    await page.getByRole("textbox", { name: "Teammate name" }).fill("Juno");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => fake.api.update.mock.calls.length).toBe(1);
    expect(fake.api.update).toHaveBeenCalledWith({ id: "tm-notch", patch: { name: "Juno" } });
    await expect.element(page.getByRole("button", { name: "Rename Juno" })).toBeVisible();
    await page.getByRole("button", { name: "Rename Juno" }).click();
    await page.getByRole("textbox", { name: "Teammate name" }).fill("Nope");
    await userEvent.keyboard("{Escape}");
    expect(fake.api.update).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole("dialog", { name: "Teammates" })).toBeVisible();
    await view.unmount();
  });

  it("asks the teammate: Enter sends into its home chat and offers to jump in", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    const field = page.getByRole("textbox", { name: "Ask Notch" });
    await field.fill("What is stuck?");
    await expect.element(field).toHaveValue("What is stuck?");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => fake.dispatchCommand.mock.calls.length).toBe(1);
    const sent = fake.dispatchCommand.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      type: "message.dispatch",
      threadId: "home-tm-notch",
      text: "What is stuck?",
    });
    await expect.element(page.getByText(/will answer in its chat/)).toBeVisible();
    await expect.element(field).toHaveValue("");
    await page.getByRole("button", { name: "Jump in" }).click();
    expect(fake.api.openHome).toHaveBeenCalled();
    await expect.element(page.getByRole("dialog", { name: "Teammates" })).not.toBeInTheDocument();
    await view.unmount();
  });

  it("works through Needs you, Working on and Up next", async () => {
    const fake = seed({
      teammates: [{ ...NOTCH, projectId: "project-1" as never }],
      activity: [makeActivity(NOTCH.id, { mood: "needsYou", needsYouCount: 1, workingCount: 1 })],
      items: [
        makeItem({
          id: "i1",
          teammateId: NOTCH.id,
          title: "Fix flaky auth test",
          status: "needsYou",
          question: "Retry it three times, or delete it?",
        }),
        makeItem({
          id: "i2",
          teammateId: NOTCH.id,
          title: "Bump the SDK",
          status: "working",
          workerThreadIds: ["w1" as never],
        }),
      ],
      suggestions: [
        makeSuggestion({
          id: "s1",
          teammateId: NOTCH.id,
          title: "Add tests for the cache",
          why: "No coverage.",
        }),
        makeSuggestion({ id: "s2", teammateId: NOTCH.id, title: "Remove dead flags" }),
      ],
    });
    openSpace();
    const view = await mount(<TeammatesPanel />);
    const needs = page.getByRole("region", { name: "Needs you" });
    await expect.element(needs).toHaveTextContent("Retry it three times, or delete it?");
    await expect
      .element(page.getByRole("region", { name: "Working on" }))
      .toHaveTextContent("Bump the SDK");
    await needs.getByRole("button", { name: "Mark done" }).click();
    await expect.poll(() => fake.api.updateItem.mock.calls.length).toBe(1);
    expect(fake.api.updateItem).toHaveBeenCalledWith({ id: "i1", patch: { status: "done" } });
    await expect.element(page.getByRole("region", { name: "Needs you" })).not.toBeInTheDocument();

    const up = page.getByRole("region", { name: "Up next" });
    await up.getByRole("button", { name: "Not now" }).first().click();
    await expect.poll(() => fake.api.dismissSuggestion.mock.calls.length).toBe(1);
    await up.getByRole("button", { name: "Start" }).click();
    await expect.poll(() => fake.api.startSuggestion.mock.calls.length).toBe(1);
    await view.unmount();
  });

  it("asks for a project before Start when the teammate has none", async () => {
    const fake = seed({
      suggestions: [makeSuggestion({ id: "s1", teammateId: NOTCH.id, title: "Tidy the README" })],
    });
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("button", { name: "Start" }).click();
    expect(fake.api.startSuggestion).not.toHaveBeenCalled();
    await expect.element(page.getByRole("alert")).toHaveTextContent(/needs a project/);
    await page.getByRole("button", { name: "Choose a project" }).click();
    await expect.element(page.getByRole("tab", { name: "Settings", selected: true })).toBeVisible();
    await view.unmount();
  });

  it("teaches in the empty state and turns on looking around", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await expect.element(page.getByText("Nothing in flight")).toBeVisible();
    await page.getByRole("button", { name: "Turn on looking around" }).click();
    await expect.poll(() => fake.api.update.mock.calls.length).toBe(1);
    expect(fake.api.update).toHaveBeenCalledWith({
      id: "tm-notch",
      patch: { lookAround: { enabled: true } },
    });
    await page.getByRole("button", { name: "Look around now" }).click();
    await expect.poll(() => fake.api.lookAroundNow.mock.calls.length).toBe(1);
    await view.unmount();
  });

  it("shows the first-run intro once and keeps it dismissed", async () => {
    seed();
    openSpace(false);
    const view = await mount(<TeammatesPanel />);
    const intro = page.getByRole("region", { name: "Meet Notch" });
    await expect.element(intro).toBeVisible();
    await intro.getByRole("button", { name: "What should I be working on today?" }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Ask Notch" }))
      .toHaveValue("What should I be working on today?");
    await intro.getByRole("button", { name: "Got it" }).click();
    await expect.element(intro).not.toBeInTheDocument();
    expect(useTeammatesUiStore.getState().introSeen).toBe(true);
    await view.unmount();
  });

  it("edits the soul with example lines and saves", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("tab", { name: "Soul" }).click();
    const field = page.getByRole("textbox", { name: "Notch's soul" });
    await expect.element(field).toBeVisible();
    await page.getByRole("button", { name: "Be blunt" }).click();
    await expect.poll(() => (field.element() as HTMLTextAreaElement).value).toMatch(/Be direct/);
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => fake.api.setSoul.mock.calls.length).toBe(1);
    await expect.element(page.getByText(/Saved\./)).toBeVisible();
    await view.unmount();
  });

  it("changes settings: finish, pause, look around, and deletes from Settings", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Change finish" }).click();
    await page.getByRole("radio", { name: "Moonstone" }).click();
    await expect.poll(() => fake.api.update.mock.calls.length).toBe(1);
    expect(fake.api.update).toHaveBeenLastCalledWith({
      id: "tm-notch",
      patch: { finish: "ivory-ink" },
    });
    await page.getByRole("switch", { name: "Paused" }).click();
    await expect.poll(() => fake.api.update.mock.calls.length).toBe(2);
    expect(fake.api.update).toHaveBeenLastCalledWith({ id: "tm-notch", patch: { paused: true } });
    await page.getByRole("switch", { name: "Look around on a schedule" }).click();
    await expect.poll(() => fake.api.update.mock.calls.length).toBe(3);
    await page.getByRole("switch", { name: "It needs me" }).click();
    await expect.poll(() => fake.api.update.mock.calls.length).toBe(4);
    await page.getByRole("button", { name: "Delete…" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => fake.api.delete.mock.calls.length).toBe(1);
    await view.unmount();
  });

  it("writes a custom teammate from what it is for, then creates it", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("button", { name: "New teammate", exact: true }).first().click();
    for (let step = 0; step < 5; step += 1)
      await page.getByRole("button", { name: "Next starting point" }).click();
    await expect
      .element(page.getByRole("radio", { name: /^Custom\. Start blank/ }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("textbox", { name: "What is it for?" }).fill("keeps our changelog honest");
    await page.getByRole("button", { name: /Write and create/ }).click();
    await expect.poll(() => fake.api.generateProfile.mock.calls.length).toBe(1);
    expect(fake.api.generateProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ purpose: "keeps our changelog honest" }),
    );
    await expect.poll(() => fake.api.create.mock.calls.length).toBe(1);
    expect(fake.api.create.mock.calls[0]![0]).toMatchObject({
      soul: expect.stringContaining("keeps our changelog honest"),
    });
    await expect.poll(() => fake.api.update.mock.calls.length).toBe(1);
    expect(fake.api.update).toHaveBeenLastCalledWith({
      id: expect.any(String),
      patch: { lookAround: { focus: "Anything about keeps our changelog honest." } },
    });
    await view.unmount();
  });

  it("renames a teammate from its Settings", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("tab", { name: "Settings" }).click();
    const field = page.getByRole("textbox", { name: "Rename teammate" });
    await expect.element(field).toHaveValue("Notch");
    await field.fill("Juno");
    await field.element().blur();
    await expect.poll(() => fake.api.update.mock.calls.length).toBe(1);
    expect(fake.api.update).toHaveBeenLastCalledWith({
      id: "tm-notch",
      patch: { name: "Juno" },
    });
    await view.unmount();
  });

  it("creates a teammate from a template with a finish and a name", async () => {
    const fake = seed();
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("button", { name: "New teammate", exact: true }).first().click();
    await expect.element(page.getByRole("heading", { name: "New teammate" })).toBeVisible();
    await page.getByRole("radio", { name: /PR reviewer/ }).click();
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveValue("Reviewer");
    await page.getByRole("radio", { name: "Daybreak" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Rev");
    await page.getByRole("button", { name: "Create Rev" }).click();
    await expect.poll(() => fake.api.create.mock.calls.length).toBe(1);
    const input = fake.api.create.mock.calls[0]![0] as {
      name: string;
      soul: string;
      finish: string;
    };
    expect(input.name).toBe("Rev");
    expect(input.finish).toBe("blue-white");
    expect(input.soul).toContain("# Rev");
    expect(input.soul).toContain("pull requests");
    await expect.element(page.getByRole("button", { name: "More for Rev" })).toBeVisible();
    await view.unmount();
  });

  it("switches teammate from the rail and cancels the new flow", async () => {
    seed({ teammates: [NOTCH, RAE], activity: [makeActivity(NOTCH.id), makeActivity(RAE.id)] });
    openSpace();
    const view = await mount(<TeammatesPanel />);
    await page.getByRole("button", { name: /Rae/ }).click();
    await expect.element(page.getByRole("button", { name: "Rename Rae" })).toBeVisible();
    await page.getByRole("button", { name: "New teammate", exact: true }).first().click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(page.getByRole("button", { name: "Rename Rae" })).toBeVisible();
    await view.unmount();
  });
});

describe("memory", () => {
  it("forgets after a short undo window, and Undo keeps the fact", async () => {
    const fake = seed();
    fake.setFacts(NOTCH.id, [
      makeFact({ id: "f1", teammateId: NOTCH.id, text: "Prefers small pull requests" }),
      makeFact({ id: "f2", teammateId: NOTCH.id, text: "Staging deploys on Fridays" }),
    ]);
    const view = await render(<TeammateMemory teammate={NOTCH} refreshKey="a" undoMs={400} />);
    await expect.element(page.getByText("Prefers small pull requests")).toBeVisible();
    const rows = () => document.querySelectorAll("li");
    await page.getByRole("button", { name: "Forget" }).first().click();
    await expect.element(page.getByText("Forgotten.")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fake.api.forgetMemory).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
    await page.getByRole("button", { name: "Forget" }).nth(1).click();
    await expect.poll(() => fake.api.forgetMemory.mock.calls.length).toBe(1);
    expect(fake.api.forgetMemory).toHaveBeenCalledWith({ id: "f2" });
    await expect.poll(() => rows().length).toBe(1);
    await view.unmount();
  });

  it("explains an empty memory", async () => {
    seed();
    const view = await render(<TeammateMemory teammate={NOTCH} refreshKey="a" />);
    await expect.element(page.getByText("Nothing remembered yet")).toBeVisible();
    await view.unmount();
  });
});
