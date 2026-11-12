// Notes are saved per project and profile through the host's storage broker.
const notes = document.getElementById("notes");
const status = document.getElementById("status");
const KEY = "notes";
let timer = 0;

async function load() {
  try {
    const saved = await window.tabsExtension.storage.get(KEY);
    notes.value = typeof saved === "string" ? saved : "";
    status.textContent = "";
  } catch (error) {
    status.textContent = `Storage is off for this project: ${error.message}`;
    notes.disabled = true;
  }
}

notes.addEventListener("input", () => {
  clearTimeout(timer);
  status.textContent = "Saving…";
  timer = setTimeout(async () => {
    try {
      await window.tabsExtension.storage.set(KEY, notes.value);
      status.textContent = "Saved";
    } catch (error) {
      status.textContent = `Could not save: ${error.message}`;
    }
  }, 400);
});

void load();
