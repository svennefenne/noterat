// Noterat on the Linux desktop: the app's own web build (web/, a copy of apps/app/dist) in a window,
// served as app://noterat/, so it opens and works offline like the Android app: its data is in the
// window's IndexedDB, and it talks to the server picked at log-in across origins with its token. Closing
// the window puts it in the tray, where it keeps syncing and showing notifications; Quit ends it.
//
//   --hidden   start in the tray, without the window (as at log-in)
import "./early.js";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, protocol, screen, session, shell, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { autostartOn, setAutostart } from "./autostart.js";
import { isAppUrl, locate, mimeType, ORIGIN, SCHEME } from "./protocol.js";
import { setLang, t } from "./text.js";

const ROOT = path.join(import.meta.dirname, "..");
const WEB = path.join(ROOT, "web");
const ASSETS = path.join(ROOT, "assets");
const HIDDEN = process.argv.includes("--hidden");
/** What starts this copy: the AppImage where it is now; run from source, Electron with the app's folder. */
const COMMAND = process.env.APPIMAGE ? [process.env.APPIMAGE] : app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];

let win = null;
let tray = null;
let quitting = false;

// ------------------------------------------------------------ the app's files

function serveWeb() {
  protocol.handle(SCHEME, async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    try {
      const file = await locate(WEB, request.url);
      if (!file) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
      const body = request.method === "HEAD" ? null : await fs.promises.readFile(file);
      return new Response(body, { headers: { "content-type": mimeType(file), "x-content-type-options": "nosniff", "cache-control": "no-cache" } });
    } catch (e) {
      console.error(`app:// ${request.url}:`, e);
      return new Response("Error", { status: 500 });
    }
  });
}

// ------------------------------------------------------------ what the page may do

/** The microphone (voice memos), the camera (photos), notifications and copying: for the app only. */
const ALLOWED = new Set(["notifications", "media", "clipboard-sanitized-write"]);

function guardSession(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok = ALLOWED.has(permission) && isAppUrl(details.requestingUrl);
    if (!ok) console.warn(`denied: ${permission} (${details.requestingUrl})`);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => ALLOWED.has(permission) && isAppUrl(requestingOrigin));
  const spelling = ["sv", "en-US"].filter((l) => ses.availableSpellCheckerLanguages.includes(l));
  if (spelling.length) ses.setSpellCheckerLanguages(spelling);
}

const openOutside = (url) => {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
};

/** Only the app stays in its window: web links open in the browser, anything else goes nowhere. */
function guardContents(wc) {
  wc.on("will-attach-webview", (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    openOutside(url);
  });
}

// ------------------------------------------------------------ the window

const stateFile = () => path.join(app.getPath("userData"), "window.json");

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}

function writeState() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch (e) {
    console.error("couldn't keep the window's place:", e);
  }
}

/** The size (and the place, if it's still on a screen) the window had last time. */
function placed(bounds) {
  const size = { width: 1200, height: 820 };
  if (!bounds || !(bounds.width >= 380 && bounds.height >= 500)) return size;
  const { x, y, width, height } = bounds;
  const seen = Number.isFinite(x) && Number.isFinite(y) && screen.getAllDisplays().some(({ workArea: a }) => x < a.x + a.width - 80 && x + width > a.x + 80 && y >= a.y - 20 && y < a.y + a.height - 80);
  return seen ? { x, y, width, height } : { width, height };
}

let maximizeOnShow = false;

