import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  ModelSelection,
  type ProviderDriverKind,
  type ProviderKind,
  ThreadId,
} from "@tabs/contracts";
import "../../index.css";

import { createModelCapabilities } from "@tabs/shared/model";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { TraitsMenuContent } from "./TraitsPicker";
import { useComposerDraftStore } from "../../composerDraftStore";
import { makeAppModelSelection, typedOptionsToSelections } from "../../modelSelection";

async function mountMenu(props?: { modelSelection?: ModelSelection; prompt?: string }) {
  const threadId = ThreadId.makeUnsafe("thread-compact-menu");
  const provider = (props?.modelSelection?.instanceId ?? "claudeAgent") as ProviderKind;
  const draftsByThreadId = {} as ReturnType<
    typeof useComposerDraftStore.getState
  >["draftsByThreadId"];
  const model =
    props?.modelSelection?.model ??
    DEFAULT_MODEL_BY_PROVIDER[provider as ProviderDriverKind] ??
    DEFAULT_MODEL;

  draftsByThreadId[threadId] = {
    prompt: props?.prompt ?? "",
    images: [],
    files: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    modelSelectionByProvider: {
      [provider]: makeAppModelSelection(provider, model, props?.modelSelection?.options),
    },
    activeProvider: provider,
    runtimeMode: null,
    interactionMode: null,
  };
  useComposerDraftStore.setState({
    draftsByThreadId,
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
  });
  const host = document.createElement("div");
  document.body.append(host);
  const onPromptChange = vi.fn();
  const providerOptions = props?.modelSelection?.options;
  const models =
    provider === "claudeAgent"
      ? [
          {
            slug: "claude-opus-4-6",
            name: "Claude Opus 4.6",
            isCustom: false,
            capabilities: createModelCapabilities({
              optionDescriptors: [
                {
                  id: "effort",
                  label: "Effort",
                  type: "select",
                  options: [
                    { id: "low", label: "Low" },
                    { id: "medium", label: "Medium" },
                    { id: "high", label: "High", isDefault: true },
                    { id: "max", label: "Max" },
                    { id: "ultrathink", label: "Ultrathink" },
                  ],
                  promptInjectedValues: ["ultrathink"],
                },
                { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
              ],
            }),
          },
          {
            slug: "claude-haiku-4-5",
            name: "Claude Haiku 4.5",
            isCustom: false,
            capabilities: createModelCapabilities({
              optionDescriptors: [
                { id: "thinking", label: "Thinking", type: "boolean", currentValue: true },
              ],
            }),
          },
          {
            slug: "claude-sonnet-4-6",
            name: "Claude Sonnet 4.6",
            isCustom: false,
            capabilities: createModelCapabilities({
              optionDescriptors: [
                {
                  id: "effort",
                  label: "Effort",
                  type: "select",
                  options: [
                    { id: "low", label: "Low" },
                    { id: "medium", label: "Medium" },
                    { id: "high", label: "High", isDefault: true },
                    { id: "ultrathink", label: "Ultrathink" },
                  ],
                  promptInjectedValues: ["ultrathink"],
                },
              ],
            }),
          },
        ]
      : [
          {
            slug: "gpt-5.4",
            name: "GPT-5.4",
            isCustom: false,
            capabilities: createModelCapabilities({
              optionDescriptors: [
                {
                  id: "reasoningEffort",
                  label: "Effort",
                  type: "select",
                  options: [
                    { id: "xhigh", label: "Extra High" },
                    { id: "high", label: "High", isDefault: true },
                  ],
                  promptInjectedValues: [],
                },
                { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
              ],
            }),
          },
        ];
  const screen = await render(
    <CompactComposerControlsMenu
      activePlan={false}
      interactionMode="default"
      planSidebarOpen={false}
      runtimeMode="approval-required"
      traitsMenuContent={
        <TraitsMenuContent
          provider={provider}
          models={models}
          threadId={threadId}
          model={model}
          prompt={props?.prompt ?? ""}
          modelOptions={providerOptions}
          onPromptChange={onPromptChange}
        />
      }
      onToggleInteractionMode={vi.fn()}
      onTogglePlanSidebar={vi.fn()}
      onToggleRuntimeMode={vi.fn()}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("CompactComposerControlsMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
    });
  });

  it("shows fast mode controls for Opus", async () => {
    await using _ = await mountMenu({
      modelSelection: makeAppModelSelection("claudeAgent", "claude-opus-4-6"),
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Fast Mode");
      expect(text).toContain("Off");
      expect(text).toContain("On");
    });
  });

  it("hides fast mode controls for non-Opus Claude models", async () => {
    await using _ = await mountMenu({
      modelSelection: makeAppModelSelection("claudeAgent", "claude-sonnet-4-6"),
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Effort");
      expect(document.body.textContent ?? "").not.toContain("Fast Mode");
    });
  });

  it("shows only the provided effort options", async () => {
    await using _ = await mountMenu({
      modelSelection: makeAppModelSelection("claudeAgent", "claude-sonnet-4-6"),
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Low");
      expect(text).toContain("Medium");
      expect(text).toContain("High");
      expect(text).not.toContain("Max");
      expect(text).toContain("Ultrathink");
    });
  });

  it("shows a Claude thinking on/off section for Haiku", async () => {
    await using _ = await mountMenu({
      modelSelection: makeAppModelSelection(
        "claudeAgent",
        "claude-haiku-4-5",
        typedOptionsToSelections({ thinking: true }),
      ),
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Thinking");
      expect(text).toContain("On");
      expect(text).toContain("Off");
    });
  });

  it("shows prompt-controlled Ultrathink messaging with disabled effort controls", async () => {
    await using _ = await mountMenu({
      modelSelection: makeAppModelSelection(
        "claudeAgent",
        "claude-opus-4-6",
        typedOptionsToSelections({ effort: "high" }),
      ),
      prompt: "Investigate this with Ultrathink",
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Effort");
      expect(text).toContain("Remove Ultrathink from the prompt to change this option.");
      expect(text).not.toContain("Fallback Effort");
      expect(
        document.querySelectorAll('[role="menuitemradio"][aria-disabled="true"]'),
      ).toHaveLength(5);
    });
  });
});
