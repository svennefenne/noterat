import { Capacitor } from "@capacitor/core";
import type {
  AcceptReply,
  ApiErrorBody,
  ErrorCode,
  Household,
  LinkInfo,
  LoginInput,
  Person,
  ServerInfo,
  SessionReply,
  SetupInput,
  ShareInput,
  ShareReply,
  ShareRole,
  ShareState,
  Role,
  SignupReply,
  TranscriberInfo,
  User,
} from "@noterat/core";
import type { AppRelease } from "./updates";

/**
 * Talking to the server. On the web the app is served by the server itself, so the API is on the same
 * address (base ""). In the Android app and the desktop app the server is wherever the person
 * says on the first screen, and the app calls it across origins with its session token.
 */

/** On the phone, with its native plugins (the scanner, the fingerprint, sharing files…). */
export const isNative = Capacitor.isNativePlatform();
/** In the Linux desktop app (decision 12): the web app, bundled, in Electron. */
export const isDesktop = typeof window !== "undefined" && "noteratDesktop" in window;
/** An app (phone or desktop) rather than the website: the server is elsewhere, and asked for. */
export const isApp = isNative || isDesktop;

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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
  if (res.status === 204 || res.status === 202) return undefined as T;
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

  // a share link's page works before logging in
  linkInfo: (base: string, link: string) => call<LinkInfo>(base, `/api/links/${encodeURIComponent(link)}`),
  signupByLink: (base: string, link: string, input: SetupInput) => call<SignupReply>(base, `/api/links/${encodeURIComponent(link)}/signup`, { method: "POST", body: input }),
};

