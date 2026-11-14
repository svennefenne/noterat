import { Capacitor } from "@capacitor/core";
import type { ApiErrorBody, ErrorCode, LoginInput, ServerInfo, SessionReply, SetupInput, User } from "@noterat/core";

/**
 * Talking to the server. On the web the app is served by the server itself, so the API is on the same
 * address (base ""). In the Android app (and later the desktop app) the server is wherever the person
 * says on the first screen, and the app calls it across origins with its session token.
 */

export const isApp = Capacitor.isNativePlatform();

/** Why a call failed: the server's own code, or "network" (no answer: offline, or a wrong address). */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "network",
    readonly status: number,
  ) {
    super(code);
  }
}

interface Call {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string;
}

async function call<T>(base: string, path: string, { method = "GET", body, token }: Call = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError("network", 0);
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((data as ApiErrorBody | null)?.error ?? "server_error", res.status);
  return data as T;
}

export const api = {
  serverInfo: (base: string) => call<ServerInfo>(base, "/api/server"),
  setup: (base: string, input: SetupInput) => call<SessionReply>(base, "/api/setup", { method: "POST", body: input }),
  login: (base: string, input: LoginInput) => call<SessionReply>(base, "/api/login", { method: "POST", body: input }),
  me: (base: string, token: string) => call<User>(base, "/api/me", { token }),
  logout: (base: string, token: string) => call<void>(base, "/api/logout", { method: "POST", token }),
};

/** What someone typed as the server's address, made whole: https:// unless they wrote http://, no path. Null: not an address. */
export function serverAddress(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return url.origin;
  } catch {
    return null;
  }
}

// What's kept on this device (localStorage, which the Android app keeps with its own data). Every read
// and write may fail (storage turned off): the app then works for as long as it's open.
const KEYS = { server: "noterat.server", session: "noterat.session" };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // (not kept: asked again next time)
  }
}

/** The server this device uses: "" on the web (the site itself); in the app the one picked, or null before that. */
export const server = {
  load: (): string | null => (isApp ? read(KEYS.server) : ""),
  save: (base: string) => write(KEYS.server, base),
  clear: () => write(KEYS.server, null),
};

export interface Session {
  token: string;
  user: User;
}

/** The session on this device: its token and who it's for, kept so the app opens at once (offline too). */
export const session = {
  load(): Session | null {
    try {
      const s = JSON.parse(read(KEYS.session) ?? "null") as Session | null;
      return s && typeof s.token === "string" && s.user ? s : null;
    } catch {
      return null;
    }
  },
  save: (s: Session) => write(KEYS.session, JSON.stringify(s)),
  clear: () => write(KEYS.session, null),
};
