import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { initList, newObjectId, objectDocName, type ShareReply } from "@noterat/core";
import { inQuietHours, readGoogleServices } from "../src/push";
import { account, call, device, startServer, synced, until } from "./helpers";

/**
 * Push (decision 12): an admin pastes the Firebase project's two files, a phone registers its token,
 * and an invitation becomes a message to Firebase, signed by the server itself, saying only who shared
 * what kind of thing. Google is played by a fake that checks the signature.
 */

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "hemmet-123",
  client_email: "push@hemmet-123.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://oauth2.googleapis.com/token",
});
const GOOGLE_SERVICES = JSON.stringify({
  project_info: { project_number: "987654321", project_id: "hemmet-123" },
  client: [
    { client_info: { mobilesdk_app_id: "1:987654321:android:other", android_client_info: { package_name: "se.example.other" } }, api_key: [{ current_key: "AIzaOther" }] },
    { client_info: { mobilesdk_app_id: "1:987654321:android:abc", android_client_info: { package_name: "io.github.svennefenne.noterat" } }, api_key: [{ current_key: "AIzaNoterat" }] },
  ],
});

function fakeGoogle() {
  const sent: { token: string; body: string; url: string }[] = [];
  const gone = new Set<string>();
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const jwt = new URLSearchParams(String(init?.body)).get("assertion") ?? "";
      const [h, p, sig] = jwt.split(".");
      const ok = crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, sig!, "base64url");
      const claims = JSON.parse(Buffer.from(p!, "base64url").toString()) as { scope: string };
      if (!ok || claims.scope !== "https://www.googleapis.com/auth/firebase.messaging") return Response.json({ error: "invalid_grant", error_description: "bad" }, { status: 400 });
      return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (url === "https://fcm.googleapis.com/v1/projects/hemmet-123/messages:send") {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ya29.test");
      const m = (JSON.parse(String(init?.body)) as { message: { token: string; notification: { body: string }; data: { url: string } } }).message;
      if (gone.has(m.token)) return Response.json({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 });
      sent.push({ token: m.token, body: m.notification.body, url: m.data.url });
      return Response.json({ name: "projects/hemmet-123/messages/1" });
    }
    return new Response("not here", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch: fake, sent, gone };
}

