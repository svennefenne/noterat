import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { randomHex } from "@noterat/core";
import { isApp } from "./api";

/**
 * The lock in front of the journal, or the whole app (decision 7): this device's, for this person on
 * this server. In the Android app it opens with the fingerprint (or the phone's own PIN or pattern); on
 * the web, and on a phone without either, with a PIN set here. It locks again when the app has been in
 * the background longer than `after` minutes.
 *
 * It hides what's behind it; it doesn't encrypt anything. What's on the device stays as it was.
 */

export type LockScope = "off" | "journal" | "app";
export type LockMethod = "biometric" | "pin";

export interface LockSettings {
  scope: LockScope;
  method: LockMethod;
  /** minutes in the background before it locks again */
  after: number;
  pin?: { salt: string; hash: string };
}

export interface LockState {
  settings: LockSettings;
  locked: boolean;
}

const OFF: LockSettings = { scope: "off", method: "pin", after: 5 };
const pinHash = (salt: string, pin: string) => bytesToHex(sha256(utf8ToBytes(`${salt}:${pin}`)));

/** Whether this device can open the lock with the fingerprint (or the phone's own screen lock). */
export async function biometricAvailable(): Promise<boolean> {
  if (!isApp) return false;
  try {
    return (await NativeBiometric.isAvailable({ useFallback: true })).isAvailable;
  } catch {
    return false;
  }
}

export class AppLock {
  private state: LockState;
  private readonly listeners = new Set<() => void>();
  private hiddenAt: number | null = null;

  constructor(private readonly key: string) {
    const settings = this.load();
    // (it starts locked: opening the app is like coming back to it)
    this.state = { settings, locked: settings.scope !== "off" };
    document.addEventListener("visibilitychange", this.seen);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<LockState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Whether a kind of thing is behind the lock right now. */
  hides(what: "journal" | "app"): boolean {
    const { settings, locked } = this.state;
    return locked && (settings.scope === "app" || (what === "journal" && settings.scope === "journal"));
  }

  /** Open it: with the fingerprint (no pin given), or with the PIN. */
  async unlock(pin?: string, reason = ""): Promise<boolean> {
    const { settings } = this.state;
    let ok = false;
    if (pin !== undefined) ok = !!settings.pin && pinHash(settings.pin.salt, pin) === settings.pin.hash;
    else if (settings.method === "biometric")
      ok = await NativeBiometric.verifyIdentity({ reason, title: reason, useFallback: true }).then(
        () => true,
        () => false,
      );
    if (ok) this.set({ locked: false });
    return ok;
  }

  lockNow() {
    if (this.state.settings.scope !== "off") this.set({ locked: true });
  }

  /** New settings (a new PIN is given as text and kept as a hash). Opens it: it was just set up. */
  save(next: Omit<LockSettings, "pin">, newPin?: string) {
    const salt = randomHex(16);
    const settings: LockSettings = { ...next, pin: newPin ? { salt, hash: pinHash(salt, newPin) } : this.state.settings.pin };
    if (settings.scope === "off") delete settings.pin;
    try {
      localStorage.setItem(this.key, JSON.stringify(settings));
    } catch {
      // (not kept: it's as it was next time the app opens)
    }
    this.set({ settings, locked: false });
  }

  /** Logging out with the device forgetting this person: the lock goes too. */
  forget() {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // (nothing to do)
    }
  }

  destroy() {
    document.removeEventListener("visibilitychange", this.seen);
    this.listeners.clear();
  }

  private load(): LockSettings {
    try {
      const s = JSON.parse(localStorage.getItem(this.key) ?? "null") as LockSettings | null;
      if (s && ["journal", "app"].includes(s.scope) && (s.method === "biometric" || s.pin)) return { ...OFF, ...s };
    } catch {
      // (unreadable: off)
    }
    return OFF;
  }

  private seen = () => {
    if (document.visibilityState === "hidden") this.hiddenAt = Date.now();
    else if (this.hiddenAt !== null) {
      if (Date.now() - this.hiddenAt >= this.state.settings.after * 60_000) this.lockNow();
      this.hiddenAt = null;
    }
  };
}
