import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Fingerprint, Lock } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { biometricAvailable, type LockMethod, type LockScope } from "../lib/lock";
import { useLock, useSession } from "../lib/sync-react";
import { Problem } from "../ui";

/**
 * What's behind the lock (decision 7): the journal, or the whole app. Locked, it shows the way in
 * instead: the fingerprint (asked for at once in the app), or the PIN set on this device.
 */
export function LockGate({ what, children, onLogout }: { what: "journal" | "app"; children: ReactNode; onLogout?: () => void }) {
  const { lock } = useSession();
  useLock();
  if (!lock.hides(what)) return <>{children}</>;
  return <LockScreen what={what} onLogout={onLogout} />;
}

function LockScreen({ what, onLogout }: { what: "journal" | "app"; onLogout?: () => void }) {
  const { t } = useI18n();
  const { lock } = useSession();
  const { settings } = useLock();
  const [pin, setPin] = useState("");
  const [problem, setProblem] = useState("");
  const asked = useRef(false);
  const reason = t(what === "app" ? "lock.reasonApp" : "lock.reasonJournal");

  const finger = async () => {
    setProblem("");
    if (!(await lock.unlock(undefined, reason))) setProblem(t("lock.notYou"));
  };

  // (the fingerprint is asked for straight away, once)
  useEffect(() => {
    if (settings.method !== "biometric" || asked.current) return;
    asked.current = true;
    void lock.unlock(undefined, reason);
  }, [settings.method, lock, reason]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await lock.unlock(pin)) return;
    setPin("");
    setProblem(t("lock.wrongPin"));
  }

  return (
    <div className={what === "app" ? "page lock-screen" : "lock-screen"}>
      <div className="card lock-card">
        <Lock aria-hidden size={32} className="lock-icon" />
        <h1>{t(what === "app" ? "lock.appLocked" : "lock.journalLocked")}</h1>
        {settings.method === "biometric" && (
          <button type="button" className="primary" onClick={() => void finger()}>
            <Fingerprint aria-hidden size={20} /> {t("lock.unlock")}
          </button>
        )}
        {settings.pin && (
          <form onSubmit={(e) => void submit(e)} className="stack">
            <label className="field">
              <span>{t("lock.pin")}</span>
              <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} data-autofocus autoFocus />
            </label>
            <button type="submit" className={settings.method === "biometric" ? "secondary" : "primary"} disabled={pin.length < 4}>
              {t("lock.unlock")}
            </button>
          </form>
        )}
        {problem && <Problem>{problem}</Problem>}
        {onLogout && (
          <button type="button" className="link-button small-text" onClick={() => confirm(t("lock.logoutConfirm")) && onLogout()}>
            {t("lock.forgot")}
          </button>
        )}
      </div>
    </div>
  );
}

/** The lock's settings: what it covers, how it opens, and how soon it locks again. */
export function LockSettingsForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { lock } = useSession();
  const { settings } = useLock();
  const [scope, setScope] = useState<LockScope>(settings.scope);
  const [after, setAfter] = useState(settings.after);
  const [bio, setBio] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    void biometricAvailable().then(setBio);
  }, []);

  const method: LockMethod = bio ? "biometric" : "pin";
  // (a PIN is needed without a fingerprint, unless one is already set)
  const needsPin = scope !== "off" && method === "pin" && !settings.pin;

  function save(e: FormEvent) {
    e.preventDefault();
    if (pin || needsPin) {
      if (!/^\d{4,8}$/.test(pin)) return setProblem(t("lock.pinRule"));
      if (pin !== again) return setProblem(t("lock.pinsDiffer"));
    }
    lock.save({ scope, method, after }, pin || undefined);
    onDone();
  }

  return (
    <form onSubmit={save} className="stack">
      <fieldset className="templates">
        <legend>{t("lock.what")}</legend>
        {(["off", "journal", "app"] as const).map((s) => (
          <label key={s} className={scope === s ? "template chosen" : "template"}>
            <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} />
            <span className="template-name">{t(`lock.scope.${s}`)}</span>
          </label>
        ))}
      </fieldset>
      {scope !== "off" && (
        <>
          <p className="muted small-text">{bio === null ? t("lists.loading") : t(bio ? "lock.byFinger" : "lock.byPin")}</p>
          {method === "pin" && (
            <div className="pin-fields">
              <label className="field">
                <span>{t(settings.pin ? "lock.newPin" : "lock.pin")}</span>
                <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
              </label>
              <label className="field">
                <span>{t("lock.pinAgain")}</span>
                <input type="password" inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, "").slice(0, 8))} />
              </label>
            </div>
          )}
          <label className="field">
            <span>{t("lock.after")}</span>
            <select value={after} onChange={(e) => setAfter(Number(e.target.value))}>
              {[1, 5, 15].map((m) => (
                <option key={m} value={m}>
                  {t("lock.minutes", { n: m })}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small-text">{t("lock.note")}</p>
        </>
      )}
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        <button type="submit" className="primary" disabled={bio === null && scope !== "off"}>
          {t("note.save")}
        </button>
      </div>
    </form>
  );
}
