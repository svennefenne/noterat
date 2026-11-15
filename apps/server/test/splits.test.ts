import { describe, expect, it } from "vitest";
import type { SendMailOptions } from "nodemailer";
import { addExpense, addPerson, initSplit, newObjectId, objectDocName, readSplit } from "@noterat/core";
import type { MailSettings } from "../src/mail";
import type { DB } from "../src/db";
import { account, call, device, startServer, synced, until } from "./helpers";

async function admin(db: DB, username: string) {
  const a = await account(db, username);
  db.prepare("update users set role = 'admin' where id = ?").run(a.user.id);
  return a;
}

/**
 * Mail (decision 13): an admin sets the household's SMTP server, and a cost split's summary goes out to
 * everyone in it with an address, each with their own PDF. The SMTP server is played by a list.
 */

function fakeSmtp() {
  const sent: { settings: MailSettings; message: SendMailOptions }[] = [];
  const refuse = new Set<string>();
  return {
    sent,
    refuse,
    transport: async (settings: MailSettings, message: SendMailOptions) => {
      if (refuse.has(String(message.to))) throw new Error("550 mailbox unavailable");
      sent.push({ settings, message });
    },
  };
}

const SMTP = { host: "smtp.example.com", port: 587, security: "starttls", user: "hemmet@example.com", pass: "app-password-1", from: "hemmet@example.com", fromName: "Hemmet" };

describe("mail", () => {
  it("is set up by an admin, never shows the password again, and sends a test", async () => {
    const smtp = fakeSmtp();
    const { db, base } = await startServer({ mailTransport: smtp.transport });
    const ada = await admin(db, "ada");
    const bo = await account(db, "bo");
    expect((await call<{ ready: boolean }>(base, "GET", "/api/mail", bo.token)).json).toEqual({ ready: false });
    expect((await call(base, "PUT", "/api/admin/mail", bo.token, SMTP)).status).toBe(403);
    expect((await call(base, "PUT", "/api/admin/mail", ada.token, { ...SMTP, from: "not an address" })).json).toEqual({ error: "mail_bad_settings" });

    const saved = await call<{ ready: boolean; settings: Record<string, unknown> }>(base, "PUT", "/api/admin/mail", ada.token, SMTP);
    expect(saved.json.ready).toBe(true);
    expect(saved.json.settings).toMatchObject({ host: "smtp.example.com", hasPass: true });
    expect(JSON.stringify(saved.json)).not.toContain("app-password-1");
    // saved again without a password: the old one is kept
    await call(base, "PUT", "/api/admin/mail", ada.token, { ...SMTP, pass: null, fromName: "Familjen" });
    expect((await call<{ ready: boolean }>(base, "GET", "/api/mail", bo.token)).json).toEqual({ ready: true });

    expect((await call<{ sent: boolean }>(base, "POST", "/api/admin/mail/test", ada.token, { to: "ada@example.com" })).json).toEqual({ sent: true });
    expect(smtp.sent[0]!.settings.pass).toBe("app-password-1");
    expect(smtp.sent[0]!.message).toMatchObject({ to: "ada@example.com", subject: "Noterat kan skicka e-post", from: { name: "Familjen", address: "hemmet@example.com" } });
    // a refusal comes back in the server's own words, and is kept for the dialog
    smtp.refuse.add("nobody@example.com");
    expect((await call(base, "POST", "/api/admin/mail/test", ada.token, { to: "nobody@example.com" })).json).toEqual({ sent: false, error: "550 mailbox unavailable" });
    expect((await call<{ lastFailure: { to: string } }>(base, "GET", "/api/admin/mail", ada.token)).json.lastFailure).toMatchObject({ to: "nobody@example.com" });
  });

  it("can come from the container's SMTP_* settings instead", async () => {
    const { db, base } = await startServer({ mailEnv: { SMTP_HOST: "smtp.gmail.com", SMTP_USER: "hemmet@gmail.com", SMTP_PASS: "x" } });
    const ada = await admin(db, "ada");
    const view = await call<{ ready: boolean; source: string; settings: Record<string, unknown> }>(base, "GET", "/api/admin/mail", ada.token);
    expect(view.json).toMatchObject({ ready: true, source: "env", settings: { host: "smtp.gmail.com", port: 587, security: "starttls", from: "hemmet@gmail.com" } });
  });
});

