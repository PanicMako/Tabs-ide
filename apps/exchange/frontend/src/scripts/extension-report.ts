import { request, RegistryRequestError } from "./api";
const form = document.getElementById("extension-report") as HTMLFormElement | null;
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const identity = /^\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/?$/.exec(
    location.pathname,
  );
  const fields = form.querySelector("fieldset")!;
  const result = form.querySelector<HTMLElement>("[data-result]")!;
  if (!identity || !form.dataset.version || fields.disabled) return;
  const data = new FormData(form);
  fields.disabled = true;
  result.textContent = "Sending your private report…";
  try {
    const report = await request<{ id: string }>(
      `/v1/extensions/${identity[1]}/${identity[2]}/reports`,
      "POST",
      {
        version: form.dataset.version,
        category: data.get("category"),
        details: data.get("details"),
      },
    );
    result.textContent = `Report received by the Tabs review team. Reference: ${report.id}. You do not need to send it again.`;
  } catch (error) {
    fields.disabled = false;
    result.textContent =
      error instanceof Error ? error.message : "Report could not be confirmed. Please try again.";
    if (error instanceof RegistryRequestError && (error.status === 401 || error.status === 403)) {
      const signin = form.querySelector<HTMLAnchorElement>("[data-signin]")!;
      signin.href = `/auth/github/start?returnTo=${encodeURIComponent(location.pathname)}`;
      signin.hidden = false;
    }
  }
});
