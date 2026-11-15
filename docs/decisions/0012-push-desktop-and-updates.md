# 12. Push through the household's own Firebase, a bundled desktop app, shortcuts, updates from the server

Date: 2026-11-15 · Status: accepted (phase 8)

## Context

Phase 8 makes Noterat feel like an app that's always there: notifications that arrive with the app
closed, a Linux desktop app that works offline like the phone, quick ways in from the home screen, and
updates to the Android app without a store. Hooden did push and updates from its own server; its desktop
shell loaded the server's address, so it showed nothing offline.

## Decision

- **Push goes through Firebase Cloud Messaging, with the household's own Firebase project.** Nothing
  about Firebase is built into the APK (it's built by CI from a public repository). An admin creates a
  free Firebase project and pastes in two files: `google-services.json`, whose public half (app id, API
  key, project, sender) the server hands to the phones, and a service account's key, which stays on the
  server. The phone starts Firebase with the server's settings through a small plugin of our own and keeps
  them, so an `Application` class starts Firebase as the process starts and a push that wakes the app
  finds it ready. Capacitor's push plugin then asks for permission and gets the token.
- **The server signs its own OAuth token** (RS256 with `node:crypto`, RFC 7523) and calls FCM's HTTP v1
  API; no Google library. A device's token is tied to the session it was registered in, so logging out
  forgets it, and a token Firebase no longer knows is dropped when a send says so.
- **A push says that something happened, never what's in it**: "Ada shared a list with you", "your voice
  memo has been turned into text", "the document has been read". Not the list's name, not the text. Each
  person picks the kinds (invitations on, transcriptions on, scans off by default) and quiet hours, kept on
  the server, which does the sending; in quiet hours nothing is pushed (the app still shows it). A push
  is shown while the app is open as well (Capacitor's `presentationOptions`), like any other app's.
- **The desktop app is Electron with the web app inside it** (`apps/desktop`), served from a privileged
  `app://noterat` scheme, so it opens and works offline exactly like the phone: the same IndexedDB copy,
  the server picked at log-in, the bearer token across origins. It lives in the tray (closing the window
  hides it), can start at log-in (an XDG autostart file, since Electron's own setting does nothing on
  Linux), opens links in the browser, and allows the microphone, the camera and notifications only. Calendar
  reminders, and the same notices a phone gets a push for, are the system's notifications while it runs.
  Those notices need no Firebase: the app says hello on its home document, which it always has open, and
  the server sends each one there as a stateless message, after the same choices and quiet hours (a phone
  and the website don't say hello, so they get none that way). It's built by CI as an
  AppImage. It isn't a workspace of the monorepo, so the server's image and CI never download Electron.
- **`isNative` and `isApp` are two things now**: `isNative` (the phone: scanner, fingerprint, sharing a
  file) and `isApp` (the phone or the desktop: the server is elsewhere and asked for).
- **Quick ways in on Android**: launcher shortcuts (long-press the icon) and a home-screen widget with four
  buttons: a new voice memo (recording at once), the scanner, a new note, the lists. They show no data, so
  nothing private is on the home screen and nothing has to sync natively. They open `noterat://` links that
  the app routes like its own paths.
- **Android updates from the server**: the newest APK put in the data folder's `app/` (named as CI names
  it, `noterat-android-0.1.0-23.apk`) is offered to every phone on an older build, as a banner with the
  download; the phone installs it over the old one. (Since decision 16 the apps come in the server's
  image and update themselves.)

## Consequences

- Push needs the admin's ten minutes in the Firebase console once; until then everything works without
  it, and the phones simply don't ask. Changing the Firebase project takes effect at the app's next start.
- Google sees that a phone got a notification and its few generic words, nothing more.
- The desktop app keeps its own offline copy, like a phone, and is updated by downloading a new AppImage
  (since decision 16 it does that itself).
- A web service worker (an offline website) isn't needed for anyone: the phone and the desktop have the
  app inside them, and the website is for when you're at someone else's computer.
