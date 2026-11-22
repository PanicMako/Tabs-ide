// Visual regression captures: the Teammates space and avatar in both themes at two window sizes.
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
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { applyTestColorScheme, resetTestColorScheme } from "../../test/colorScheme";
import { TeammatesPanel } from "./TeammatesPanel";
import { TeammatesCornerAvatar } from "./TeammatesCornerAvatar";
import {
  createFakeTeammatesApi,
  makeActivity,
  makeFact,
  makeItem,
  makeSuggestion,
  makeTeammate,
} from "./teammates.testkit";
import { useTeammatesStore, useTeammatesUiStore } from "./teammatesStore";

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

const NOTCH = makeTeammate({
  id: "tm-notch",
  name: "Notch",
  projectId: "project-1" as never,
  lookAround: { enabled: true, preset: "twiceDaily", focus: "", maxSuggestions: 3 },
});
const RAE = makeTeammate({ id: "tm-rae", name: "Reviewer", finish: "ivory-ink" });
const JUNO = makeTeammate({ id: "tm-juno", name: "Juno", finish: "blue-ink", paused: true });

function populate() {
  const fake = createFakeTeammatesApi({
    teammates: [NOTCH, RAE, JUNO],
    activity: [
      makeActivity(NOTCH.id, { mood: "needsYou", needsYouCount: 2, workingCount: 1 }),
      makeActivity(RAE.id, { mood: "working", workingCount: 2 }),
      makeActivity(JUNO.id, { mood: "sleeping" }),
    ],
    items: [
      makeItem({
        id: "i1",
        teammateId: NOTCH.id,
        title: "Fix the flaky auth test",
        status: "needsYou",
        question: "Should I retry it three times, or delete it? It fails about one run in ten.",
      }),
      makeItem({
        id: "i3",
        teammateId: NOTCH.id,
        title: "Migrate the settings schema",
        status: "needsYou",
        question: "The migration drops a column. Are you fine losing the old values?",
      }),
      makeItem({
        id: "i2",
        teammateId: NOTCH.id,
        title: "Bump the provider SDK to 4.2",
        detail: "Updating the lockfile and running the adapter tests.",
        status: "working",
        workerThreadIds: ["w1" as never],
      }),
      makeItem({
        id: "i4",
        teammateId: NOTCH.id,
        title: "Rename the sidebar section",
        status: "done",
      }),
    ],
    suggestions: [
      makeSuggestion({
        id: "s1",
        teammateId: NOTCH.id,
        title: "Add tests for the thread cache",
        why: "It changed twice this week and nothing covers eviction.",
      }),
      makeSuggestion({
        id: "s2",
        teammateId: NOTCH.id,
        title: "Remove three dead feature flags",
        why: "They have been on for every user since March.",
      }),
    ],
  });
  fake.setFacts(NOTCH.id, [
    makeFact({
      id: "f1",
      teammateId: NOTCH.id,
      text: "Prefers small pull requests",
      topic: "style",
    }),
    makeFact({
      id: "f2",
      teammateId: NOTCH.id,
      text: "Staging deploys go out on Fridays",
      source: "look-around",
    }),
    makeFact({
      id: "f3",
      teammateId: NOTCH.id,
      text: "Never commit to main directly",
      topic: "git",
    }),
  ]);
  fake.setSoul(
    NOTCH.id,
    "# Notch\n\nYou are a calm, capable teammate who keeps track of everything the owner has in flight.\n\n## How you work\n- Answer small questions yourself.\n- Hand real code work to a worker.\n\n## How you talk\nShort, warm, specific.\n",
  );
  fake.install();
  return fake;
}

const sizes = [
  { w: 1440, h: 900 },
  { w: 1280, h: 720 },
] as const;
const themes = ["light", "dark"] as const;

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 700));
}

afterEach(() => {
  resetTestColorScheme();
  useTeammatesStore.getState().setSnapshot(null);
  useTeammatesUiStore.setState({ panelOpen: false, spaceMode: "teammate" });
});

for (const theme of themes) {
  for (const size of sizes) {
    const tag = `${theme}-${size.w}x${size.h}`;
    const shoot = (name: string) =>
      page.screenshot({ path: `__screenshots__/teammates/${tag}-${name}.png` });
    describe(`screens ${tag}`, () => {
      const prepare = async (intro: boolean) => {
        await page.viewport(size.w, size.h);
        applyTestColorScheme(theme);
        populate();
        useTeammatesUiStore.setState({
          panelOpen: true,
          spaceMode: "teammate",
          activeTeammateId: NOTCH.id,
          pinnedTeammateId: NOTCH.id,
          introSeen: !intro,
        });
      };
      it("now", async () => {
        await prepare(false);
        const view = await mount(<TeammatesPanel />);
        await page.getByRole("region", { name: "Needs you" }).element();
        await settle();
        await shoot("now");
        await view.unmount();
      });
      it("first run", async () => {
        await prepare(true);
        const view = await mount(<TeammatesPanel />);
        await page.getByRole("region", { name: "Meet Notch" }).element();
        await settle();
        await shoot("intro");
        await view.unmount();
      });
      it("new teammate", async () => {
        await prepare(false);
        useTeammatesUiStore.setState({ spaceMode: "new" });
        const view = await mount(<TeammatesPanel />);
        await page.getByRole("heading", { name: "New teammate" }).element();
        await settle();
        await shoot("new");
        await view.unmount();
      });
      it("memory, soul, settings", async () => {
        await prepare(false);
        const view = await mount(<TeammatesPanel />);
        await page.getByRole("tab", { name: "Memory" }).click();
        await page.getByText("Prefers small pull requests").element();
        await settle();
        await shoot("memory");
        await page.getByRole("tab", { name: "Soul" }).click();
        await page.getByRole("textbox", { name: "Notch's soul" }).element();
        await settle();
        await shoot("soul");
        await page.getByRole("tab", { name: "Settings" }).click();
        await settle();
        await shoot("settings");
        await view.unmount();
      });
      it("avatar hover card", async () => {
        await prepare(false);
        useTeammatesUiStore.setState({ panelOpen: false });
        localStorage.setItem("tabs:notch-corner-position:v1", JSON.stringify({ x: 0.7, y: 0.75 }));
        const view = await render(
          <>
            <div
              style={{
                position: "fixed",
                inset: 0,
                background:
                  "linear-gradient(135deg, color-mix(in srgb, var(--foreground) 6%, var(--background)), var(--background))",
              }}
            />
            <TeammatesCornerAvatar
              teammate={NOTCH}
              mood="needsYou"
              finish="signature"
              badge={2}
              needs={[
                {
                  id: "i1",
                  title: "Flaky test",
                  question: "Should I retry it three times, or delete it?",
                },
              ]}
              teammates={[NOTCH, RAE, JUNO]}
              open={false}
              onToggle={() => {}}
              onAsk={async () => true}
              onOpenChat={() => {}}
              onOpenSpace={() => {}}
              onPin={() => {}}
              onHide={() => {}}
            />
          </>,
        );
        await page.getByRole("button", { name: /^Notch:/ }).hover();
        await expect.element(page.getByRole("textbox", { name: "Ask Notch" })).toBeVisible();
        await settle();
        await shoot("avatar");
        localStorage.removeItem("tabs:notch-corner-position:v1");
        await view.unmount();
      });
    });
  }
}
