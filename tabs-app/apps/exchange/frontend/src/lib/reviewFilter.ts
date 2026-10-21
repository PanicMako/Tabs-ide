/** Filter only the bounded packages already loaded from the authorized review API. */
export function filterReviewPackages(list: HTMLElement, query: string, scope: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const packages = Array.from(list.querySelectorAll<HTMLElement>("[data-review-identity]"));
  let visible = 0;
  for (const item of packages) {
    const matchesScope =
      scope === "pending"
        ? item.dataset.reviewStatus !== "approved"
        : scope === "approved"
          ? item.dataset.reviewStatus === "approved"
          : true;
    const identity = item.dataset.reviewIdentity!.toLowerCase();
    item.hidden = !matchesScope || !terms.every((term) => identity.includes(term));
    if (!item.hidden) visible++;
  }
  const previous = list.querySelector<HTMLElement>("[data-filter-empty]");
  if (packages.length && !visible) {
    const empty = previous ?? document.createElement("li");
    empty.className = "review-empty";
    empty.dataset.filterEmpty = "true";
    const title = document.createElement("h3");
    const pendingOnly = scope === "pending" && !terms.length;
    title.textContent = pendingOnly
      ? "No pending packages in this view."
      : "Nothing matches this view.";
    const message = document.createElement("p");
    message.textContent = pendingOnly
      ? "Refresh to check for new submissions, or choose Approved versions to inspect a reviewed package. Use Publish approved to make a signed release."
      : "Try another namespace, version, or digest, or show all loaded packages. This filter does not search older releases.";
    empty.replaceChildren(title, message);
    if (!previous) list.append(empty);
  } else if (visible || !packages.length) previous?.remove();
  return `${visible} of ${packages.length} loaded package${packages.length === 1 ? "" : "s"} shown. Search applies to this queue only.`;
}
