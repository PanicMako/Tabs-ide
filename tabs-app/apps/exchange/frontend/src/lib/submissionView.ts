export function clearSubmissionView(document: Pick<Document, "getElementById">) {
  const identity = document.getElementById("submission-identity");
  if (identity) identity.textContent = "Submission details are not currently available.";
  for (const id of [
    "submission-metadata",
    "submission-timeline",
    "submission-reason",
    "submission-issues",
    "submission-scan",
    "submission-appeal-state",
    "submission-appeals-state",
    "submission-appeals",
  ])
    document.getElementById(id)?.replaceChildren();
  for (const id of [
    "submission-public-link",
    "submission-correction",
    "submission-correction-options",
  ]) {
    const element = document.getElementById(id);
    if (element) element.hidden = true;
  }
  document.getElementById("submission-public-link")?.removeAttribute("href");
  const message = document.getElementById(
    "submission-appeal-message",
  ) as HTMLTextAreaElement | null;
  if (message) message.value = "";
}
