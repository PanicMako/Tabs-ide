const bridge = window.tabsExtension;
const accountButton = document.getElementById("load-account");
const accountStatus = document.getElementById("account-status");
const readForm = document.getElementById("read-form");
const pathField = document.getElementById("relative-path");
const readStatus = document.getElementById("read-status");
const preview = document.getElementById("preview");
const analyzeButton = document.getElementById("analyze");
const analysisStatus = document.getElementById("analysis-status");
const errorOutput = document.getElementById("error");
let loadedText = null;

function clearError() {
  errorOutput.textContent = "";
  errorOutput.hidden = true;
}

function showError(error) {
  errorOutput.textContent = error instanceof Error ? error.message : String(error);
  errorOutput.hidden = false;
}

try {
  const lastPath = await bridge.storage.get("lastPath");
  if (typeof lastPath === "string") pathField.value = lastPath;
} catch {
  // The workspace and account flows do not require a profile-storage grant.
}

accountButton.addEventListener("click", async () => {
  clearError();
  accountButton.disabled = true;
  accountStatus.textContent = "Loading the assigned account...";
  try {
    const response = await bridge.network.getText("https://api.github.com/user", {
      useProfileCredential: true,
    });
    const user = JSON.parse(response);
    if (typeof user.login !== "string" || !user.login) {
      throw new Error("GitHub returned an unexpected account response.");
    }
    accountStatus.textContent = user.name ? `${user.name} (${user.login})` : user.login;
  } catch (error) {
    accountStatus.textContent = "Account unavailable.";
    showError(error);
  } finally {
    accountButton.disabled = false;
    accountButton.focus();
  }
});

readForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  loadedText = null;
  analyzeButton.disabled = true;
  preview.textContent = "";
  readStatus.textContent = "Reading project file...";
  try {
    const path = pathField.value.trim();
    const text = await bridge.workspace.readText(path);
    loadedText = text.slice(0, 10_000);
    preview.textContent = loadedText;
    readStatus.textContent = `Read ${text.length} UTF-16 code units. Preview and analysis use the first ${loadedText.length}.`;
    analyzeButton.disabled = false;
    analysisStatus.textContent = "Ready to analyze loaded text.";
    try {
      await bridge.storage.set("lastPath", path);
    } catch {
      // A workspace-read grant can be used without a profile-storage grant.
    }
  } catch (error) {
    readStatus.textContent = "Project file unavailable.";
    analysisStatus.textContent = "Read a file first.";
    showError(error);
    pathField.focus();
  }
});

analyzeButton.addEventListener("click", async () => {
  if (loadedText === null) return;
  clearError();
  analyzeButton.disabled = true;
  analysisStatus.textContent = "Analyzing supplied text...";
  try {
    const result = await bridge.logic.invoke("analyze-text", { text: loadedText });
    analysisStatus.textContent = `${result.words} words, ${result.lines} lines, ${result.characters} Unicode characters.`;
  } catch (error) {
    analysisStatus.textContent = "Analysis unavailable.";
    showError(error);
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.focus();
  }
});
