const { app, BrowserWindow } = require("electron");

app.on("ready", () => {
  console.log("ready");
  const win = new BrowserWindow({ show: true });

  setTimeout(() => {
    console.log("creating replacement window");
    const replacement = new BrowserWindow({ show: false });
    console.log("destroying old window");
    win.destroy();
  }, 1000);
});

app.on("window-all-closed", () => {
  console.log("window-all-closed fired");
  app.quit();
});
