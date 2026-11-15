import { registerPlugin } from "@capacitor/core";

/**
 * Which build this is, and the apps' updates from the household's own server (decision 16). The server
 * offers the Android app and the desktop app built with it; each copy asks for the newest, and installs it
 * itself: the phone through Android's installer (which always asks), the desktop app by replacing its
 * AppImage (lib/updates: the desktop shell's bridge; apps/desktop/src/update.js).
 */

/** this build: the version, the build number (the commits) and the commit */
export const BUILD = __NOTERAT_BUILD__;

/** "0.1.0 (bygge 36)" */
export const versionText = (t: (key: "version.build", vars: Record<string, string | number>) => string, version: string, build: number) =>
  build ? t("version.build", { version, build }) : version;

/** What the server offers (GET /api/app/android, /api/app/desktop). */
export interface AppRelease {
  version: string;
  build: number;
  url: string;
  size: number;
  sha256: string;
}

/** the phone's side (AppUpdatePlugin.java) */
interface AppUpdatePlugin {
  /** the APK into the app's cache, checked against its SHA-256 */
  download(o: { url: string; sha256: string; build: number }): Promise<void>;
  /** Android's installer on it ({allowed: false}: its setting for installing apps opened instead) */
  install(o: { build: number }): Promise<{ allowed: boolean }>;
  /** downloads no longer needed */
  clean(): Promise<void>;
}

export const AppUpdate = registerPlugin<AppUpdatePlugin>("AppUpdate");

/** the desktop shell's side (apps/desktop/src/preload.cjs) */
interface DesktopBridge {
  version: string;
  /** whether this copy can update itself (it runs as an AppImage) */
  updates?: boolean;
  update?: (server: string) => Promise<{ status: "updated" | "current" | "failed" | "unsupported" | "refused"; build?: number; error?: string }>;
  restart?: () => void;
}

export const desktop: DesktopBridge | undefined = typeof window === "undefined" ? undefined : (window as { noteratDesktop?: DesktopBridge }).noteratDesktop;