function show() {
  if (!win || win.isDestroyed()) return;
  // (maximize() on a hidden window would show it: started hidden, it's done here)
  if (maximizeOnShow) {
    maximizeOnShow = false;
    win.maximize();
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const state = readState();
  maximizeOnShow = state.maximized === true;
  win = new BrowserWindow({
    ...placed(state.bounds),
    minWidth: 380,
    minHeight: 500,
    show: false,
    title: "Noterat",
    icon: nativeImage.createFromPath(path.join(ASSETS, "icon.png")),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#161514" : "#f5f2ec",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // (throttled in the tray, as a background tab is: it keeps syncing over its WebSocket, and the page
      // sees itself hidden, which the app's lock goes by; backgroundThrottling: false would hide that)
      additionalArguments: [`--noterat-version=${app.getVersion()}`],
    },
  });
  win.once("ready-to-show", () => {
    if (!HIDDEN) show();
  });

  let saving;
  const save = () => {
    clearTimeout(saving);
    saving = setTimeout(writeState, 500);
  };
  for (const ev of ["resize", "move", "maximize", "unmaximize"]) win.on(ev, save);
  win.on("close", (e) => {
    writeState();
    // (without a tray to come back from, closing it quits)
    if (quitting || !tray) return;
    e.preventDefault();
    win.hide();
  });

  const wc = win.webContents;
  wc.on("render-process-gone", (_e, d) => {
    if (d.reason !== "clean-exit") setTimeout(() => !win.isDestroyed() && wc.reload(), 1000);
  });
  wc.on("context-menu", (_e, p) => contextMenu(p)?.popup({ window: win }));
  // no menu bar: zoom, full screen and the developer tools by their keys
  wc.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown") return;
    const mod = i.control || i.meta;
    if (mod && (i.key === "+" || i.key === "=")) wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4));
    else if (mod && i.key === "-") wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3));
    else if (mod && i.key === "0") wc.setZoomLevel(0);
    else if (i.key === "F11") win.setFullScreen(!win.isFullScreen());
    else if (i.key === "F12" || (mod && i.shift && i.key.toLowerCase() === "i")) wc.toggleDevTools();
    else return;
    e.preventDefault();
  });

  void win.loadURL(`${ORIGIN}/`);
}

/** Right-click: spelling suggestions, and cut, copy and paste. */
function contextMenu(p) {
  const wc = win.webContents;
  const items = [];
  for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
  if (p.misspelledWord) items.push({ label: t("Add to dictionary"), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: "separator" });
  if (p.isEditable) {
    items.push(
      { label: t("Cut"), role: "cut", enabled: p.editFlags.canCut },
      { label: t("Copy"), role: "copy", enabled: p.editFlags.canCopy },
      { label: t("Paste"), role: "paste", enabled: p.editFlags.canPaste },
      { type: "separator" },
      { label: t("Select all"), role: "selectAll" },
    );
  } else if (p.selectionText.trim()) {
    items.push({ label: t("Copy"), role: "copy" });
  }
  while (items.at(-1)?.type === "separator") items.pop();
  return items.length ? Menu.buildFromTemplate(items) : null;
}

// ------------------------------------------------------------ the tray

function quit() {
  quitting = true;
  app.quit();
}

function trayMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t("Open Noterat"), click: show },
      {
        label: t("Start at log-in"),
        type: "checkbox",
        checked: autostartOn(),
        click: (item) => {
          try {
            setAutostart(item.checked, COMMAND);
          } catch (e) {
            console.error("couldn't change starting at log-in:", e);
          }
          trayMenu();
        },
      },
      { type: "separator" },
      { label: t("Quit"), click: quit },
    ]),
  );
}

function createTray() {
  try {
    // (tray@2x.png beside it for a scaled screen)
    tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, "tray.png")));
  } catch (e) {
    console.error("no tray here:", e);
    return;
  }
  tray.setToolTip("Noterat");
  tray.on("click", show);
  trayMenu();
}

// ------------------------------------------------------------ starting

function start() {
  setLang(app.getLocale());
  Menu.setApplicationMenu(null);
  serveWeb();
  guardSession(session.defaultSession);
  createTray();
  createWindow();
  // (the AppImage may have moved since starting at log-in was turned on)
  if (autostartOn()) {
    try {
      setAutostart(true, COMMAND);
    } catch (e) {
      console.error("couldn't update starting at log-in:", e);
    }
  }
}

// a notification clicked (preload.cjs)
ipcMain.on("noterat:show", (e) => {
  if (win && e.sender === win.webContents && isAppUrl(e.senderFrame?.url ?? "")) show();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (!argv.includes("--hidden")) show();
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  // (it closes only when quitting, or when there's no tray)
  app.on("window-all-closed", () => app.quit());
  app.on("web-contents-created", (_e, wc) => guardContents(wc));
  void app.whenReady().then(start);
}
