import type { Hono } from "hono";
import { logSend, readSplit, validEmail } from "@noterat/core";
import { splitMail, splitPdf } from "@noterat/core/letter";
import type { DB } from "./db";
import { Fail, readBody, signedIn, type Env } from "./http";
import type { Mailer } from "./mail";
import { objectRow, roleOf } from "./objects";
import type { Sync } from "./sync";

/**
 * Sending a cost split's summary out (decision 13): each person with an e-mail address gets their own
 * mail, saying what they pay (with a Swish link) or get back, and the PDF with everything. Read from the
 * server's copy of the document, which the app makes sure is up to date before it asks. Anyone who may
 * change the split may send it; the mail says who did, and an answer goes to them.
 */
export function splitRoutes(app: Hono<Env>, o: { db: DB; sync: Sync; mail: Mailer }) {
  const auth = signedIn(o.db);

  app.post("/api/objects/:id/send", auth, async (c) => {
    const me = c.get("user");
    const obj = objectRow(o.db, c.req.param("id"));
    if (!obj) throw new Fail("not_synced", 404);
    if (obj.deleted_at) throw new Fail("not_found", 404);
    const role = roleOf(o.db, obj.id, me.id);
    if (!role) throw new Fail("forbidden", 403);
    if (obj.type !== "split") throw new Fail("wrong_type", 400);
    if (role === "viewer") throw new Fail("forbidden", 403);
    if (!o.mail.ready()) throw new Fail("mail_off", 409);

    const body = await readBody(c);
    const lang = body.lang === "en" ? "en" : "sv";
    const only = Array.isArray(body.to) ? new Set(body.to.filter((x): x is string => typeof x === "string").slice(0, 100)) : null;
    const v = await o.sync.readObject("split", obj.id, readSplit);
    const to = v.people.filter((p) => (!only || only.has(p.id)) && validEmail(p.email)).slice(0, 50);
    if (to.length === 0) throw new Fail("split_nobody", 400);

    const by = me.displayName;
    const replyTo = v.people.find((p) => p.userId === me.id && validEmail(p.email))?.email;
    const results: { id: string; sent: boolean; error?: string }[] = [];
    for (const p of to) {
      const m = splitMail(v, p.id, { lang, by });
      try {
        const pdf = await splitPdf(v, p.id, { lang, by });
        await o.mail.send({ to: p.email, subject: m.subject, text: m.text, html: m.html, replyTo, attachments: [{ filename: m.filename, content: pdf, contentType: "application/pdf" }] });
        results.push({ id: p.id, sent: true });
      } catch (e) {
        results.push({ id: p.id, sent: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      }
    }
    const sent = results.filter((r) => r.sent).map((r) => r.id);
    if (sent.length) await o.sync.changeObject("split", obj.id, (d) => logSend(d, { at: Date.now(), by, to: sent }));
    return c.json({ results });
  });
}
