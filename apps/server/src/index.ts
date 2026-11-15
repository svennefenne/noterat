import type { Server } from "node:http";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { config } from "./config";
import { openDb } from "./db";
import { createSync } from "./sync";

const db = openDb(path.join(config.dataDir, "noterat.db"));
const sync = createSync(db);
const app = createApp({
  db,
  sync,
  version: config.version,
  webDir: config.webDir,
  trustedIpHeader: config.trustedIpHeader,
  publicUrl: config.publicUrl,
  dataDir: config.dataDir,
  workerToken: config.workerToken,
  transcribeLanguage: config.transcribeLanguage,
  ocrLanguage: config.ocrLanguage,
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `Noterat ${config.version} on port ${info.port}; data in ${config.dataDir}${config.webDir ? "" : " (no WEB_DIR: API only)"}; transcription ${config.workerToken ? "on" : "off (no WORKER_TOKEN)"}`,
  );
}) as Server;
sync.attach(server);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  // (what's waiting is stored; open connections get a few seconds to finish)
  app.jobs.stop();
  app.calendars.stop();
  await sync.stop();
  const done = () => {
    db.close();
    process.exit(0);
  };
  server.close(done);
  setTimeout(done, 5000).unref();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
