const input = document.querySelector<HTMLInputElement>("#api-operation-search")!;
const status = document.querySelector<HTMLElement>("#api-operation-status")!;
const operations = [...document.querySelectorAll<HTMLElement>("[data-api-search]")];
const links = [...document.querySelectorAll<HTMLElement>("[data-api-link]")];
function filter() {
  const terms = input.value.trim().toLowerCase().slice(0, 100).split(/\s+/).filter(Boolean);
  let count = 0;
  for (const operation of operations) {
    operation.hidden = !terms.every((term) =>
      operation.dataset.apiSearch!.toLowerCase().includes(term),
    );
    if (!operation.hidden) count++;
  }
  for (const link of links) link.hidden = document.getElementById(link.dataset.apiLink!)!.hidden;
  status.textContent = count
    ? `${count} matching endpoint${count === 1 ? "" : "s"}`
    : "No endpoints found. Try a path, method, or fewer words.";
}
input.addEventListener("input", filter);
window.addEventListener("hashchange", () => {
  const target = document.getElementById(location.hash.slice(1));
  if (target?.matches("[data-api-search]") && target.hidden) {
    input.value = "";
    filter();
    target.scrollIntoView();
  }
});
export {};
