import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Send, UserMinus, X } from "lucide-react";
import type { Person, ShareRole, ShareState } from "@noterat/core";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/sync-react";
import { Problem } from "../ui";

/**
 * Who has a thing (a list, a note, a memo), and (the owner) sharing it: inviting someone on the
 * server, who sees it at once in their app, or making a link to send any way at all. Needs a
 * connection; everything else in a thing doesn't.
 */
export function ShareDialog({ id }: { id: string }) {
  const { t, errorText } = useI18n();
  const { api, user } = useSession();
  const [state, setState] = useState<ShareState | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [invitee, setInvitee] = useState("");
  const [inviteRole, setInviteRole] = useState<ShareRole>("editor");
  const [linkRole, setLinkRole] = useState<ShareRole>("editor");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  const [version, setVersion] = useState(0);

  const fail = useCallback((err: unknown) => setProblem(err instanceof ApiError && err.code === "network" ? t("share.offline") : errorText(err)), [t, errorText]);

  // who has it (asked again after each change: version)
  useEffect(() => {
    let live = true;
    api
      .shareState(id)
      .then(async (s) => [s, s.role === "owner" ? await api.people() : []] as const)
      .then(
        ([s, p]) => {
          if (!live) return;
          setState(s);
          setPeople(p);
          setProblem("");
        },
        (err) => live && fail(err),
      );
    return () => {
      live = false;
    };
  }, [api, id, fail, version]);

  async function act(f: () => Promise<unknown>, after?: string) {
    setBusy(true);
    setNote("");
    try {
      await f();
      if (after) setNote(after);
      setVersion((v) => v + 1);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return problem ? <Problem>{problem}</Problem> : <p className="muted">{t("share.loading")}</p>;

  const owner = state.role === "owner";
  const roleText = (r: string) => t(r === "owner" ? "share.owner" : r === "editor" ? "share.editor" : "share.viewer");
  const taken = new Set([...state.members.map((m) => m.person.id), ...state.invitations.map((i) => i.person.id)]);
  const invitable = people.filter((p) => !taken.has(p.id));

  return (
    <div className="share">
      <section>
        <h3>{t("share.members")}</h3>
        <ul className="people">
          {state.members.map((m) => (
            <li key={m.person.id}>
              <span className="person-name">
                {m.person.displayName}
                {m.person.id === user.id && <span className="muted"> ({t("share.you")})</span>}
              </span>
              {owner && m.role !== "owner" ? (
                <span className="person-actions">
                  <select value={m.role} onChange={(e) => void act(() => api.setRole(id, m.person.id, e.target.value as ShareRole))} aria-label={t("share.role", { name: m.person.displayName })} disabled={busy}>
                    <option value="editor">{t("share.editor")}</option>
                    <option value="viewer">{t("share.viewer")}</option>
                  </select>
                  <button type="button" className="icon-button" onClick={() => void act(() => api.removeMember(id, m.person.id))} aria-label={t("share.remove", { name: m.person.displayName })} title={t("share.remove", { name: m.person.displayName })} disabled={busy}>
                    <UserMinus aria-hidden size={18} />
                  </button>
                </span>
              ) : (
                <span className="muted">{roleText(m.role)}</span>
              )}
            </li>
          ))}
          {state.invitations.map((i) => (
            <li key={i.id} className="pending">
              <span className="person-name">
                {i.person.displayName} <span className="muted">· {t("share.pending")}</span>
              </span>
              <span className="person-actions">
                <span className="muted">{roleText(i.role)}</span>
                <button type="button" className="icon-button" onClick={() => void act(() => api.revoke(id, i.id))} aria-label={t("share.revoke")} title={t("share.revoke")} disabled={busy}>
                  <X aria-hidden size={18} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {owner && (
        <section>
          <h3>{t("share.invite")}</h3>
          {invitable.length === 0 ? (
            <p className="muted">{t("share.nobody")}</p>
          ) : (
            <form
              className="share-row"
              onSubmit={(e) => {
                e.preventDefault();
                const who = invitable.find((p) => String(p.id) === invitee);
                if (who) void act(() => api.share(id, { role: inviteRole, userId: who.id }), t("share.invited", { name: who.displayName })).then(() => setInvitee(""));
              }}
            >
              <select value={invitee} onChange={(e) => setInvitee(e.target.value)} aria-label={t("share.pickPerson")} required>
                <option value="">{t("share.pickPerson")}</option>
                {invitable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as ShareRole)} aria-label={t("share.asRole")}>
                <option value="editor">{t("share.editor")}</option>
                <option value="viewer">{t("share.viewer")}</option>
              </select>
              <button type="submit" className="primary small" disabled={busy || !invitee}>
                <Send aria-hidden size={16} /> {t("share.send")}
              </button>
            </form>
          )}
        </section>
      )}

      {owner && (
        <section>
          <h3>{t("share.link")}</h3>
          <p className="muted small-text">{t("share.linkHint")}</p>
          <div className="share-row">
            <select value={linkRole} onChange={(e) => setLinkRole(e.target.value as ShareRole)} aria-label={t("share.asRole")}>
              <option value="editor">{t("share.editor")}</option>
              <option value="viewer">{t("share.viewer")}</option>
            </select>
            <button
              type="button"
              className="secondary small"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await api.share(id, { role: linkRole });
                  if (r.kind === "link") {
                    setLink(r.url);
                    setCopied(false);
                  }
                })
              }
            >
              <Link2 aria-hidden size={16} /> {t("share.createLink")}
            </button>
          </div>
          {link && (
            <div className="share-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label={t("share.link")} />
              {navigator.clipboard && (
                <button type="button" className="secondary small" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
                  <Copy aria-hidden size={16} /> {copied ? t("share.copied") : t("share.copy")}
                </button>
              )}
              {"share" in navigator && (
                <button type="button" className="secondary small" onClick={() => void navigator.share({ title: state.title, url: link }).catch(() => {})}>
                  <Send aria-hidden size={16} /> {t("share.send.link")}
                </button>
              )}
            </div>
          )}
          {state.links.length > 0 && (
            <ul className="people">
              {state.links.map((l) => (
                <li key={l.id}>
                  <span className="person-name">{t("share.openLink", { role: roleText(l.role).toLowerCase() })}</span>
                  <button type="button" className="link" onClick={() => void act(() => api.revoke(id, l.id))} disabled={busy}>
                    {t("share.revoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}
