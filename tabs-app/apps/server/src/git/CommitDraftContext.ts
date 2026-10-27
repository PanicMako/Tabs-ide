interface FileExcerpt {
  path: string;
  header: string;
  head: string;
  tail: string;
  changedLines: number;
  truncated: boolean;
}

/** Keep bounded excerpts across files instead of letting the first large file consume the prompt. */
export class CommitDraftContext {
  private readonly decoder = new TextDecoder();
  private pending = "";
  private droppingLongLine = false;
  private readonly files: FileExcerpt[] = [];
  private current: FileExcerpt | undefined;
  private omitted = false;

  push(chunk: Uint8Array): void {
    let text = this.decoder.decode(chunk, { stream: true });
    if (this.droppingLongLine) {
      const end = text.indexOf("\n");
      if (end < 0) return;
      text = text.slice(end + 1);
      this.droppingLongLine = false;
    }
    this.pending += text;
    let end = this.pending.indexOf("\n");
    while (end >= 0) {
      this.line(this.pending.slice(0, end));
      this.pending = this.pending.slice(end + 1);
      end = this.pending.indexOf("\n");
    }
    if (this.pending.length > 4096) {
      this.line(this.pending.slice(0, 4096));
      this.pending = "";
      this.droppingLongLine = true;
    }
  }

  private line(line: string): void {
    if (line.startsWith("diff --git ")) {
      const path = / b\/(.+)$/.exec(line)?.[1] ?? line.slice(11);
      this.current = undefined;
      if (
        /\.(png|jpe?g|webp|gif|ico|icns|woff2?|ttf|mp[34]|pdf)$/.test(path) ||
        /(?:^|\/)(dist|node_modules|\.repos)\//.test(path)
      )
        return;
      if (this.files.length >= 512) {
        this.omitted = true;
        return;
      }
      this.current = { path, header: line, head: "", tail: "", changedLines: 0, truncated: false };
      this.files.push(this.current);
      return;
    }
    const file = this.current;
    if (!file || line.startsWith("+++") || line.startsWith("---")) return;
    if (line.startsWith("+") || line.startsWith("-")) file.changedLines++;
    else if (!line.startsWith("@@")) return;
    const excerpt = line.slice(0, 800) + "\n";
    if (file.head.length + excerpt.length <= 600) file.head += excerpt;
    else {
      file.truncated = true;
      file.tail = (file.tail + excerpt).slice(-600);
    }
  }

  render(maxChars = 36_000): string {
    this.pending += this.decoder.decode();
    if (this.pending) {
      this.line(this.pending);
      this.pending = "";
    }
    const groups = new Map<string, FileExcerpt[]>();
    for (const file of this.files.filter((file) => file.changedLines > 0)) {
      const source = file.path.indexOf("/src/");
      const native = /src\/vs\/workbench\/contrib\/([^/]+)/.exec(file.path)?.[1];
      const key = native
        ? `native/${native}`
        : source >= 0
          ? file.path.slice(0, source)
          : (file.path.split("/")[0] ?? "root");
      const group = groups.get(key) ?? [];
      group.push(file);
      groups.set(key, group);
    }
    for (const group of groups.values()) group.sort((a, b) => b.changedLines - a.changedLines);
    const selected: FileExcerpt[] = [];
    const buckets = [...groups.values()];
    for (let round = 0; selected.length < 24; round++) {
      const next = buckets.flatMap((group) => (group[round] ? [group[round]!] : []));
      if (!next.length) break;
      selected.push(...next.slice(0, 24 - selected.length));
    }
    const truncated =
      this.omitted ||
      selected.some((file) => file.truncated) ||
      selected.length < this.files.filter((file) => file.changedLines > 0).length;
    const text = selected
      .map((file) => `${file.header}\n${file.head}${file.tail ? "[truncated]\n" + file.tail : ""}`)
      .join("\n");
    return `${truncated ? "[truncated] Representative excerpts across changed components; use the file overview for breadth.\n\n" : ""}${text}`.slice(
      0,
      maxChars,
    );
  }
}
