/* global require, process, location, window */
// The page's side of the shell (sandboxed, so CommonJS: an ES module can't be a sandboxed preload).
//
// window.noteratDesktop = { version, platform }: the app knows it runs in the desktop app by it (isDesktop
// in apps/app/src/lib/api.ts), and asks for the server's address as on Android.
//
// A click on one of the page's notifications brings the window back from the tray: Electron only passes
// the click to the page, and a hidden window ignores the page's own window.focus().

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";

if (location.protocol === "app:" && location.host === "noterat") {
  contextBridge.exposeInMainWorld("noteratDesktop", { version: arg("noterat-version"), platform: "linux" });

  contextBridge.executeInMainWorld({
    // (run in the page's own world, so the page's Notification is the one changed)
    func: (show) => {
      const Native = window.Notification;
      if (typeof Native !== "function") return;
      class Notification extends Native {
        constructor(title, options) {
          super(title, options);
          this.addEventListener("click", () => show());
        }
      }
      Object.defineProperty(window, "Notification", { value: Notification, writable: true, configurable: true });
    },
    args: [() => ipcRenderer.send("noterat:show")],
  });
}
