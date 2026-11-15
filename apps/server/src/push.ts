import crypto from "node:crypto";
import type { Hono } from "hono";
import type { Notice, ObjectType } from "@noterat/core";
import type { DB } from "./db";
import { Fail, readBody, signedIn, text, type Env } from "./http";

/**
 * Push notifications through Firebase Cloud Messaging (decision 12). The Firebase project is the
 * household's own: an admin pastes its two files into the app, and nothing about it is built into the
 * APK. The phone gets the public half (google-services.json: the app id, API key, project and sender)
 * from the server and starts Firebase with it; the server keeps the private half (a service account's
 * key) and signs its own OAuth token with it, so no Google library is needed.
 *
 * What's sent says that something happened, never what's in it: "Ada shared a list with you", "your
 * voice memo has been transcribed". Each person picks which kinds they want, and quiet hours. The same
 * notices go to their desktop apps that are running, over the sync connection (no Firebase needed).
 */

export const PUSH_KINDS = ["invitation", "transcribed", "scanned"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

export interface PushPrefs {
  kinds: Record<PushKind, boolean>;
  /** "22:00"–"07:00": nothing is pushed then (the app still shows it); "" = no quiet hours */
  quietFrom: string;
  quietTo: string;
}

const DEFAULT_PREFS: PushPrefs = { kinds: { invitation: true, transcribed: true, scanned: false }, quietFrom: "", quietTo: "" };

/** What the phone needs to start Firebase: the public half of google-services.json. */
export interface FirebaseClient {
  appId: string;
  apiKey: string;
  projectId: string;
  senderId: string;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

const PACKAGE = "io.github.svennefenne.noterat";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** google-services.json → what the phone needs (the client for this app's package, else the first). */
export function readGoogleServices(json: string): FirebaseClient {
  let g: {
    project_info?: { project_id?: unknown; project_number?: unknown };
    client?: { client_info?: { mobilesdk_app_id?: unknown; android_client_info?: { package_name?: unknown } }; api_key?: { current_key?: unknown }[] }[];
  };
  try {
    g = JSON.parse(json) as typeof g;
  } catch {
    throw new Fail("push_bad_google_services", 400);
  }
  const clients = Array.isArray(g.client) ? g.client : [];
  const client = clients.find((c) => c.client_info?.android_client_info?.package_name === PACKAGE) ?? clients[0];
  const out = {
    appId: text(client?.client_info?.mobilesdk_app_id),
    apiKey: text(client?.api_key?.[0]?.current_key),
    projectId: text(g.project_info?.project_id),
    senderId: String(g.project_info?.project_number ?? ""),
  };
  if (!out.appId || !out.apiKey || !out.projectId || !/^\d+$/.test(out.senderId)) throw new Fail("push_bad_google_services", 400);
  return out;
}

export function readServiceAccount(json: string): ServiceAccount {
  let s: Record<string, unknown>;
  try {
    s = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Fail("push_bad_service_account", 400);
  }
  const out = { project_id: text(s.project_id), client_email: text(s.client_email), private_key: text(s.private_key), token_uri: text(s.token_uri) || "https://oauth2.googleapis.com/token" };
  if (s.type !== "service_account" || !out.project_id || !out.client_email || !out.private_key.includes("PRIVATE KEY")) throw new Fail("push_bad_service_account", 400);
  return out;
}

const b64url = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** A signed JWT asking Google for an access token to send messages (RFC 7523). */
export function serviceJwt(sa: ServiceAccount, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat, exp: iat + 3600 })}`;
  return `${body}.${crypto.createSign("RSA-SHA256").update(body).sign(sa.private_key, "base64url")}`;
}

/** "22:00".."07:00" around midnight, or "12:00".."13:00" within a day. */
export function inQuietHours(p: Pick<PushPrefs, "quietFrom" | "quietTo">, now: Date): boolean {
  if (!/^\d\d:\d\d$/.test(p.quietFrom) || !/^\d\d:\d\d$/.test(p.quietTo) || p.quietFrom === p.quietTo) return false;
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return p.quietFrom < p.quietTo ? hm >= p.quietFrom && hm < p.quietTo : hm >= p.quietFrom || hm < p.quietTo;
}

const TEXTS = {
  sv: {
    invitation: (v: Record<string, string>) => `${v.from} delade ${v.what} med dig.`,
    transcribed: () => "Röstmemot är omskrivet till text.",
    scanned: () => "Dokumentet är inläst och sökbart.",
    test: () => "Push fungerar.",
    things: { list: "en lista", note: "en anteckning", memo: "ett röstmemo", journal: "en dagbokssida", scan: "ett dokument", recipe: "ett recept", calendar: "en kalender", budget: "en budget", split: "en kostnadsdelning" } as Record<string, string>,
  },
  en: {
    invitation: (v: Record<string, string>) => `${v.from} shared ${v.what} with you.`,
    transcribed: () => "Your voice memo has been turned into text.",
    scanned: () => "The document has been read and is searchable.",
    test: () => "Push works.",
    things: { list: "a list", note: "a note", memo: "a voice memo", journal: "a journal page", scan: "a document", recipe: "a recipe", calendar: "a calendar", budget: "a budget", split: "a cost split" } as Record<string, string>,
  },
};

export interface PushOptions {
  db: DB;
  /** the notice to someone's running desktop apps (sync.ts): how many it went to */
  notice?: (userId: number, notice: Notice) => number;
  /** for tests: Google's endpoints */
  fetch?: typeof fetch;
  now?: () => Date;
}

export type Push = ReturnType<typeof pushRoutes>;

export function pushRoutes(app: Hono<Env>, o: PushOptions) {
  const { db } = o;
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? (() => new Date());
  const auth = signedIn(db);
  let token: { value: string; until: number; email: string } | null = null;

  const setting = (key: string) => (db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined)?.value ?? "";
  const setSetting = (key: string, value: string) => db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  const client = (): FirebaseClient | null => (setting("push.google_services") ? readGoogleServices(setting("push.google_services")) : null);
  const account = (): ServiceAccount | null => (setting("push.service_account") ? readServiceAccount(setting("push.service_account")) : null);

  function prefsOf(userId: number): PushPrefs {
    const row = db.prepare("select prefs from push_prefs where user_id = ?").get(userId) as { prefs: string } | undefined;
    if (!row) return DEFAULT_PREFS;
    try {
      const p = JSON.parse(row.prefs) as Partial<PushPrefs>;
      return { kinds: { ...DEFAULT_PREFS.kinds, ...p.kinds }, quietFrom: text(p.quietFrom), quietTo: text(p.quietTo) };
    } catch {
      return DEFAULT_PREFS;
    }
  }

  async function accessToken(sa: ServiceAccount): Promise<string> {
    if (token && token.email === sa.client_email && token.until > Date.now() + 60_000) return token.value;
    const res = await doFetch(sa.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceJwt(sa) }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !j.access_token) throw new Error(`Google said no to the service account: ${j.error_description ?? res.status}`);
    token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000, email: sa.client_email };
    return token.value;
  }

  /** One message to one device; a device Firebase no longer knows is forgotten. */
  async function sendTo(sa: ServiceAccount, device: string, msg: { title: string; body: string; url: string }) {
    const res = await doFetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken(sa)}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token: device,
          notification: { title: msg.title, body: msg.body },
          data: { url: msg.url },
          android: { priority: "HIGH", notification: { channel_id: "noterat", icon: "ic_stat_noterat", color: "#2f5d50" } },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return true;
    const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } };
    const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status ?? "";
    if (res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") db.prepare("delete from push_devices where token = ?").run(device);
    else console.warn(`push: FCM answered ${res.status} ${code}`);
    return false;
  }

  /**
   * Tell someone something happened, on each of their devices, if they want that kind and it isn't
   * their quiet hours. Never throws: a push that doesn't go is not a reason for anything else to fail.
   */
  async function notify(userId: number, kind: PushKind | "test", vars: Record<string, string> = {}, url = "/"): Promise<number> {
    try {
      if (kind !== "test") {
        const prefs = prefsOf(userId);
        if (!prefs.kinds[kind] || inQuietHours(prefs, now())) return 0;
      }
      let sent = o.notice?.(userId, { notice: kind, url, ...(vars.from ? { from: vars.from } : {}), ...(vars.type ? { type: vars.type as ObjectType } : {}) }) ?? 0;
      const sa = account();
      if (!sa) return sent;
      const devices = db.prepare("select token, lang from push_devices where user_id = ?").all(userId) as { token: string; lang: string }[];
      for (const d of devices) {
        const t = d.lang === "en" ? TEXTS.en : TEXTS.sv;
        const body = t[kind]({ ...vars, what: t.things[vars.type ?? ""] ?? vars.type ?? "" });
        if (await sendTo(sa, d.token, { title: "Noterat", body, url })) sent++;
      }
      return sent;
    } catch (e) {
      console.warn(`push: ${(e as Error).message}`);
      return 0;
    }
  }

  // ───────────── the app ─────────────

  /** What the phone needs to start Firebase, if push is set up. */
  app.get("/api/push/config", auth, (c) => {
    const fb = account() ? client() : null;
    return c.json({ enabled: !!fb, android: fb });
  });

  /** This device's FCM token, tied to this session (logging out forgets it). */
  app.post("/api/push/devices", auth, async (c) => {
    const body = await readBody(c);
    const device = text(body.token).trim();
    if (!device || device.length > 4096) throw new Fail("bad_request", 400);
    const t = Date.now();
    db.prepare(
      `insert into push_devices (token, user_id, session_id, platform, lang, created_at, seen_at) values (?, ?, ?, ?, ?, ?, ?)
       on conflict(token) do update set user_id = excluded.user_id, session_id = excluded.session_id, lang = excluded.lang, seen_at = excluded.seen_at`,
    ).run(device, c.get("user").id, c.get("sessionId"), text(body.platform) || "android", text(body.lang) === "en" ? "en" : "sv", t, t);
    return c.body(null, 204);
  });

  app.delete("/api/push/devices/:token", auth, (c) => {
    db.prepare("delete from push_devices where token = ? and user_id = ?").run(c.req.param("token"), c.get("user").id);
    return c.body(null, 204);
  });

  app.get("/api/push/prefs", auth, (c) => c.json(prefsOf(c.get("user").id)));

  app.put("/api/push/prefs", auth, async (c) => {
    const body = await readBody(c);
    const kinds = (body.kinds ?? {}) as Record<string, unknown>;
    const p: PushPrefs = {
      kinds: Object.fromEntries(PUSH_KINDS.map((k) => [k, kinds[k] === undefined ? DEFAULT_PREFS.kinds[k] : kinds[k] === true])) as PushPrefs["kinds"],
      quietFrom: /^\d\d:\d\d$/.test(text(body.quietFrom)) ? text(body.quietFrom) : "",
      quietTo: /^\d\d:\d\d$/.test(text(body.quietTo)) ? text(body.quietTo) : "",
    };
    db.prepare("insert into push_prefs (user_id, prefs) values (?, ?) on conflict(user_id) do update set prefs = excluded.prefs").run(c.get("user").id, JSON.stringify(p));
    return c.json(p);
  });

  /** A test push to my own devices, phones and running desktop apps (to see that it works). */
  app.post("/api/push/test", auth, async (c) => c.json({ sent: await notify(c.get("user").id, "test") }));

  // ───────────── the admin ─────────────

  const admin = (u: { role: string }) => {
    if (u.role !== "admin") throw new Fail("forbidden", 403);
  };

  app.get("/api/admin/push", auth, (c) => {
    admin(c.get("user"));
    const fb = client();
    const sa = account();
    return c.json({ configured: !!(fb && sa), projectId: fb?.projectId ?? sa?.project_id ?? "", clientEmail: sa?.client_email ?? "", devices: (db.prepare("select count(*) as n from push_devices").get() as { n: number }).n });
  });

  /** The Firebase project's two files, checked (and the key tried against Google) before they're kept. */
  app.put("/api/admin/push", auth, async (c) => {
    admin(c.get("user"));
    const body = await readBody(c);
    const fb = readGoogleServices(text(body.googleServices));
    const sa = readServiceAccount(text(body.serviceAccount));
    if (fb.projectId !== sa.project_id) throw new Fail("push_project_mismatch", 400);
    try {
      token = null;
      await accessToken(sa);
    } catch {
      throw new Fail("push_key_refused", 400);
    }
    setSetting("push.google_services", text(body.googleServices));
    setSetting("push.service_account", text(body.serviceAccount));
    return c.json({ configured: true, projectId: fb.projectId, clientEmail: sa.client_email });
  });

  app.delete("/api/admin/push", auth, (c) => {
    admin(c.get("user"));
    db.prepare("delete from settings where key in ('push.google_services', 'push.service_account')").run();
    db.prepare("delete from push_devices").run();
    token = null;
    return c.body(null, 204);
  });

  return { notify };
}
