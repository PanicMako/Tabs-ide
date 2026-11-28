import {
  matchControl,
  matchReplayControl,
  observeDevice,
  type DeviceObservation,
} from "../../src/device/DeviceComparisonSemantics.ts";

const app = { ios: "com.tabs.qa.ios", android: "com.tabs.qa.android" };
type Control = readonly [label: string, identifier?: string];

function screen(platform: keyof typeof app, controls: readonly Control[]) {
  return observeDevice({
    appBundleId: app[platform],
    refsGeneration: 1,
    nodes: controls.map(([label, identifier], index) => ({
      index,
      label,
      identifier,
      type: "Button",
      ref: `e${index + 1}`,
    })),
  });
}

const shared = `${app.android}:id/checkout_continue`;
const source = screen("ios", [["Continue", "checkout-continue"]]);
const intended = source.controls[0]!;
const scenarios: readonly { name: string; controls: readonly Control[]; expected: string }[] = [
  {
    name: "renamed and moved",
    controls: [["Back"], ["Review details", shared]],
    expected: "@e2~s1",
  },
  {
    name: "recorded label on a different control",
    controls: [
      ["Review details", shared],
      ["Continue", "help_continue"],
    ],
    expected: "pause",
  },
  {
    name: "same label with no shared identifier",
    controls: [["Back"], ["Continue"]],
    expected: "@e2~s1",
  },
  {
    name: "repeated identifier",
    controls: [
      ["Continue", shared],
      ["Review details", shared],
    ],
    expected: "pause",
  },
  { name: "order placement label", controls: [["Place order", shared]], expected: "pause" },
];

const selectPrevious = (target: DeviceObservation) =>
  matchControl(intended, target.controls)?.ref ?? "pause";
const selectCurrent = (target: DeviceObservation) => {
  const replay = matchReplayControl(intended, source, target);
  return "control" in replay ? replay.control.ref : "pause";
};

const cases = scenarios.map(({ name, expected, controls }) => {
  const target = screen("android", controls);
  return {
    target,
    result: { name, expected, previous: selectPrevious(target), current: selectCurrent(target) },
  };
});
const results = cases.map(({ result }) => result);

const summarize = (column: "previous" | "current") => ({
  correct: results.filter((row) => row[column] === row.expected).length,
  wrongTargetSelections: results.filter(
    (row) => row[column] !== "pause" && row[column] !== row.expected,
  ).length,
});

const repetitionsPerBatch = 10_000;
const warmupBatchesPerMatcher = 2;
const samplesPerMatcher = 10;
const matchers = { previous: selectPrevious, current: selectCurrent };
type Matcher = keyof typeof matchers;

function timeBatch(matcher: Matcher) {
  const select = matchers[matcher];
  const started = performance.now();
  for (let repetition = 0; repetition < repetitionsPerBatch; repetition++) {
    for (const { target, result } of cases) {
      if (select(target) !== result[matcher]) {
        throw new Error(`${matcher} matcher changed its decision for ${result.name}`);
      }
    }
  }
  return performance.now() - started;
}

const samples: Record<Matcher, number[]> = { previous: [], current: [] };
for (let pair = 0; pair < warmupBatchesPerMatcher + samplesPerMatcher; pair++) {
  // Alternate order so the same matcher does not always run first.
  const order: readonly Matcher[] =
    pair % 2 === 0 ? ["previous", "current"] : ["current", "previous"];
  for (const matcher of order) {
    const elapsedMs = timeBatch(matcher);
    if (pair >= warmupBatchesPerMatcher) samples[matcher].push(elapsedMs);
  }
}

function timingSummary(samplesMs: number[]) {
  const sorted = samplesMs.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    samplesMs,
    medianMs: (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[middle]!) / 2,
  };
}

console.log(
  JSON.stringify(
    {
      results,
      previous: summarize("previous"),
      current: summarize("current"),
      timing: {
        scope: "Matcher calls and decision checks on prebuilt observations",
        warmupBatchesPerMatcher,
        decisionsPerBatch: repetitionsPerBatch * cases.length,
        previous: timingSummary(samples.previous),
        current: timingSummary(samples.current),
      },
    },
    null,
    2,
  ),
);
if (results.some((row) => row.current !== row.expected)) process.exitCode = 1;
