const button = document.getElementById("refresh");
const message = document.getElementById("message");
const branch = document.getElementById("branch");
const dirty = document.getElementById("dirty");

button.addEventListener("click", async () => {
  button.disabled = true;
  message.textContent = "Reading Git status...";
  try {
    const result = await window.tabsExtension.git.status();
    branch.textContent = result.branch;
    dirty.textContent = result.dirty ? "Changes present" : "Clean";
    message.textContent = "Git status updated.";
  } catch (error) {
    message.textContent = `Git status unavailable: ${String(error)}`;
  } finally {
    button.disabled = false;
  }
});