/** The API as someone logged in: sharing. */
export function signedInApi(base: string, token: string) {
  const at = <T>(path: string, o: Omit<Call, "token"> = {}) => call<T>(base, path, { ...o, token });
  return {
    people: () => at<Person[]>("/api/people"),
    shareState: (id: string) => at<ShareState>(`/api/objects/${id}/share`),
    share: (id: string, input: ShareInput) => at<ShareReply>(`/api/objects/${id}/share`, { method: "POST", body: input }),
    revoke: (id: string, inviteId: string) => at<void>(`/api/objects/${id}/share/${encodeURIComponent(inviteId)}`, { method: "DELETE" }),
    setRole: (id: string, userId: number, role: ShareRole) => at<void>(`/api/objects/${id}/members/${userId}`, { method: "PATCH", body: { role } }),
    removeMember: (id: string, userId: number) => at<void>(`/api/objects/${id}/members/${userId}`, { method: "DELETE" }),
    deleteObject: (id: string) => at<void>(`/api/objects/${id}`, { method: "DELETE" }),
    acceptLink: (link: string) => at<AcceptReply>(`/api/links/${encodeURIComponent(link)}/accept`, { method: "POST" }),
    acceptInvitation: (id: string) => at<AcceptReply>(`/api/invitations/${id}/accept`, { method: "POST" }),
    declineInvitation: (id: string) => at<void>(`/api/invitations/${id}/decline`, { method: "POST" }),
    transcribe: (id: string, hash?: string) => at<void>(`/api/objects/${id}/transcribe`, { method: "POST", body: hash ? { hash } : {} }),
    transcriber: () => at<TranscriberInfo>("/api/transcriber"),
    ocr: (id: string) => at<void>(`/api/objects/${id}/ocr`, { method: "POST" }),
    refreshCalendar: (id: string) => at<{ events: number }>(`/api/objects/${id}/refresh`, { method: "POST" }),
    calendarFeed: (fresh = false) => at<{ url: string }>("/api/calendar-feed", { method: fresh ? "POST" : "GET" }),
    importRecipe: (id: string) => at<{ from: "page" | "worker" }>(`/api/objects/${id}/import`, { method: "POST" }),
    pushConfig: () => at<PushConfig>("/api/push/config"),
    registerPush: (token: string, lang: string) => at<void>("/api/push/devices", { method: "POST", body: { token, platform: "android", lang } }),
    pushPrefs: () => at<PushPrefs>("/api/push/prefs"),
    setPushPrefs: (p: PushPrefs) => at<PushPrefs>("/api/push/prefs", { method: "PUT", body: p }),
    pushTest: () => at<{ sent: number }>("/api/push/test", { method: "POST" }),
    adminPush: () => at<AdminPush>("/api/admin/push"),
    setAdminPush: (googleServices: string, serviceAccount: string) => at<AdminPush>("/api/admin/push", { method: "PUT", body: { googleServices, serviceAccount } }),
    removeAdminPush: () => at<void>("/api/admin/push", { method: "DELETE" }),
    androidRelease: () => at<(Partial<AppRelease> & { versionName: string; versionCode: number; url: string }) | null>("/api/app/android"),
    mailReady: () => at<{ ready: boolean }>("/api/mail"),
    adminMail: () => at<AdminMail>("/api/admin/mail"),
    setAdminMail: (m: MailSettingsInput) => at<AdminMail>("/api/admin/mail", { method: "PUT", body: m }),
    testMail: (to: string, lang: string) => at<{ sent: boolean; error?: string }>(`/api/admin/mail/test?lang=${lang}`, { method: "POST", body: { to } }),
    desktopRelease: () => at<AppRelease | null>("/api/app/desktop"),
    serverInfo: () => at<ServerInfo>("/api/server"),
    setHousehold: (patch: unknown) => at<Household>("/api/admin/household", { method: "PUT", body: patch }),
    adminUsers: () => at<AdminUser[]>("/api/admin/users"),
    addUser: (u: { username: string; displayName: string; password: string; role: Role }) => at<AdminUser>("/api/admin/users", { method: "POST", body: u }),
    changeUser: (id: number, change: { displayName?: string; role?: Role }) => at<AdminUser>(`/api/admin/users/${id}`, { method: "PATCH", body: change }),
    setUserPassword: (id: number, password: string) => at<AdminUser>(`/api/admin/users/${id}/password`, { method: "POST", body: { password } }),
    logOutUser: (id: number) => at<AdminUser>(`/api/admin/users/${id}/logout`, { method: "POST" }),
    removalOf: (id: number) => at<Removal>(`/api/admin/users/${id}/removal`),
    removeUser: (id: number) => at<Removal>(`/api/admin/users/${id}`, { method: "DELETE" }),
    sendSplit: (id: string, lang: string, to?: string[]) => at<{ results: { id: string; sent: boolean; error?: string }[] }>(`/api/objects/${id}/send`, { method: "POST", body: { lang, ...(to ? { to } : {}) } }),
  };
}
export type SignedInApi = ReturnType<typeof signedInApi>;

/** An account, as the admin page shows it (decision 14). */
export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  createdAt: number;
  /** when one of their devices last asked anything, or null */
  lastSeen: number | null;
  /** devices logged in */
  devices: number;
  /** things that are theirs */
  owns: number;
}

/** What removing someone does to their things: handed over to someone they're shared with, or deleted. */
export interface Removal {
  handedOver: number;
  deleted: number;
}

/** What the phone needs to start Firebase (the public half of google-services.json), if push is set up. */
export interface PushConfig {
  enabled: boolean;
  android: { appId: string; apiKey: string; projectId: string; senderId: string } | null;
}
export type PushKind = "invitation" | "transcribed" | "scanned";
export interface PushPrefs {
  kinds: Record<PushKind, boolean>;
  quietFrom: string;
  quietTo: string;
}
export interface AdminPush {
  configured: boolean;
  projectId: string;
  clientEmail: string;
  devices?: number;
}

export type MailSecurity = "tls" | "starttls" | "none";
/** The admin's mail dialog: the SMTP server, never its password (hasPass says there is one). */
export interface AdminMail {
  ready: boolean;
  source: "admin" | "env" | null;
  settings: { host: string; port: number; security: MailSecurity; user: string; from: string; fromName: string; hasPass: boolean } | null;
  lastFailure: { at: number; to: string; error: string } | null;
}
/** pass: null keeps the saved one; host "" turns mail off */
export interface MailSettingsInput {
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  pass: string | null;
  from: string;
  fromName: string;
}

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
