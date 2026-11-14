import { useState, type FormEvent } from "react";
import type { ServerInfo } from "@noterat/core";
import { api, serverAddress } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Field, Page, Problem, Submit } from "../ui";

/** The app's first screen: which server it uses (the address is checked to be a Noterat server). */
export function ServerScreen({ last, onConnected }: { last: string | null; onConnected: (base: string, info: ServerInfo) => void }) {
  const { t, errorText } = useI18n();
  const [address, setAddress] = useState(last ?? "");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect(e: FormEvent) {
    e.preventDefault();
    const base = serverAddress(address);
    if (!base) return setProblem(t("server.invalid"));
    setBusy(true);
    setProblem("");
    try {
      const info = await api.serverInfo(base);
      if (info?.app !== "noterat") throw new Error("not noterat");
      onConnected(base, info);
    } catch (err) {
      setProblem(err instanceof Error && err.message === "not noterat" ? t("server.notNoterat") : errorText(err));
      setBusy(false);
    }
  }

  return (
    <Page title={t("server.title")} intro={t("server.intro")}>
      <form onSubmit={connect} noValidate>
        <Field
          label={t("server.address")}
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://noterat.example.com"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
        />
        {problem && <Problem>{problem}</Problem>}
        <Submit busy={busy}>{t("server.connect")}</Submit>
      </form>
    </Page>
  );
}
