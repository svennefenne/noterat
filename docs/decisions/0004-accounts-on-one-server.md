# 4. Accounts on one server, sharing by invitation, bearer tokens

Date: 2026-11-14 · Status: accepted

## Context

Things are shared only when someone chooses to, by a link ("Sam wants to share Shopping list with you")
or, between people on the same server, by a notification in the app. The server is reached from outside
through a domain and a reverse proxy with HTTPS.

## Decision

- Everyone who shares has an account on the same server. There's no sharing between different Noterat
  servers (federation).
- The first account made is the admin. After that there's no open sign-up: a share link is also an
  invitation to make an account (phase 1).
- Logging in gives the device a random token, sent as `Authorization: Bearer …`; the server keeps only
  its sha256. A session lasts 180 days from its last use. Passwords are scrypt hashes; wrong passwords
  are throttled per visitor (behind a proxy, by the header it sets: `TRUSTED_IP_HEADER`).
- The API allows any origin, since only a valid token does anything (the Android app runs from its own
  origin).

## Consequences

- No federation keeps sharing simple: one server, one set of people, one place to back up.
- Tokens work the same for the web, Android and the desktop, and for the sync's WebSocket.
- A token lives in the device's storage; logging out removes it there and on the server.
