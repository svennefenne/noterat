import path from "node:path";

/** How the server is set up: environment variables (see .env.example and the Unraid template). */
export const config = {
  port: Number(process.env.PORT) || 3000,
  /** the database and (from phase 1) the files people add; back this folder up */
  dataDir: path.resolve(process.env.DATA_DIR || ".data"),
  /** the app's built files, served on every path that isn't /api (in Docker: /app/web; in development Vite serves them) */
  webDir: process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : null,
  /** the address people use, e.g. https://noterat.example.com (share links, from phase 1) */
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  /** behind a proxy that puts the visitor's address in a header (cf-connecting-ip, x-real-ip): that header */
  trustedIpHeader: (process.env.TRUSTED_IP_HEADER || "").toLowerCase(),
  version: process.env.NOTERAT_VERSION || "dev",
};
