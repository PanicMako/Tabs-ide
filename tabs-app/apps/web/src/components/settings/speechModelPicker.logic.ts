import type { EnvironmentSpeechModel } from "@tabs/contracts";
import { effectiveSpeechLanguage } from "@tabs/shared/speech";

export type ModelView = "recommended" | "installed" | "all";

export function formatModelBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function describeModelLanguages(model: EnvironmentSpeechModel): string {
  if (model.languages.length === 1) return languageName(model.languages[0]!);
  return `${model.languages.length} languages`;
}

/** The measured accuracy in the language this model would actually transcribe in. */
export function modelAccuracy(
  model: EnvironmentSpeechModel,
  intent: string,
): { readonly grade: string; readonly errorPercent: number } | null {
  const accuracy = model.benchmark?.accuracy;
  if (!accuracy) return null;
  const language = effectiveSpeechLanguage(model, intent);
  return accuracy[language] ?? accuracy.en ?? Object.values(accuracy)[0] ?? null;
}

/** Seconds to transcribe 30 seconds of speech, preferring a GPU measurement when there is one. */
export function modelSpeedSeconds(model: EnvironmentSpeechModel): number | null {
  const times = model.benchmark?.secondsPer30s;
  return times?.accelerated ?? times?.cpu ?? null;
}

export function speaksLanguage(model: EnvironmentSpeechModel, intent: string): boolean {
  return intent === "auto" || model.languages.includes(intent);
}

/** The line under a model's name: size, language, measured accuracy and speed, streaming. */
export function modelFacts(model: EnvironmentSpeechModel, intent: string): string[] {
  const accuracy = modelAccuracy(model, intent);
  const speed = modelSpeedSeconds(model);
  return [
    formatModelBytes(model.size),
    describeModelLanguages(model),
    ...(accuracy
      ? [`Accuracy ${accuracy.grade} (${accuracy.errorPercent.toFixed(1)}% errors)`]
      : []),
    ...(speed === null ? [] : [`${speed.toFixed(1)}s per 30s of speech`]),
    ...(model.supportsStreaming ? ["Streams as you talk"] : []),
  ];
}

const rank = (model: EnvironmentSpeechModel) =>
  model.active ? 0 : model.state === "installed" ? 1 : model.recommended ? 2 : 3;

/** What the list shows: active first, then installed, recommended, then the rest by accuracy. */
export function visibleModels(
  models: ReadonlyArray<EnvironmentSpeechModel>,
  input: { readonly view: ModelView; readonly query: string; readonly language: string },
): EnvironmentSpeechModel[] {
  const query = input.query.trim().toLowerCase();
  return models
    .filter((model) => {
      if (query) {
        const haystack = `${model.name} ${model.description} ${model.languages.map(languageName).join(" ")}`;
        if (!haystack.toLowerCase().includes(query)) return false;
      }
      if (input.view === "installed") return model.state === "installed";
      if (input.view === "recommended") {
        return (
          model.active ||
          model.state === "installed" ||
          (model.recommended && speaksLanguage(model, input.language))
        );
      }
      return true;
    })
    .toSorted((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      const aFits = speaksLanguage(a, input.language) ? 0 : 1;
      const bFits = speaksLanguage(b, input.language) ? 0 : 1;
      if (aFits !== bFits) return aFits - bFits;
      return (
        (modelAccuracy(a, input.language)?.errorPercent ?? Infinity) -
        (modelAccuracy(b, input.language)?.errorPercent ?? Infinity)
      );
    });
}
