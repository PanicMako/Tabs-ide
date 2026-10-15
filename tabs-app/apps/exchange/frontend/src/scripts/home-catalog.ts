import { request } from "./api";
import { validateCatalogPage } from "../lib/catalogState";
import { catalogCard } from "../lib/catalogCard";

const results = document.getElementById("home-catalog-results")!;
const status = document.getElementById("home-catalog-status")!;
const region = document.getElementById("home-catalog-region")!;
const empty = document.getElementById("home-catalog-empty")!;
const error = document.getElementById("home-catalog-error")!;
const message = document.getElementById("home-catalog-error-message")!;
const retry = document.getElementById("home-catalog-retry") as HTMLButtonElement;

async function load() {
  retry.disabled = true;
  error.hidden = true;
  empty.hidden = true;
  region.setAttribute("aria-busy", "true");
  status.textContent = "Loading published extensions…";
  try {
    const page = validateCatalogPage(await request<unknown>("/v1/extensions?sort=newest&limit=6"));
    results.replaceChildren(...page.extensions.slice(0, 6).map(catalogCard));
    empty.hidden = page.extensions.length > 0;
    status.textContent = page.extensions.length
      ? "Recently published on this registry."
      : "No published extensions yet.";
  } catch (cause) {
    results.replaceChildren();
    error.hidden = false;
    message.textContent =
      cause instanceof Error
        ? cause.message
        : "Published tools could not load. Try again or contact this registry’s operator.";
    status.textContent = "Published extensions could not be loaded.";
  } finally {
    region.setAttribute("aria-busy", "false");
    retry.disabled = false;
  }
}
retry.addEventListener("click", () => {
  void load();
});
void load();
