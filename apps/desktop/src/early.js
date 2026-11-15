// What must happen before the app is ready. (It's a module of its own because an ES module entry point's
// own code may run after "ready": only the side effects of its imports are sure to run before.)
import { protocol } from "electron";
import { SCHEME } from "./protocol.js";

// app://noterat/ as a real origin: secure (the microphone, crypto.subtle), with fetch, CORS, IndexedDB
// and localStorage of its own, and media that can stream
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);
