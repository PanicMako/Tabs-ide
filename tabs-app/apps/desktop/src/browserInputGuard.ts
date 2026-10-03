/** Match only the particular injected event in flight. Other keys, motion and
 * clicks still preempt automation, even while a CDP command is awaiting a reply. */
export class BrowserInputGuard {
  private expected: { type: string; key?: string; x?: number; y?: number; zoom?: number } | null =
    null;
  expect(event: NonNullable<BrowserInputGuard["expected"]>): () => void {
    this.expected = event;
    return () => {
      if (this.expected === event) this.expected = null;
    };
  }
  consume(input: { type?: string; key?: string; x?: number; y?: number } | undefined): boolean {
    const expected = this.expected;
    if (!expected || !input || input.type !== expected.type) return false;
    if (expected.key !== undefined && input.key !== expected.key) return false;
    if (expected.x !== undefined && expected.y !== undefined) {
      const matches = (scale: number) =>
        Math.abs((input.x ?? Infinity) - expected.x! * scale) <= 1 &&
        Math.abs((input.y ?? Infinity) - expected.y! * scale) <= 1;
      if (!matches(1) && !matches(expected.zoom ?? 1)) return false;
    }
    this.expected = null;
    return true;
  }
}
