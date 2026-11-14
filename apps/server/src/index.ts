import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { config } from "./config";
import { openDb } from "./db";

const db = openDb(path.join(config.dataDir, "noterat.db"));
const app = createApp({ db, version: config.version, webDir: config.webDir, trustedIpHeader: config.trustedIpHeader });

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Noterat ${config.version} on port ${info.port}; data in ${config.dataDir}${config.webDir ? "" : " (no WEB_DIR: API only)"}`);
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  // (open connections get a few seconds to finish)
  const done = () => {
    db.close();
    process.exit(0);
  };
  server.close(done);
  setTimeout(done, 5000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
