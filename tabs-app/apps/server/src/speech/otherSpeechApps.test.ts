import { describe, expect, it } from "vitest";
import { findOtherAppSpeechModels } from "./otherSpeechApps.ts";

function fakeFs(tree: Record<string, ReadonlyArray<string>>) {
  return {
    exists: async (path: string) => path in tree,
    readDirectory: async (path: string) => {
      const entries = tree[path];
      if (!entries) throw new Error("ENOENT");
      return entries;
    },
  };
}

const home = "/Users/me";
const appSupport = `${home}/Library/Application Support`;

describe("findOtherAppSpeechModels", () => {
  it("finds TypeWhisper's Core ML Parakeet models and names the matching Tabs model", async () => {
    const found = await findOtherAppSpeechModels({
      home,
      platform: "darwin",
      fs: fakeFs({
        [`${appSupport}/TypeWhisper`]: [],
        [`${appSupport}/FluidAudio/Models`]: [
          "parakeet-tdt-0.6b-v3",
          "parakeet-tdt-0.6b-v3-coreml",
          "parakeet-ctc-110m-coreml",
          "silero-vad",
        ],
      }),
    });
    expect(found).toEqual([
      {
        app: "TypeWhisper",
        name: "Parakeet TDT 0.6B v3",
        format: "Core ML",
        path: `${appSupport}/FluidAudio/Models/parakeet-tdt-0.6b-v3`,
        usableAsIs: false,
        matchModelId: "handy-computer/parakeet-tdt-0.6b-v3-gguf",
      },
      {
        app: "TypeWhisper",
        name: "Parakeet CTC 110M",
        format: "Core ML",
        path: `${appSupport}/FluidAudio/Models/parakeet-ctc-110m-coreml`,
        usableAsIs: false,
        matchModelId: "handy-computer/parakeet-tdt_ctc-110m-gguf",
      },
    ]);
  });

  it("matches WhisperKit's turbo model before plain large-v3", async () => {
    const found = await findOtherAppSpeechModels({
      home,
      platform: "darwin",
      fs: fakeFs({
        [`${home}/Documents/huggingface/models/argmaxinc/whisperkit-coreml`]: [
          "openai_whisper-large-v3-v20240930_turbo",
        ],
      }),
    });
    expect(found.map((entry) => entry.matchModelId)).toEqual([
      "handy-computer/whisper-large-v3-turbo-gguf",
    ]);
  });

  it("finds nothing off macOS or without those folders", async () => {
    expect(await findOtherAppSpeechModels({ home, platform: "linux", fs: fakeFs({}) })).toEqual([]);
    expect(await findOtherAppSpeechModels({ home, platform: "darwin", fs: fakeFs({}) })).toEqual(
      [],
    );
  });
});
