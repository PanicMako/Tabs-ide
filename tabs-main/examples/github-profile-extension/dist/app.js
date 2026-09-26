const button = document.getElementById("load");
const status = document.getElementById("status");
const account = document.getElementById("account");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.setAttribute("role", "status");
  status.textContent = "Loading the assigned account...";
  account.textContent = "No account loaded.";
  try {
    const text = await window.tabsExtension.network.getText("https://api.github.com/user", {
      useProfileCredential: true,
    });
    const user = JSON.parse(text);
    if (typeof user.login !== "string" || !user.login) {
      throw new Error("GitHub returned an unexpected account response.");
    }
    account.textContent = user.name ? `${user.name} (${user.login})` : user.login;
    status.textContent = "Account loaded.";
  } catch (error) {
    status.setAttribute("role", "alert");
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
    button.focus();
  }
});
