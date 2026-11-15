import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert, Send } from "lucide-react";
import type { AdminMail, MailSecurity } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/sync-react";
import { Problem } from "../ui";

/** the usual port for each kind of encryption */
const PORTS: Record<MailSecurity, number> = { starttls: 587, tls: 465, none: 25 };

/**
 * The admin's part: the household's own SMTP server, which the cost splits' summaries are mailed through
 * (decision 13). The password is sent once and never shown again; a test mail says whether it works.
 */
export function MailAdminForm({ onDone }: { onDone?: () => void }) {
  const { t, lang, errorText } = useI18n();
  const { api } = useSession();
  const [state, setState] = useState<AdminMail | null>(null);
  const [v, setV] = useState({ host: "", port: "587", security: "starttls" as MailSecurity, user: "", pass: "", from: "", fromName: "" });
  const [to, setTo] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; result: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.adminMail().then((m) => {
      setState(m);
      const s = m.settings;
      if (s && m.source === "admin") setV({ host: s.host, port: String(s.port), security: s.security, user: s.user, pass: "", from: s.from, fromName: s.fromName });
      setTo(s?.from ?? "");
    }, (e: unknown) => setProblem(errorText(e)));
  }, [api, errorText]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      setState(await api.setAdminMail({ ...v, host: v.host.trim(), port: Number(v.port) || PORTS[v.security], pass: v.pass ? v.pass : null }));
      setV((x) => ({ ...x, pass: "" }));
      setTest(null);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTest({ busy: true, result: "", ok: false });
    try {
      const r = await api.testMail(to.trim(), lang);
      setTest({ busy: false, ok: r.sent, result: r.sent ? t("mail.testSent", { to: to.trim() }) : t("mail.testFailed", { error: r.error ?? "" }) });
    } catch (err) {
      setTest({ busy: false, ok: false, result: errorText(err) });
    }
  }

  if (!state) return problem ? <Problem>{problem}</Problem> : <p className="muted">{t("lists.loading")}</p>;
  const s = state.settings;
  return (
    <form onSubmit={save} className="stack mail-form">
      <p className={`mail-status${state.ready ? " on" : ""}`}>
        <span className="mail-lamp" aria-hidden />
        <span>
          <strong>{t(state.ready ? "mail.on" : "mail.off")}</strong>
          <br />
          <span className="muted small-text">
            {state.ready && s
              ? t(state.source === "env" ? "mail.viaEnv" : "mail.via", { host: s.host, from: s.from })
              : t("mail.offHint")}
          </span>
        </span>
      </p>
      {state.lastFailure && (
        <p className="problem small-text">
          <CircleAlert aria-hidden size={16} /> {t("mail.lastFailure", { to: state.lastFailure.to, error: state.lastFailure.error })}
        </p>
      )}
      <p className="muted small-text">{t("mail.gmailHint")}</p>
      <label className="field">
        <span>{t("mail.host")}</span>
        <input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} placeholder="smtp.gmail.com" autoComplete="off" spellCheck={false} />
      </label>
      <div className="pin-fields">
        <label className="field">
          <span>{t("mail.security")}</span>
          <select
            value={v.security}
            onChange={(e) => {
              const security = e.target.value as MailSecurity;
              // (the port follows, unless it was set to something unusual)
              setV({ ...v, security, port: Object.values(PORTS).includes(Number(v.port)) ? String(PORTS[security]) : v.port });
            }}
          >
            <option value="starttls">STARTTLS (587)</option>
            <option value="tls">SSL/TLS (465)</option>
            <option value="none">{t("mail.securityNone")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("mail.port")}</span>
          <input inputMode="numeric" value={v.port} onChange={(e) => setV({ ...v, port: e.target.value.replace(/\D/g, "") })} />
        </label>
      </div>
      <label className="field">
        <span>{t("mail.user")}</span>
        <input value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} autoComplete="off" spellCheck={false} placeholder={t("mail.userNone")} />
      </label>
      <label className="field">
        <span>{t("mail.pass")}</span>
        <input type="password" value={v.pass} onChange={(e) => setV({ ...v, pass: e.target.value })} autoComplete="new-password" placeholder={s?.hasPass && state.source === "admin" ? t("mail.passSaved") : ""} />
      </label>
      <label className="field">
        <span>{t("mail.from")}</span>
          <input type="email" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} placeholder="hemmet@gmail.com" autoComplete="off" spellCheck={false} />
      </label>
      <label className="field">
        <span>{t("mail.fromName")}</span>
        <input value={v.fromName} onChange={(e) => setV({ ...v, fromName: e.target.value })} placeholder="Noterat" />
      </label>
      {problem && <Problem>{problem}</Problem>}
      {state.ready && (
        <div className="mail-test">
          <label className="field">
            <span>{t("mail.testTo")}</span>
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="email" />
          </label>
          <button type="button" className="secondary" disabled={!to.trim() || test?.busy} onClick={() => void sendTest()}>
            <Send aria-hidden size={16} /> {t(test?.busy ? "mail.testing" : "mail.test")}
          </button>
          {test?.result && <p className={test.ok ? "muted small-text" : "problem small-text"}>{test.result}</p>}
        </div>
      )}
      <div className="dialog-actions">
        {onDone && (
          <button type="button" className="secondary" onClick={onDone}>
            {t("budget.done")}
          </button>
        )}
        <button type="submit" className="primary" disabled={busy || (!!v.host.trim() && !v.from.trim())}>
          {t("note.save")}
        </button>
      </div>
    </form>
  );
}
