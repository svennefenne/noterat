import { useEffect, useState, type FormEvent } from "react";
import { isDesktop, type AdminPush, type PushKind, type PushPrefs } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { canPush } from "../lib/push";
import { useSession } from "../lib/sync-react";
import { Problem } from "../ui";

const KINDS: PushKind[] = ["invitation", "transcribed", "scanned"];

/** Which pushes this person wants, and quiet hours (kept on the server, which does the sending). */
export function NotificationSettingsForm({ onDone }: { onDone: () => void }) {
  const { t, errorText } = useI18n();
  const { api } = useSession();
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [problem, setProblem] = useState("");
  const [tested, setTested] = useState<number | null>(null);

  useEffect(() => {
    api.pushPrefs().then(setPrefs, (e: unknown) => setProblem(errorText(e)));
  }, [api, errorText]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    try {
      await api.setPushPrefs(prefs);
      onDone();
    } catch (err) {
      setProblem(errorText(err));
    }
  }

  if (!prefs) return problem ? <Problem>{problem}</Problem> : <p className="muted">{t("lists.loading")}</p>;
  const quiet = prefs.quietFrom !== "" && prefs.quietTo !== "";
  return (
    <form onSubmit={save} className="stack">
      <p className="muted small-text">{t(canPush ? "push.about" : isDesktop ? "push.aboutDesktop" : "push.aboutWeb")}</p>
      <fieldset className="checks">
        <legend>{t("push.which")}</legend>
        {KINDS.map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={prefs.kinds[k]} onChange={(e) => setPrefs({ ...prefs, kinds: { ...prefs.kinds, [k]: e.target.checked } })} /> {t(`push.kind.${k}`)}
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={quiet} onChange={(e) => setPrefs({ ...prefs, quietFrom: e.target.checked ? "22:00" : "", quietTo: e.target.checked ? "07:00" : "" })} /> {t("push.quiet")}
      </label>
      {quiet && (
        <div className="pin-fields">
          <label className="field">
            <span>{t("push.quietFrom")}</span>
            <input type="time" value={prefs.quietFrom} onChange={(e) => setPrefs({ ...prefs, quietFrom: e.target.value })} required />
          </label>
          <label className="field">
            <span>{t("push.quietTo")}</span>
            <input type="time" value={prefs.quietTo} onChange={(e) => setPrefs({ ...prefs, quietTo: e.target.value })} required />
          </label>
        </div>
      )}
      {(canPush || isDesktop) && (
        <p className="small-text">
          <button
            type="button"
            className="link-button"
            onClick={() =>
              void api.pushTest().then(
                (r) => setTested(r.sent),
                () => setTested(0),
              )
            }
          >
            {t("push.test")}
          </button>{" "}
          {tested !== null && <span className="muted">{t(tested ? "push.testSent" : "push.testNone")}</span>}
        </p>
      )}
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        <button type="submit" className="primary">
          {t("note.save")}
        </button>
      </div>
    </form>
  );
}

/** A file picked, read as text (the two Firebase files are small JSON files). */
function JsonFile({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{label}</span>
      <input type="file" accept=".json,application/json" onChange={(e) => void e.target.files?.[0]?.text().then(onChange)} />
      {value && <span className="muted small-text">{t("push.admin.read", { n: value.length })}</span>}
    </label>
  );
}

/**
 * The admin's part: the household's Firebase project, two files from its console. google-services.json
 * is handed to the phones; the service account's key stays on the server and is never shown again.
 */
export function PushAdminForm({ onDone }: { onDone?: () => void }) {
  const { t, errorText } = useI18n();
  const { api } = useSession();
  const [state, setState] = useState<AdminPush | null>(null);
  const [googleServices, setGoogleServices] = useState("");
  const [serviceAccount, setServiceAccount] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => setProblem(errorText(e));

  useEffect(() => {
    api.adminPush().then(setState, fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- (once, when the dialog opens)
  }, [api]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      setState(await api.setAdminPush(googleServices, serviceAccount));
      setGoogleServices("");
      setServiceAccount("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return problem ? <Problem>{problem}</Problem> : <p className="muted">{t("lists.loading")}</p>;
  return (
    <form onSubmit={save} className="stack">
      {state.configured ? (
        <p>{t("push.admin.on", { project: state.projectId, devices: state.devices ?? 0 })}</p>
      ) : (
        <p className="muted small-text">{t("push.admin.off")}</p>
      )}
      <ol className="small-text steps">
        <li>{t("push.admin.step1")}</li>
        <li>{t("push.admin.step2")}</li>
        <li>{t("push.admin.step3")}</li>
      </ol>
      <JsonFile label="google-services.json" value={googleServices} onChange={setGoogleServices} />
      <JsonFile label={t("push.admin.key")} value={serviceAccount} onChange={setServiceAccount} />
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        {state.configured && (
          <button
            type="button"
            className="secondary danger-text"
            onClick={() => {
              if (confirm(t("push.admin.removeConfirm"))) void api.removeAdminPush().then(() => setState({ configured: false, projectId: "", clientEmail: "" }), fail);
            }}
          >
            {t("push.admin.remove")}
          </button>
        )}
        {onDone && (
          <button type="button" className="secondary" onClick={onDone}>
            {t("budget.done")}
          </button>
        )}
        <button type="submit" className="primary" disabled={busy || !googleServices || !serviceAccount}>
          {t("note.save")}
        </button>
      </div>
    </form>
  );
}
