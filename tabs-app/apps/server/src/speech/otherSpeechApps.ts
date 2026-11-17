import type { EnvironmentSpeechFoundModel } from "@tabs/contracts";

/**
 * Speech models other dictation apps already keep on this machine.
 *
 * Tabs runs GGUF models through transcribe-cpp. Apps such as TypeWhisper keep
 * the same model families in other formats (Core ML through FluidAudio or
 * WhisperKit), which this engine cannot load as they are. Finding them still
 * helps: the settings page names what is installed and offers the catalog
 * model with the same weights, instead of acting as if nothing were there.
 *
 * Only folder names in a few known places are read; nothing is opened, loaded
 * or copied.
 */

export interface OtherSpeechAppsFs {
  readonly exists: (path: string) => Promise<boolean>;
  readonly readDirectory: (path: string) => Promise<ReadonlyArray<string>>;
}

interface Match {
  readonly test: RegExp;
  readonly name: string;
  readonly matchModelId: string;
}

// Most specific first: "large-v3-turbo" before "large-v3".
const PARAKEET: ReadonlyArray<Match> = [
  {
    test: /parakeet-tdt-0\.6b-v3/i,
    name: "Parakeet TDT 0.6B v3",
    matchModelId: "handy-computer/parakeet-tdt-0.6b-v3-gguf",
  },
  {
    test: /parakeet-tdt-0\.6b-v2/i,
    name: "Parakeet TDT 0.6B v2",
    matchModelId: "handy-computer/parakeet-tdt-0.6b-v2-gguf",
  },
  {
    test: /parakeet-(?:tdt_)?ctc-110m/i,
    name: "Parakeet CTC 110M",
    matchModelId: "handy-computer/parakeet-tdt_ctc-110m-gguf",
  },
];

const WHISPER: ReadonlyArray<Match> = [
  {
    test: /large-v3[-_]?(?:v\d+[-_])?turbo/i,
    name: "Whisper Large v3 Turbo",
    matchModelId: "handy-computer/whisper-large-v3-turbo-gguf",
  },
  {
    test: /large-v3/i,
    name: "Whisper Large v3",
    matchModelId: "handy-computer/whisper-large-v3-gguf",
  },
  { test: /medium/i, name: "Whisper Medium", matchModelId: "handy-computer/whisper-medium-gguf" },
  { test: /small/i, name: "Whisper Small", matchModelId: "handy-computer/whisper-small-gguf" },
];

function join(...parts: ReadonlyArray<string>): string {
  return parts.join("/").replace(/\/{2,}/g, "/");
}

async function listDirectory(fs: OtherSpeechAppsFs, path: string): Promise<ReadonlyArray<string>> {
  try {
    return await fs.readDirectory(path);
  } catch {
    return [];
  }
}

export async function findOtherAppSpeechModels(input: {
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly fs: OtherSpeechAppsFs;
}): Promise<ReadonlyArray<EnvironmentSpeechFoundModel>> {
  if (input.platform !== "darwin") return [];
  const { fs, home } = input;
  const appSupport = join(home, "Library", "Application Support");
  const found = new Map<string, EnvironmentSpeechFoundModel>();
  const add = (entry: EnvironmentSpeechFoundModel) => {
    const key = `${entry.app}:${entry.matchModelId ?? entry.name}`;
    if (!found.has(key)) found.set(key, entry);
  };

  // FluidAudio's Core ML Parakeet models, which TypeWhisper (and others) download.
  const fluidModels = join(appSupport, "FluidAudio", "Models");
  const fluidOwner = (await fs.exists(join(appSupport, "TypeWhisper")).catch(() => false))
    ? "TypeWhisper"
    : "FluidAudio";
  for (const name of await listDirectory(fs, fluidModels)) {
    const match = PARAKEET.find((candidate) => candidate.test.test(name));
    if (!match) continue;
    add({
      app: fluidOwner,
      name: match.name,
      format: "Core ML",
      path: join(fluidModels, name),
      usableAsIs: false,
      matchModelId: match.matchModelId,
    });
  }

  // WhisperKit's Core ML Whisper models (Hugging Face download location).
  const whisperKit = join(
    home,
    "Documents",
    "huggingface",
    "models",
    "argmaxinc",
    "whisperkit-coreml",
  );
  for (const name of await listDirectory(fs, whisperKit)) {
    const match = WHISPER.find((candidate) => candidate.test.test(name));
    if (!match) continue;
    add({
      app: "WhisperKit",
      name: match.name,
      format: "Core ML",
      path: join(whisperKit, name),
      usableAsIs: false,
      matchModelId: match.matchModelId,
    });
  }

  // MacWhisper's whisper.cpp models (GGML .bin, an older format than the GGUF Tabs runs).
  const macWhisper = join(appSupport, "MacWhisper", "models");
  for (const name of await listDirectory(fs, macWhisper)) {
    if (!/\.bin$/i.test(name)) continue;
    const match = WHISPER.find((candidate) => candidate.test.test(name));
    add({
      app: "MacWhisper",
      name: match?.name ?? name,
      format: "GGML",
      path: join(macWhisper, name),
      usableAsIs: false,
      ...(match ? { matchModelId: match.matchModelId } : {}),
    });
  }

  return [...found.values()];
}
