import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { checkDisplayName, checkPassword, checkUsername, PASSWORD_MIN, type LinkInfo, type SessionReply } from "@noterat/core";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/sync-react";
import { Field, Page, Problem, Submit } from "../ui";

/**
 * A share link's page (/i/<token>): "Sam wants to share Shopping with you". Logged in: accept, and the
 * list opens. Not logged in: make an account (which accepts it too) or log in first.
 */

function useLinkInfo(base: string, link: string) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [missing, setMissing] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    api.linkInfo(base, link).then(
      (i) => live && setInfo(i),
      (err) => live && setMissing(err),
    );
    return () => {
      live = false;
    };
  }, [base, link]);
  return { info, missing };
}

/** What the link is, or why it can't be used. */
function About({ info, missing }: { info: LinkInfo | null; missing: unknown }) {
  const { t, errorText } = useI18n();
  if (missing) return <Problem>{missing instanceof ApiError && missing.code === "not_found" ? t("link.notFound") : errorText(missing)}</Problem>;
  if (!info) return <p className="muted">{t("share.loading")}</p>;
  if (info.status !== "open") return <Problem>{t(info.status === "used" ? "link.used" : "link.expired")}</Problem>;
  return <p className="intro">{t(info.role === "editor" ? "link.editor" : "link.viewer")}</p>;
}

const heading = (t: ReturnType<typeof useI18n>["t"], info: LinkInfo | null) => (info ? t("link.title", { name: info.from, title: info.title || t("lists.untitled") }) : "Noterat");

/** Logged in: accept the link. */
export function LinkScreen({ base, link }: { base: string; link: string }) {
  const { t, errorText } = useI18n();
  const session = useSession();
  const [, navigate] = useLocation();
  const { info, missing } = useLinkInfo(base, link);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const r = await session.api.acceptLink(link);
      navigate(`/lists/${r.objectId}`, { replace: true });
    } catch (err) {
      setProblem(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="screen narrow">
      <section className="card-panel">
        <h1>{heading(t, info)}</h1>
        <About info={info} missing={missing} />
        {problem && <Problem>{problem}</Problem>}
        <div className="actions">
          {info?.status === "open" && (
            <button type="button" className="primary" onClick={() => void accept()} disabled={busy}>
              {t("link.accept")}
            </button>
          )}
          <button type="button" className="secondary" onClick={() => navigate("/", { replace: true })}>
            {t("link.home")}
          </button>
        </div>
      </section>
    </div>
  );
}

/** Not logged in: make an account from the link (accepting it), or log in and then accept. */
export function LinkGate({ base, link, onSignedIn }: { base: string; link: string; onSignedIn: (reply: SessionReply) => void }) {
  const { t, errorText } = useI18n();
  const [, navigate] = useLocation();
  const { info, missing } = useLinkInfo(base, link);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const open = info?.status === "open";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "signup") {
      const local = checkUsername(username.trim()) ?? checkDisplayName(displayName) ?? checkPassword(password);
      if (local) return setProblem(errorText(new ApiError(local, 400)));
    }
    setBusy(true);
    setProblem("");
    try {
      if (mode === "signup") {
        const r = await api.signupByLink(base, link, { username: username.trim(), displayName: displayName.trim(), password });
        onSignedIn(r);
        navigate(`/lists/${r.accepted.objectId}`, { replace: true });
      } else onSignedIn(await api.login(base, { username: username.trim(), password }));
    } catch (err) {
      setProblem(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Page
      title={heading(t, info)}
      intro={<About info={info} missing={missing} />}
      footer={
        open && (
          <button type="button" className="link" onClick={() => (setMode(mode === "signup" ? "login" : "signup"), setProblem(""))}>
            {t(mode === "signup" ? "link.toLogin" : "link.toSignup")}
          </button>
        )
      }
    >
      {open && (
        <form onSubmit={submit} noValidate>
          <h2 className="form-title">{t(mode === "signup" ? "link.signupTitle" : "link.loginTitle")}</h2>
          <Field
            label={t("field.username")}
            hint={mode === "signup" ? t("field.usernameHint") : undefined}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          {mode === "signup" && (
            <Field label={t("field.displayName")} hint={t("field.displayNameHint")} autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          )}
          <Field
            label={t("field.password")}
            hint={mode === "signup" ? t("field.passwordHint", { min: PASSWORD_MIN }) : undefined}
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {problem && <Problem>{problem}</Problem>}
          <Submit busy={busy}>{t(mode === "signup" ? "setup.submit" : "login.submit")}</Submit>
        </form>
      )}
    </Page>
  );
}
