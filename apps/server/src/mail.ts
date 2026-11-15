import type { Hono } from "hono";
import nodemailer from "nodemailer";
import { validEmail } from "@noterat/core";
import type { DB } from "./db";
import { Fail, readBody, requireAdmin, signedIn, text, type Env } from "./http";

/**
 * Sending mail (decision 13): the cost split's summaries, with their PDFs. Through the household's own SMTP
 * server, as Hooden and Deckforce do it: the one an admin sets under the account menu → Mail, or else the
 * SMTP_* environment variables on the container. With neither there's no mail, and the app says so.
 *
 * The settings, the password with them, live in the settings table and never leave the server: the admin
 * dialog gets everything but the password.
 */

export type MailSecurity = "tls" | "starttls" | "none";

export interface MailSettings {
  host: string;
  port: number;
  /** tls: encrypted from the start (usually 465); starttls: upgraded after connecting (587); none: plain (25, a local relay) */
  security: MailSecurity;
  user: string;
  pass: string;
  /** the sender's address (with Gmail: the Gmail address itself) */
  from: string;
  /** the sender's name in the inbox ("" → Noterat) */
  fromName: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** who an answer goes to (the person who sent it out) */
  replyTo?: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
}

export interface MailFailure {
  at: number;
  to: string;
  error: string;
}

/** For tests: the message as nodemailer would send it, instead of an SMTP server. */
export type MailTransport = (settings: MailSettings, message: nodemailer.SendMailOptions) => Promise<void>;

const KEY = "mail.smtp";
const FAIL_KEY = "mail.lastError";

const securityOf = (s: string, port: number): MailSecurity =>
  s === "tls" || s === "true" ? "tls" : s === "none" || s === "false" ? "none" : s === "starttls" ? "starttls" : port === 465 ? "tls" : "starttls";

function envSettings(env: NodeJS.ProcessEnv): MailSettings | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const sec = (env.SMTP_SECURE ?? "").toLowerCase();
  const port = Number(env.SMTP_PORT) || (sec === "tls" || sec === "true" ? 465 : sec === "none" || sec === "false" ? 25 : 587);
  return { host, port, security: securityOf(sec, port), user: env.SMTP_USER ?? "", pass: env.SMTP_PASS ?? "", from: env.SMTP_FROM || env.SMTP_USER || "", fromName: env.SMTP_FROM_NAME || "" };
}

export type Mailer = ReturnType<typeof createMailer>;

export function createMailer(db: DB, o: { transport?: MailTransport; env?: NodeJS.ProcessEnv } = {}) {
  const get = (key: string) => (db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined)?.value ?? null;
  const set = (key: string, value: string) => db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);

  const saved = (): MailSettings | null => {
    try {
      const s = JSON.parse(get(KEY) || "null") as MailSettings | null;
      return s?.host ? s : null;
    } catch {
      return null;
    }
  };

  function settings(): { settings: MailSettings | null; source: "admin" | "env" | null } {
    const a = saved();
    if (a) return { settings: a, source: "admin" };
    const e = envSettings(o.env ?? process.env);
    return e ? { settings: e, source: "env" } : { settings: null, source: null };
  }

  const ready = () => {
    const s = settings().settings;
    return !!s?.host && validEmail(s.from);
  };

  /** Saved from the admin dialog: an empty password keeps the saved one; an empty server turns mail off (back to SMTP_* if set). */
  function save(next: Omit<MailSettings, "pass"> & { pass: string | null }) {
    if (!next.host) {
      db.prepare("delete from settings where key = ?").run(KEY);
      return;
    }
    const pass = next.pass === null ? (saved()?.pass ?? "") : next.pass;
    set(KEY, JSON.stringify({ ...next, pass } satisfies MailSettings));
  }

  const lastFailure = (): MailFailure | null => {
    try {
      return JSON.parse(get(FAIL_KEY) || "null") as MailFailure | null;
    } catch {
      return null;
    }
  };

  const smtp: MailTransport = async (s, message) => {
    await nodemailer
      .createTransport({
        host: s.host,
        port: s.port,
        secure: s.security === "tls",
        requireTLS: s.security === "starttls",
        ignoreTLS: s.security === "none",
        auth: s.user ? { user: s.user, pass: s.pass } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      })
      .sendMail(message);
  };

  /** Send one mail; throws with the server's reason when it can't (and keeps it for the admin dialog). */
  async function send(mail: Mail, use = settings().settings): Promise<void> {
    if (!use) throw new Fail("mail_off", 409);
    try {
      await (o.transport ?? smtp)(use, {
        from: { name: use.fromName || "Noterat", address: use.from },
        to: mail.to,
        replyTo: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
      });
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      console.warn(`mail: to ${mail.to}: ${error}`);
      set(FAIL_KEY, JSON.stringify({ at: Date.now(), to: mail.to, error } satisfies MailFailure));
      throw e;
    }
  }

  return { settings, ready, save, lastFailure, send };
}

/** The admin's mail dialog, and whether there's mail at all (for the app's "send out"). */
export function mailRoutes(app: Hono<Env>, o: { db: DB; mail: Mailer }) {
  const auth = signedIn(o.db);
  const view = () => {
    const { settings: s, source } = o.mail.settings();
    return {
      ready: o.mail.ready(),
      source,
      settings: s ? { host: s.host, port: s.port, security: s.security, user: s.user, from: s.from, fromName: s.fromName, hasPass: !!s.pass } : null,
      lastFailure: o.mail.lastFailure(),
    };
  };

  app.get("/api/mail", auth, (c) => c.json({ ready: o.mail.ready() }));

  app.get("/api/admin/mail", auth, (c) => {
    requireAdmin(c.get("user"));
    return c.json(view());
  });

  app.put("/api/admin/mail", auth, async (c) => {
    requireAdmin(c.get("user"));
    const b = await readBody(c);
    const host = text(b.host).trim();
    const port = Number(b.port);
    const security = text(b.security);
    const from = text(b.from).trim().toLowerCase();
    if (host && (!/^[a-z0-9.-]{1,253}$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !["tls", "starttls", "none"].includes(security) || !validEmail(from)))
      throw new Fail("mail_bad_settings", 400);
    o.mail.save({
      host,
      port,
      security: security as MailSecurity,
      user: text(b.user).trim().slice(0, 254),
      pass: typeof b.pass === "string" ? b.pass.slice(0, 500) : null,
      from,
      fromName: text(b.fromName).trim().slice(0, 80),
    });
    return c.json(view());
  });

  /** A test mail to the address given: { sent } or { sent: false, error } with the server's own words. */
  app.post("/api/admin/mail/test", auth, async (c) => {
    requireAdmin(c.get("user"));
    const to = text((await readBody(c)).to).trim().toLowerCase();
    if (!validEmail(to)) throw new Fail("mail_bad_address", 400);
    if (!o.mail.ready()) throw new Fail("mail_off", 409);
    const sv = text(c.req.query("lang")) !== "en";
    try {
      await o.mail.send({
        to,
        subject: sv ? "Noterat kan skicka e-post" : "Noterat can send mail",
        text: sv ? "Det här är ett testmail från Noterat. Det fungerar." : "This is a test mail from Noterat. It works.",
        html: sv ? "<p>Det här är ett testmail från Noterat. Det fungerar.</p>" : "<p>This is a test mail from Noterat. It works.</p>",
      });
      return c.json({ sent: true });
    } catch (e) {
      return c.json({ sent: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    }
  });
}
