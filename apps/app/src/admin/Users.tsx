import { useState, type FormEvent } from "react";
import { Check, ChevronRight, Copy, KeyRound, LogOut, RefreshCw, Trash2, UserPlus } from "lucide-react";
import type { Role } from "@noterat/core";
import type { AdminUser } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/sync-react";
import { Dialog, Problem } from "../ui";
import { AdminSection } from "./AdminScreen";

/** a password that's easy to read out and type: four groups of four, without look-alike letters */
export function newPassword(): string {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(bytes, (b) => letters[b % letters.length])
    .join("")
    .replace(/(.{4})(?!$)/g, "$1-");
}

/** "Cilla Ek" → "cilla.ek" */
export function usernameFrom(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 32);
}

/** "för 3 timmar sedan" */
function ago(at: number, locale: string): string {
  const s = (at - Date.now()) / 1000;
  const f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(s) >= size) return f.format(Math.round(s / size), unit);
  return f.format(0, "minute");
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The household's accounts (decision 14): who's here and when they were last seen, someone added with a
 * password to pass on, and each one renamed, made an admin, given a new password, logged out or removed.
 */
export function UsersSection({ users, reload }: { users: AdminUser[] | null; reload: () => void }) {
  const { t } = useI18n();
  const { user: me } = useSession();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const editingUser = users?.find((u) => u.id === editing) ?? null;

  return (
    <AdminSection
      id="users"
      intro={t("admin.users.intro")}
      action={
        <button type="button" className="primary small" onClick={() => setAdding(true)}>
          <UserPlus aria-hidden size={16} /> {t("admin.users.add")}
        </button>
      }
    >
      {!users ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : (
        <ul className="admin-users">
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" className="admin-user" onClick={() => setEditing(u.id)} aria-label={t("admin.users.edit", { name: u.displayName })}>
                <span className="admin-avatar" aria-hidden>
                  {(u.displayName.trim()[0] ?? "?").toUpperCase()}
                </span>
                <span className="admin-user-main">
                  <span className="admin-user-name">
                    {u.displayName}
                    {u.id === me.id && <span className="badge">{t("admin.users.you")}</span>}
                    {u.role === "admin" && <span className="badge admin-badge">{t("admin.users.admin")}</span>}
                  </span>
                  <small>@{u.username}</small>
                </span>
                <UserSeen u={u} />
                <ChevronRight aria-hidden size={18} className="admin-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title={t("admin.users.add")}>
        {adding && (
          <AddUser
            onDone={() => {
              setAdding(false);
              reload();
            }}
            onAdded={reload}
          />
        )}
      </Dialog>
      <Dialog open={!!editingUser} onClose={() => setEditing(null)} title={editingUser?.displayName ?? ""}>
        {editingUser && (
          <EditUser
            key={editingUser.id}
            u={editingUser}
            onChanged={reload}
            onRemoved={() => {
              setEditing(null);
              reload();
            }}
          />
        )}
      </Dialog>
    </AdminSection>
  );
}

function UserSeen({ u }: { u: AdminUser }) {
  const { t } = useI18n();
  return (
    <span className="admin-user-meta muted small-text">
      {u.lastSeen ? t("admin.users.seen", { when: ago(u.lastSeen, t("locale")) }) : t("admin.users.never")}
      {u.devices > 0 && (
        <>
          <br />
          {t(u.devices === 1 ? "admin.users.device" : "admin.users.devices", { n: u.devices })}
        </>
      )}
    </span>
  );
}

function RolePick({ role, onChange, disabled }: { role: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="segmented labels" role="group" aria-label={t("admin.users.role")}>
      {(["member", "admin"] as const).map((r) => (
        <button key={r} type="button" aria-pressed={role === r} disabled={disabled} onClick={() => onChange(r)}>
          {t(`admin.users.${r}`)}
        </button>
      ))}
    </div>
  );
}

/** A password to pass on: shown, made anew, copied. */
function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <label className="field">
      <span>{t("admin.users.password")}</span>
      <span className="password-row">
        <input value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" spellCheck={false} className="mono" />
        <button type="button" className="icon-button" title={t("admin.users.newOne")} aria-label={t("admin.users.newOne")} onClick={() => onChange(newPassword())}>
          <RefreshCw aria-hidden size={18} />
        </button>
        <button type="button" className="icon-button" title={t("admin.users.copy")} aria-label={t("admin.users.copy")} onClick={async () => setCopied(await copy(value))}>
          {copied ? <Check aria-hidden size={18} /> : <Copy aria-hidden size={18} />}
        </button>
      </span>
    </label>
  );
}

