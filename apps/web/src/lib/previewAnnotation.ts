import type { PreviewAnnotationPayload, ProjectId } from "@tabs/contracts";

export const PREVIEW_ANNOTATION_PICKED_EVENT = "tabs:preview-annotation-picked";

export interface PreviewAnnotationPickedDetail {
  projectId: ProjectId;
  annotation: PreviewAnnotationPayload;
}

export function appendPreviewAnnotationPrompt(
  prompt: string,
  annotation: PreviewAnnotationPayload,
): string {
  const lines = [
    "<preview_annotation>",
    `Id: ${annotation.id}`,
    `Page: ${annotation.pageTitle?.trim() || annotation.pageUrl}`,
  ];
  if (annotation.comment.trim()) lines.push(`Comment: ${annotation.comment.trim()}`);
  for (const target of annotation.elements) {
    lines.push(`Element selector: ${target.element.selector ?? "(unavailable)"}`);
    lines.push(`Element HTML: ${target.element.htmlPreview}`);
    if (target.element.styles.trim()) lines.push(`Computed styles: ${target.element.styles}`);
  }
  for (const change of annotation.styleChanges) {
    lines.push(
      `Style change: ${change.property}: ${change.previousValue || "(unset)"} -> ${change.value}`,
    );
  }
  if (annotation.regions.length) lines.push(`Marked regions: ${annotation.regions.length}`);
  if (annotation.strokes.length) lines.push(`Drawn strokes: ${annotation.strokes.length}`);
  if (annotation.screenshot) lines.push("The attached image is the captured preview screenshot.");
  lines.push("</preview_annotation>");
  return [prompt.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

export async function previewAnnotationScreenshotFile(
  annotation: PreviewAnnotationPayload,
): Promise<File | null> {
  if (!annotation.screenshot?.dataUrl) return null;
  const blob = await (await fetch(annotation.screenshot.dataUrl)).blob();
  return new File([blob], `preview-annotation-${annotation.id}.png`, {
    type: blob.type || "image/png",
  });
}
