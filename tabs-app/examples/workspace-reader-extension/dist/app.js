const field = document.getElementById("relative-path");
const status = document.getElementById("status");
const contents = document.getElementById("contents");

try {
  const previous = await window.tabsExtension.storage.get("lastPath");
  if (typeof previous === "string") field.value = previous;
} catch {
  // Profile storage is optional even when the manifest requests it.
}

document.getElementById("read-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  contents.textContent = "";
  status.textContent = "Reading file...";
  status.setAttribute("role", "status");
  try {
    const text = await window.tabsExtension.workspace.readText(field.value.trim());
    contents.textContent = text;
    status.textContent = `Read ${text.length} characters.`;
    try {
      await window.tabsExtension.storage.set("lastPath", field.value.trim());
    } catch {
      // Reading does not depend on a storage grant.
    }
  } catch (error) {
    status.setAttribute("role", "alert");
    status.textContent = error instanceof Error ? error.message : String(error);
    field.focus();
  }
});