describe("sending a cost split out", () => {
  it("mails each person with an address their own summary and PDF", async () => {
    const smtp = fakeSmtp();
    const { db, base } = await startServer({ mailTransport: smtp.transport });
    const ada = await admin(db, "ada");
    const bo = await account(db, "bo");
    const id = newObjectId();
    const split = device(base, ada.token)(objectDocName("split", id));
    initSplit(split.doc, { title: "Fjällresan", by: ada.user.id, me: { name: "Ada", phone: "0701112233", email: "ada@example.com" } });
    const me = readSplit(split.doc).people[0]!.id;
    const cilla = addPerson(split.doc, { name: "Cilla Ek", phone: "0701234567", email: "cilla@example.com" });
    const david = addPerson(split.doc, { name: "David Lund" });
    addExpense(split.doc, { date: "2027-02-14", text: "Stugan", amount: 600000, paidBy: me, mode: "equal", parts: { [me]: 1, [cilla]: 1, [david]: 1 } }, ada.user.id);
    await synced(split.provider);

    // no mail server yet
    expect((await call(base, "POST", `/api/objects/${id}/send`, ada.token, { lang: "sv" })).json).toEqual({ error: "mail_off" });
    await call(base, "PUT", "/api/admin/mail", ada.token, SMTP);

    const r = await call<{ results: { id: string; sent: boolean }[] }>(base, "POST", `/api/objects/${id}/send`, ada.token, { lang: "sv" });
    expect(r.json.results).toEqual([
      { id: me, sent: true },
      { id: cilla, sent: true },
    ]);
    const toCilla = smtp.sent.find((m) => m.message.to === "cilla@example.com")!.message;
    expect(toCilla.subject).toBe("Fjällresan: du ska betala 2 000,00 kr");
    expect(toCilla.replyTo).toBe("ada@example.com");
    expect(String(toCilla.text)).toContain("2 000,00 kr till Ada, Swish 070-111 22 33");
    const pdf = (toCilla.attachments as { filename: string; content: Buffer; contentType: string }[])[0]!;
    expect(pdf.filename).toBe("fjallresan-cilla-ek.pdf");
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.content.subarray(0, 5).toString()).toBe("%PDF-");
    // the split remembers it went out, on every device
    await until(() => readSplit(split.doc).sends.length === 1, "the send in the split");
    expect(readSplit(split.doc).sends[0]).toMatchObject({ by: "Ada", to: [me, cilla] });

    // only some, and nobody: an answer
    smtp.sent.length = 0;
    await call(base, "POST", `/api/objects/${id}/send`, ada.token, { lang: "en", to: [cilla] });
    expect(smtp.sent.map((m) => [m.message.to, m.message.subject])).toEqual([["cilla@example.com", "Fjällresan: you pay 2,000.00 kr"]]);
    expect((await call(base, "POST", `/api/objects/${id}/send`, ada.token, { to: [david] })).json).toEqual({ error: "split_nobody" });

    // someone who can only look can't send it; someone without it at all can't either
    db.prepare("insert into members (object_id, user_id, role, added_at) values (?, ?, 'viewer', ?)").run(id, bo.user.id, Date.now());
    expect((await call(base, "POST", `/api/objects/${id}/send`, bo.token, {})).status).toBe(403);
    db.prepare("delete from members where user_id = ?").run(bo.user.id);
    expect((await call(base, "POST", `/api/objects/${id}/send`, bo.token, {})).status).toBe(403);
  });
});
