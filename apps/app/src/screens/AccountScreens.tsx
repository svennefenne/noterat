import { useState, type FormEvent, type ReactNode } from "react";
import { checkDisplayName, checkPassword, checkUsername, PASSWORD_MIN, type SessionReply } from "@noterat/core";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Field, Page, Problem, Submit } from "../ui";

interface Props {
  base: string;
  onSignedIn: (reply: SessionReply) => void;
  /** under the card: in the app, "Change server" */
  footer?: ReactNode;
}

/** A form that sends once at a time and shows what went wrong. */
function useSend(onSignedIn: Props["onSignedIn"]) {
  const { errorText } = useI18n();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(request: () => Promise<SessionReply>) {
    setBusy(true);
    setProblem("");
    try {
      onSignedIn(await request());
    } catch (err) {
      setProblem(errorText(err));
      setBusy(false);
    }
  }
  return { problem, setProblem, busy, send };
}

/** The server's first account, which becomes its admin. */
export function SetupScreen({ base, onSignedIn, footer }: Props) {
  const { t, errorText } = useI18n();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const { problem, setProblem, busy, send } = useSend(onSignedIn);

  function submit(e: FormEvent) {
    e.preventDefault();
    const local = checkUsername(username.trim()) ?? checkDisplayName(displayName) ?? checkPassword(password);
    if (local) return setProblem(errorText(new ApiError(local, 400)));
    void send(() => api.setup(base, { username: username.trim(), displayName: displayName.trim(), password }));
  }

  return (
    <Page title={t("setup.title")} intro={t("setup.intro")} footer={footer}>
      <form onSubmit={submit} noValidate>
        <Field
          label={t("field.username")}
          hint={t("field.usernameHint")}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Field label={t("field.displayName")} hint={t("field.displayNameHint")} autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <Field
          label={t("field.password")}
          hint={t("field.passwordHint", { min: PASSWORD_MIN })}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {problem && <Problem>{problem}</Problem>}
        <Submit busy={busy}>{t("setup.submit")}</Submit>
      </form>
    </Page>
  );
}

export function LoginScreen({ base, onSignedIn, footer, notice }: Props & { notice?: string }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { problem, busy, send } = useSend(onSignedIn);

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(() => api.login(base, { username: username.trim(), password }));
  }

  return (
    <Page title={t("login.title")} footer={footer}>
      {notice && !problem && <Problem>{notice}</Problem>}
      <form onSubmit={submit} noValidate>
        <Field
          label={t("field.username")}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Field label={t("field.password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {problem && <Problem>{problem}</Problem>}
        <Submit busy={busy}>{t("login.submit")}</Submit>
      </form>
    </Page>
  );
}