function AddUser({ onDone, onAdded }: { onDone: () => void; onAdded: () => void }) {
  const { t, errorText } = useI18n();
  const { api, base } = useSession();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [picked, setPicked] = useState(false);
  const [password, setPassword] = useState(newPassword);
  const [role, setRole] = useState<Role>("member");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<AdminUser | null>(null);
  const [copied, setCopied] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      setMade(await api.addUser({ username: username.trim(), displayName: name.trim(), password, role }));
      onAdded();
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (made) {
    const where = base ? new URL(base).host : location.host;
    const all = t("admin.users.details", { server: where, username: made.username, password });
    return (
      <div className="stack">
        <p>{t("admin.users.made", { name: made.displayName })}</p>
        <dl className="admin-details">
          <dt>{t("admin.users.server")}</dt>
          <dd>{where}</dd>
          <dt>{t("admin.users.username")}</dt>
          <dd className="mono">{made.username}</dd>
          <dt>{t("admin.users.password")}</dt>
          <dd className="mono">{password}</dd>
        </dl>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={async () => setCopied(await copy(all))}>
            {copied ? <Check aria-hidden size={16} /> : <Copy aria-hidden size={16} />} {t("admin.users.copyAll")}
          </button>
          <button type="button" className="primary" onClick={onDone}>
            {t("budget.done")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={add} className="stack">
      <label className="field">
        <span>{t("admin.users.name")}</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!picked) setUsername(usernameFrom(e.target.value));
          }}
          maxLength={60}
          autoComplete="off"
          data-autofocus
        />
      </label>
      <label className="field">
        <span>{t("admin.users.username")}</span>
        <input
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setPicked(true);
          }}
          maxLength={32}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <span className="muted small-text">{t("admin.users.usernameHint")}</span>
      </label>
      <PasswordField value={password} onChange={setPassword} />
      <div className="field">
        <span className="field-label">{t("admin.users.role")}</span>
        <RolePick role={role} onChange={setRole} />
        <span className="muted small-text">{t(role === "admin" ? "admin.users.adminHint" : "admin.users.memberHint")}</span>
      </div>
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        <button type="submit" className="primary" disabled={busy || !name.trim() || !username.trim()}>
          <UserPlus aria-hidden size={18} /> {t("admin.users.addButton")}
        </button>
      </div>
    </form>
  );
}

function EditUser({ u, onChanged, onRemoved }: { u: AdminUser; onChanged: () => void; onRemoved: () => void }) {
  const { t, errorText } = useI18n();
  const { api, user: me } = useSession();
  const [name, setName] = useState(u.displayName);
  const [password, setPassword] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const self = u.id === me.id;

  async function act(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      await work();
      onChanged();
      if (done) setNote(done);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack admin-edit">
      <form
        className="admin-rename"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => api.changeUser(u.id, { displayName: name.trim() }), t("admin.users.renamed"));
        }}
      >
        <label className="field">
          <span>{t("admin.users.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
        </label>
        <button type="submit" className="secondary" disabled={busy || !name.trim() || name.trim() === u.displayName}>
          {t("note.save")}
        </button>
      </form>
      <p className="muted small-text">
        @{u.username} · {t("admin.users.owns", { n: u.owns })}
      </p>

      <div className="field">
        <span className="field-label">{t("admin.users.role")}</span>
        <RolePick
          role={u.role}
          disabled={busy}
          onChange={(role) => {
            if (role === u.role) return;
            if (self && role === "member" && !confirm(t("admin.users.demoteSelf"))) return;
            void act(() => api.changeUser(u.id, { role }));
          }}
        />
      </div>

      <div className="admin-actions">
        {password === null ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => setPassword(newPassword())}>
            <KeyRound aria-hidden size={16} /> {t("admin.users.setPassword")}
          </button>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api.setUserPassword(u.id, password);
                setPassword(null);
              }, t(self ? "admin.users.passwordSetSelf" : "admin.users.passwordSet", { name: u.displayName, password }));
            }}
          >
            <PasswordField value={password} onChange={setPassword} />
            <span className="muted small-text">{t(self ? "admin.users.passwordHintSelf" : "admin.users.passwordHint")}</span>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setPassword(null)}>
                {t("admin.users.cancel")}
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {t("admin.users.savePassword")}
              </button>
            </div>
          </form>
        )}
        {u.devices > (self ? 1 : 0) && password === null && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => confirm(t(self ? "admin.users.logoutSelfConfirm" : "admin.users.logoutConfirm", { name: u.displayName })) && void act(() => api.logOutUser(u.id), t("admin.users.loggedOut"))}
          >
            <LogOut aria-hidden size={16} /> {t(self ? "admin.users.logoutOthers" : "admin.users.logout")}
          </button>
        )}
      </div>

      {note && <p className="notice small-text">{note}</p>}
      {problem && <Problem>{problem}</Problem>}

      {!self && (
        <div className="admin-danger">
          <button
            type="button"
            className="secondary danger-text"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const r = await api.removalOf(u.id);
                if (!confirm(t("admin.users.removeConfirm", { name: u.displayName, handedOver: r.handedOver, deleted: r.deleted }))) return;
                await api.removeUser(u.id);
                onRemoved();
              })
            }
          >
            <Trash2 aria-hidden size={16} /> {t("admin.users.remove")}
          </button>
        </div>
      )}
    </div>
  );
}
