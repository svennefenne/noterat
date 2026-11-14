import type { CapacitorConfig } from "@capacitor/cli";

// The Android app: the built app (dist) inside it, so it opens without a connection; it talks to the
// server the person picks on its first screen.
const config: CapacitorConfig = {
  appId: "io.github.svennefenne.noterat",
  appName: "Noterat",
  webDir: "dist",
  android: {
    // a server at home can be plain http on the local network (http://192.168.1.10:3300), while the
    // app itself runs from https://localhost
    allowMixedContent: true,
  },
};

export default config;
