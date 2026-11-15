import { useState } from "react";
import { MoreVertical, Plus, Receipt, Send, Share2, UserPlus } from "lucide-react";
import {
  balances,
  formatAmount,
  formatPhone,
  objectDocName,
  readSplit,
  setSplitTitle,
  splitTotal,
  swishNumber,
  validEmail,
  type MemberRole,
} from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocValue, useSession } from "../lib/sync-react";
import { TitleInput } from "../notes/NoteScreen";
import { Back, NotHere, useAway, useThing } from "../things/parts";
import { ShareDialog } from "../things/ShareDialog";
import { Dialog, Menu, MenuItem } from "../ui";
import { ExpenseForm, PersonForm, useExpenseLine } from "./dialogs";
import { SendForm, SettleList } from "./parts";

export function SplitScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { loading, role } = useThing("split", id);
  if (loading) return <p className="muted">{t("lists.loading")}</p>;
  if (!role) return <NotHere type="split" />;
  return <SplitPage id={id} role={role} />;
}

/**
 * A cost split's page (decision 13): everyone as a card with what they paid, their share and their
 * balance, drawn as a bar against the largest one, so the group reads as one settling to zero; then the
 * expenses, who pays whom, and sending it all out.
 */
function SplitPage({ id, role }: { id: string; role: MemberRole }) {
  const { t, lang } = useI18n();
  const { sync, user } = useSession();
  const name = objectDocName("split", id);
  const doc = sync.doc(name);
  const view = useDocValue(doc, readSplit);
  const expenseLine = useExpenseLine();
  const [editing, setEditing] = useState<{ kind: "person" | "expense"; id: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  const [sharing, setSharing] = useState(false);
  const { away, problem } = useAway("split", id);
  const readOnly = role === "viewer";

  if (!sync.isLoaded(name)) return <p className="muted">{t("lists.loading")}</p>;

  const bs = balances(view);
  const biggest = Math.max(1, ...bs.map((b) => Math.abs(b.net)));
  const total = splitTotal(view);
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatAmount(Math.abs(n), lang)}`;
  // (the year only on an expense outside the year most of them are in)
  const counts = new Map<string, number>();
  for (const e of view.expenses) if (e.date) counts.set(e.date.slice(0, 4), (counts.get(e.date.slice(0, 4)) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const day = (date: string) =>
    date
      ? new Date(`${date}T12:00:00`)
          .toLocaleDateString(t("locale"), { day: "numeric", month: "short", ...(date.slice(0, 4) !== usual ? { year: "numeric" } : {}) })
          .replace(/\.(?=\s|$)/g, "")
      : "";

  return (
    <div className="screen split-screen">
      <div className="list-head">
        <Back type="split" />
        <div className="list-title-row">
          <TitleInput value={view.title} placeholder={t("untitled.split")} readOnly={readOnly} onCommit={(v) => setSplitTitle(doc, v)} />
          <div className="list-actions">
            <button type="button" className="secondary small" onClick={() => setSharing(true)}>
              <Share2 aria-hidden size={16} /> {t("list.share")}
            </button>
            <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={20} />}>
              {role === "owner" ? (
                <MenuItem danger onSelect={() => void away("delete", t("split.deleteConfirm"))}>
                  {t("split.delete")}
                </MenuItem>
              ) : (
                <MenuItem danger onSelect={() => void away("leave", t("split.leaveConfirm"))}>
                  {t("split.leave")}
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
        {problem && <p className="problem">{problem}</p>}
        <p className="split-meta">
          {t("split.meta", { n: view.expenses.length })} <strong>{formatAmount(total, lang)} kr</strong>
        </p>
      </div>

      <ul className="split-people" aria-label={t("split.people")}>
        {bs.map((b) => {
          const p = b.person;
          const me = p.userId === user.id;
          const number = swishNumber(p.phone);
          const sub = me ? t("split.you") : number ? formatPhone(number) : p.email || t("split.noDetails");
          const tone = b.net > 0 ? "plus" : b.net < 0 ? "minus" : "even";
          return (
            <li key={p.id}>
              <button type="button" className="split-person" disabled={readOnly} onClick={() => setEditing({ kind: "person", id: p.id })} aria-label={t("split.editPerson", { name: p.name })}>
                <span className="split-who">
                  <span className="split-avatar" aria-hidden>
                    {(p.name.trim()[0] ?? "?").toUpperCase()}
                  </span>
                  <span className="split-name">
                    {p.name}
                    <small>{sub}</small>
                  </span>
                </span>
                {(!validEmail(p.email) || (b.net > 0 && !number)) && (
                  <span className="split-flags">
                    {!validEmail(p.email) && <span className="split-flag">{t("split.flag.noEmail")}</span>}
                    {b.net > 0 && !number && <span className="split-flag">{t("split.flag.noSwish")}</span>}
                  </span>
                )}
                {/* (pushed to the bottom together, so the figures line up across a row whatever the name) */}
                <span className="split-figures">
                  <span className="split-nums">
                    <span>
                      <span>{t("split.paidCol")}</span>
                      <span>{formatAmount(b.paid, lang)}</span>
                    </span>
                    <span>
                      <span>{t("split.shareCol")}</span>
                      <span>{formatAmount(b.share, lang)}</span>
                    </span>
                  </span>
                  <span className={`split-balance ${tone}`}>{b.net === 0 ? t("split.part.even") : signed(b.net)}</span>
                  {/* the balance from a shared zero in the middle: owed grows right, owing left */}
                  <span className="split-bar" aria-hidden>
                    <span className={tone} style={{ width: `${(Math.abs(b.net) / biggest) * 50}%` }} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!readOnly && (
          <li className="split-add-person">
            <button type="button" onClick={() => setEditing({ kind: "person", id: null })}>
              <UserPlus aria-hidden size={18} /> {t("split.addPerson")}
            </button>
          </li>
        )}
      </ul>

      <section className="split-section" aria-labelledby="split-expenses">
        <h2 id="split-expenses" className="section-title">
          {t("split.expenses")}
        </h2>
        {view.expenses.length === 0 ? (
          <p className="muted">{t(view.people.length > 1 ? "split.noExpenses" : "split.addPeopleFirst")}</p>
        ) : (
          <ul className="split-expenses">
            {[...view.expenses].reverse().map((e) => (
              <li key={e.id}>
                <button type="button" disabled={readOnly} onClick={() => setEditing({ kind: "expense", id: e.id })}>
                  <span className="split-date">{day(e.date)}</span>
                  <span className="split-what">
                    <span>
                      {e.text || t("split.expense.untitled")}
                      {e.scan && <Receipt className="split-receipt-mark" aria-label={t("split.receiptMark")} size={14} />}
                    </span>
                    <small>{expenseLine(e, view)}</small>
                  </span>
                  <span className="split-amount">{formatAmount(e.amount, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="split-section" aria-labelledby="split-settle">
        <h2 id="split-settle" className="section-title">
          {t("split.settle")}
        </h2>
        <SettleList doc={doc} view={view} readOnly={readOnly} />
      </section>

      {!readOnly && (
        <div className="split-dock">
          <button type="button" className="secondary" disabled={view.people.length === 0} onClick={() => setEditing({ kind: "expense", id: null })}>
            <Plus aria-hidden size={18} /> {t("split.addExpense")}
          </button>
          <button type="button" className="primary" disabled={view.expenses.length === 0} onClick={() => setSending(true)}>
            <Send aria-hidden size={18} /> {t("split.sendOut")}
          </button>
        </div>
      )}

      <Dialog open={editing?.kind === "person"} onClose={() => setEditing(null)} title={t(editing?.id ? "split.editPersonTitle" : "split.addPerson")}>
        {editing?.kind === "person" && <PersonForm key={editing.id ?? "new"} doc={doc} view={view} id={editing.id} onDone={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={editing?.kind === "expense"} onClose={() => setEditing(null)} title={t(editing?.id ? "split.editExpense" : "split.addExpense")}>
        {editing?.kind === "expense" && <ExpenseForm key={editing.id ?? "new"} doc={doc} view={view} id={editing.id} onDone={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={sending} onClose={() => setSending(false)} title={t("split.sendTitle", { title: view.title || t("untitled.split") })}>
        {sending && (
          <SendForm
            id={id}
            view={view}
            onDone={() => setSending(false)}
            onEditPerson={(personId) => {
              setSending(false);
              setEditing({ kind: "person", id: personId });
            }}
          />
        )}
      </Dialog>
      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title: view.title })}>
        <ShareDialog id={id} />
      </Dialog>
    </div>
  );
}
