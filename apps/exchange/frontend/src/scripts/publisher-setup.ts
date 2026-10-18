// Preview the identity the user is choosing without reserving or changing it.
const namespaceInput = document.querySelector<HTMLInputElement>("#new-namespace");
const preview = document.querySelector<HTMLOutputElement>("#namespace-example-name");
namespaceInput?.addEventListener("input", () => {
  if (preview) preview.textContent = namespaceInput.value.trim() || "your-name";
});

export {};
