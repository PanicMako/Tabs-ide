export interface CodeReviewNote {
  file: string;
  line: number;
  endLine: number;
  comment: string;
  replacement?: string;
}
export function formatCodeReviewNotes(notes: CodeReviewNote[], identity: string): string {
  const text = [
    `Code review: ${identity}`,
    ...notes.map(
      (note, i) =>
        `${i + 1}. ${note.file}:${note.line}${note.endLine !== note.line ? `–${note.endLine}` : ""}\n${note.comment}${note.replacement !== undefined ? `\nSuggested replacement (not applied):\n${note.replacement}` : ""}`,
    ),
  ].join("\n\n");
  if (!notes.length) throw new Error("Add a review note first.");
  if (text.length > 2000)
    throw new Error(
      "These notes exceed the decision's 2,000-character limit. Shorten them or copy the notes separately.",
    );
  return text;
}