describe("push", () => {
  it("reads the app's part of google-services.json", () => {
    expect(readGoogleServices(GOOGLE_SERVICES)).toEqual({ appId: "1:987654321:android:abc", apiKey: "AIzaNoterat", projectId: "hemmet-123", senderId: "987654321" });
  });

  it("knows quiet hours, across midnight too", () => {
    const at = (hm: string) => new Date(`2026-11-15T${hm}:00`);
    expect(inQuietHours({ quietFrom: "22:00", quietTo: "07:00" }, at("23:30"))).toBe(true);
    expect(inQuietHours({ quietFrom: "22:00", quietTo: "07:00" }, at("06:59"))).toBe(true);
    expect(inQuietHours({ quietFrom: "22:00", quietTo: "07:00" }, at("07:00"))).toBe(false);
    expect(inQuietHours({ quietFrom: "12:00", quietTo: "13:00" }, at("12:30"))).toBe(true);
    expect(inQuietHours({ quietFrom: "", quietTo: "" }, at("12:30"))).toBe(false);
  });

  it("is set up by an admin, and an invitation reaches the other person's phone", async () => {
    const google = fakeGoogle();
    const { db, base } = await startServer({ pushFetch: google.fetch });
    const ada = await account(db, "ada");
    const bo = await account(db, "bo");
    db.prepare("update users set role = 'admin' where id = ?").run(ada.user.id);

    // (not configured: the phone doesn't start Firebase)
    expect((await call<{ enabled: boolean }>(base, "GET", "/api/push/config", bo.token)).json.enabled).toBe(false);
    expect((await call(base, "PUT", "/api/admin/push", bo.token, { googleServices: GOOGLE_SERVICES, serviceAccount: SERVICE_ACCOUNT })).status).toBe(403);
    expect((await call<{ error: string }>(base, "PUT", "/api/admin/push", ada.token, { googleServices: GOOGLE_SERVICES, serviceAccount: SERVICE_ACCOUNT.replace("hemmet-123", "annat-1") })).json.error).toBe("push_project_mismatch");
    const set = await call<{ configured: boolean; clientEmail: string }>(base, "PUT", "/api/admin/push", ada.token, { googleServices: GOOGLE_SERVICES, serviceAccount: SERVICE_ACCOUNT });
    expect(set.json).toMatchObject({ configured: true, clientEmail: "push@hemmet-123.iam.gserviceaccount.com" });
    const config = await call<{ enabled: boolean; android: unknown }>(base, "GET", "/api/push/config", bo.token);
    expect(config.json).toEqual({ enabled: true, android: { appId: "1:987654321:android:abc", apiKey: "AIzaNoterat", projectId: "hemmet-123", senderId: "987654321" } });
    // (the private key never leaves the server)
    expect(JSON.stringify((await call(base, "GET", "/api/admin/push", ada.token)).json)).not.toContain("PRIVATE KEY");

    expect((await call(base, "POST", "/api/push/devices", bo.token, { token: "bo-phone", platform: "android", lang: "sv" })).status).toBe(204);
    const id = newObjectId();
    const list = device(base, ada.token)(objectDocName("list", id));
    initList(list.doc, { title: "Inköp", columns: [{ name: "Vara", type: "text" as const }], by: ada.user.id });
    await synced(list.provider);
    await call<ShareReply>(base, "POST", `/api/objects/${id}/share`, ada.token, { role: "editor", userId: bo.user.id });
    await until(() => google.sent.length === 1, "the push to Bo's phone");
    expect(google.sent[0]).toEqual({ token: "bo-phone", body: "Ada delade en lista med dig.", url: "/" });
    // (nothing private: not the list's name)
    expect(google.sent[0]!.body).not.toContain("Inköp");

    // Bo turns invitations off: nothing more is sent
    await call(base, "PUT", "/api/push/prefs", bo.token, { kinds: { invitation: false }, quietFrom: "", quietTo: "" });
    const other = newObjectId();
    const note = device(base, ada.token)(objectDocName("list", other));
    initList(note.doc, { title: "Packlista", columns: [{ name: "Vara", type: "text" as const }], by: ada.user.id });
    await synced(note.provider);
    await call(base, "POST", `/api/objects/${other}/share`, ada.token, { role: "viewer", userId: bo.user.id });
    await new Promise((r) => setTimeout(r, 200));
    expect(google.sent).toHaveLength(1);

    // a phone Firebase no longer knows is forgotten; logging out forgets the phone too
    google.gone.add("bo-phone");
    expect((await call<{ sent: number }>(base, "POST", "/api/push/test", bo.token)).json.sent).toBe(0);
    expect(db.prepare("select count(*) as n from push_devices").get()).toEqual({ n: 0 });
    await call(base, "POST", "/api/push/devices", ada.token, { token: "ada-phone" });
    await call(base, "POST", "/api/logout", ada.token);
    expect(db.prepare("select count(*) as n from push_devices").get()).toEqual({ n: 0 });
  });
});

describe("the Android app's updates", () => {
  it("offers the newest APK put in the app folder, and serves it without a session", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { base, dataDir } = await startServer();
    expect((await call(base, "GET", "/api/app/android")).json).toBeNull();
    fs.mkdirSync(path.join(dataDir, "app"));
    fs.writeFileSync(path.join(dataDir, "app", "noterat-android-0.1.0-21.apk"), "old");
    fs.writeFileSync(path.join(dataDir, "app", "noterat-android-0.1.0-23.apk"), "newer");
    fs.writeFileSync(path.join(dataDir, "app", "notes.txt"), "not an apk");
    expect((await call(base, "GET", "/api/app/android")).json).toEqual({ versionName: "0.1.0", versionCode: 23, url: "/app/noterat.apk", size: 5 });
    const res = await fetch(`${base}/app/noterat.apk`);
    expect(res.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(res.headers.get("content-disposition")).toContain("noterat-android-0.1.0-23.apk");
    expect(await res.text()).toBe("newer");
  });
});
