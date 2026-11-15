# Noterat for the Linux desktop

## Desktop app (Linux)

Noterat's own web app in an Electron window, as one AppImage file. The app's build is inside it and is
served from `app://noterat/`, so it opens and works offline exactly like the Android app: the first time
it asks for your server's address and you log in; after that its notes, lists and the rest live in the
app's own storage and sync with the server whenever it can be reached.

Closing the window puts Noterat in the tray, where it keeps syncing and showing notifications (a click on
one opens the window). The tray icon's menu has *Open Noterat*, *Start at log-in* (it then starts in the
tray, without the window) and *Quit*. Starting it again while it runs opens the window it already has.
Links to other sites open in your browser. In Swedish when the computer is.

To install it, download the AppImage (the *Desktop app* workflow's artifact on GitHub), make it
executable (`chmod +x noterat-desktop-*.AppImage`) and start it. On GNOME, tray icons need the
*AppIndicator and KStatusNotifierItem Support* extension; without it there's no icon to go back to, but
starting Noterat again brings back its window.

### Building and running

The desktop app isn't one of the repository's npm workspaces (Electron is big and the server doesn't need
it), so it has its own `npm ci`:

```sh
npm ci && npm run build -w @noterat/app     # at the repository's root: the web build, apps/app/dist
cd apps/desktop
npm ci
npm start       # copies the web build into web/ and runs it from source
npm test        # the app:// rules (paths, types) and the log-in desktop file
npm run dist    # the AppImage: dist/noterat-desktop-<version>-x86_64.AppImage
```

`--hidden` starts it in the tray. Ctrl + / Ctrl − / Ctrl 0 zoom, F11 is full screen and F12 the developer
tools. Its data is in `~/.config/Noterat`; starting at log-in is `~/.config/autostart/noterat.desktop`.
