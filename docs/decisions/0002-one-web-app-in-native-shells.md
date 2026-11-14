# 2. One web app, inside Capacitor on Android and Electron on the desktop

Date: 2026-11-14 · Status: accepted (replaces an earlier idea of Expo / React Native)

## Context

Noterat needs Android (both phones are Android), a Linux desktop, and the web. Hooden, the same
author's community app, already has a Next.js site, an Android app that shows the server's site in a
web view (with FCM push and updates from the server) and an Electron desktop app. But a web view of the
server doesn't open offline, which Noterat must.

## Decision

- The app is one **React + TypeScript** app built with **Vite**: a single-page app that works from its
  local copy, not pages rendered by the server.
- On Android it's wrapped in **Capacitor**: the built app ships inside the APK, so it opens offline, and
  native plugins add what the web can't do well (ML Kit's document scanner, push).
- On the desktop it will be wrapped in Electron, starting from Hooden's shell.
- The same build is served by the server for the web.
- Writing uses **Tiptap**, as in Hooden; its collaboration extension is built on Yjs (decision 1).
- iOS is left out for now; Capacitor can add it later.

## Consequences

- One codebase and one language (TypeScript) for the app and the server, close to Hooden's.
- Expo was the alternative; it can't build a Linux desktop app, and Yjs and Tiptap fit a web app better.
- The Android app talks to the server across origins (it runs from `https://localhost`), so the API
  uses bearer tokens rather than cookies (decision 4).
