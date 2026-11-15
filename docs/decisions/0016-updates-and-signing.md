# 16. The apps update themselves from the server they came with, signed with one key

Date: 2026-11-15 · Status: accepted

## Context

The Android app and the desktop app were put on the server by hand: an APK copied into the data folder's
`app/` (decision 12), an AppImage copied over the old one. Nothing showed which build anyone had. And CI
signed every APK with a debug key made for that run, so no APK could install over the one before it.

## Decision

- **One build number for everything**: the number of commits (`git rev-list --count HEAD`), with the
  version from the repository's `package.json`. The web build knows it (`__NOTERAT_BUILD__`, and
  `version.json` beside it), the server says it (`/api/server`'s `build`, from `NOTERAT_BUILD`), the APK's
  version code is it, and the desktop app reads it from its copy of the web build. The account menu shows
  "Version 0.1.0 (bygge 36)".
- **The apps come in the server's image.** On `main`, CI builds the APK and the AppImage first (the Android
  and desktop workflows, called from `ci.yml`) and passes them to the image as the build context
  `bundled`, in `/app/bundled`. Updating the server updates what it offers, and the apps it offers are
  always the build it is. One put in `/data/app` by hand is still offered when its build is newer. The
  image is some 150 MB bigger.
- **The server offers them with their SHA-256**: `/api/app/android` and `/api/app/desktop` (`{version,
  build, url, size, sha256}`), the files at `/app/noterat.apk` and `/app/noterat.AppImage`, without a
  session.
- **The phone downloads a newer build by itself** (at the start, back from the background, every six
  hours) into its cache, through the app's own plugin (`AppUpdatePlugin`), checks it against the SHA-256,
  and offers to install it. Android always asks before installing an app from outside a store, and the
  first time it asks for the right to (`REQUEST_INSTALL_PACKAGES`).
- **The desktop app replaces itself**: it downloads the new AppImage beside the running one, checks its
  size, SHA-256 and that it's an AppImage, and renames it over the old path, so the menu entry and
  starting at log-in still point at it. Hidden in the tray it starts again at once; with its window open it
  offers to. It starts the new copy once the old one has ended, without the old copy's open files (the
  AppImage's runtime keeps its mount until the last copy of its keep-alive pipe is closed).
- **APKs are signed with one key**, kept as the repository's secrets (`ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`) and backed up outside the repository. Without the
  secrets a build is signed with a run's own debug key, for trying it out only.

## Consequences

- A phone with an APK signed by a debug key has to uninstall it once and install the signed one (logging
  in again); after that every update installs over it.
- Losing the key means every phone installs the app afresh. It's kept outside the repository and should
  be kept somewhere safe besides.
- An update is one tap on the phone (Android's own confirmation) and none on the desktop.
- The apps trust the server they're logged in to for what they install; the SHA-256 guards the download,
  not the server.
