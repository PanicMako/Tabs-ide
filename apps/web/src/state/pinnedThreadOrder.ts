const DIGITS = "abcdefghijklmnopqrstuvwxyz";

function valid(key: string): boolean {
  return key.length > 0 && [...key].every((char) => DIGITS.includes(char)) && key.at(-1) !== "a";
}

function midpoint(before: string, after: string): string {
  if (after !== "" && before >= after) throw new Error("pin order bounds are out of order");
  if (after !== "") {
    let shared = 0;
    while ((before.charAt(shared) || "a") === after.charAt(shared)) shared += 1;
    if (shared > 0)
      return after.slice(0, shared) + midpoint(before.slice(shared), after.slice(shared));
  }
  const low = before === "" ? 0 : DIGITS.indexOf(before.charAt(0));
  const high = after === "" ? DIGITS.length : DIGITS.indexOf(after.charAt(0));
  if (high - low > 1) return DIGITS.charAt(Math.round((low + high) / 2));
  if (after.length > 1) return after.charAt(0);
  return DIGITS.charAt(low) + midpoint(before.slice(1), "");
}

export function pinOrderKeyBetween(before: string | null, after: string | null): string | null {
  if (before !== null && !valid(before)) return null;
  if (after !== null && !valid(after)) return null;
  if (before !== null && after !== null && before >= after) return null;
  return midpoint(before ?? "", after ?? "");
}

function spreadKeys(count: number): string[] {
  const space = DIGITS.length * DIGITS.length;
  const step = space / (count + 1);
  let previous = 0;
  return Array.from({ length: count }, (_, index) => {
    let value = Math.max(Math.round(step * (index + 1)), previous + 1);
    if (value % DIGITS.length === 0) value += 1;
    value = Math.min(value, space - 1);
    previous = value;
    return DIGITS.charAt(Math.floor(value / DIGITS.length)) + DIGITS.charAt(value % DIGITS.length);
  });
}

export function planPinnedReorder(input: {
  readonly orderedIds: readonly string[];
  readonly keysById: ReadonlyMap<string, string | null | undefined>;
  readonly movedId: string;
}): ReadonlyArray<{ readonly id: string; readonly orderKey: string }> {
  const index = input.orderedIds.indexOf(input.movedId);
  if (index < 0) return [];
  const beforeId = index > 0 ? input.orderedIds[index - 1]! : null;
  const afterId = index < input.orderedIds.length - 1 ? input.orderedIds[index + 1]! : null;
  const before = beforeId === null ? null : (input.keysById.get(beforeId) ?? null);
  const after = afterId === null ? null : (input.keysById.get(afterId) ?? null);
  if ((beforeId === null || before !== null) && (afterId === null || after !== null)) {
    const key = pinOrderKeyBetween(before, after);
    if (key !== null) return [{ id: input.movedId, orderKey: key }];
  }
  const keys = spreadKeys(input.orderedIds.length);
  return input.orderedIds.flatMap((id, keyIndex) =>
    input.keysById.get(id) === keys[keyIndex] ? [] : [{ id, orderKey: keys[keyIndex]! }],
  );
}

export function planPinnedMove(input: {
  readonly orderedIds: readonly string[];
  readonly keysById: ReadonlyMap<string, string | null | undefined>;
  readonly movedId: string;
  readonly direction: "up" | "down";
}): ReadonlyArray<{ readonly id: string; readonly orderKey: string }> | null {
  const from = input.orderedIds.indexOf(input.movedId);
  const to = input.direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= input.orderedIds.length) return null;
  const desired = [...input.orderedIds];
  [desired[from], desired[to]] = [desired[to]!, desired[from]!];
  const before = to > 0 ? (input.keysById.get(desired[to - 1]!) ?? null) : null;
  const after = to < desired.length - 1 ? (input.keysById.get(desired[to + 1]!) ?? null) : null;
  if ((to === 0 || before !== null) && (to === desired.length - 1 || after !== null)) {
    const key = pinOrderKeyBetween(before, after);
    if (key !== null) return [{ id: input.movedId, orderKey: key }];
  }
  const keys = spreadKeys(desired.length);
  return desired.flatMap((id, index) =>
    input.keysById.get(id) === keys[index] ? [] : [{ id, orderKey: keys[index]! }],
  );
}

export function sortPinnedThreads<
  T extends { id: string; createdAt: string; pinOrderKey?: string | null },
>(threads: readonly T[]): T[] {
  const keyed = threads.filter((thread) => thread.pinOrderKey != null);
  const keyless = threads.filter((thread) => thread.pinOrderKey == null);
  keyed.sort((left, right) =>
    left.pinOrderKey! < right.pinOrderKey!
      ? -1
      : left.pinOrderKey! > right.pinOrderKey!
        ? 1
        : left.id.localeCompare(right.id),
  );
  keyless.sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id),
  );
  return [...keyed, ...keyless];
}
