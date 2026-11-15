import { useEffect, useState } from "react";
import { Check, FileText, Send, Undo2 } from "lucide-react";
import type * as Y from "yjs";
import { addPayment, balances, formatAmount, removePayment, settle, swishNumber, validEmail, wallOf, type SplitView } from "@noterat/core";
import { useHousehold } from "../lib/household";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { saveOrShare } from "../lib/save";
import { useSession, useSyncState } from "../lib/sync-react";
import { Problem } from "../ui";

const first = (name: string) => name.split(" ")[0] || name;

/** Who pays whom to settle it all, and what has been paid since (which can be undone). */
export function SettleList({ doc, view, readOnly }: { doc: Y.Doc; view: SplitView; readOnly: boolean }) {
  const { t, lang } = useI18n();
  const dates = useDates();
  const transfers = settle(view);
  const swish = useHousehold().household.money.swish;
  const name = (id: string) => view.people.find((p) => p.id === id)?.name ?? "?";
  const today = wallOf(new Date(), true).slice(0, 10);
  return (
    <div className="split-settle">
      {transfers.length === 0 ? (
        <p className="muted">{t(view.expenses.length ? "split.settled" : "split.nothingYet")}</p>
      ) : (
        <ul className="split-transfers">
          {transfers.map((tr) => {
            const payee = view.people.find((p) => p.id === tr.to);
            return (
              <li key={`${tr.from}>${tr.to}`}>
                <span className="split-transfer-who">
                  <strong className="split-person-name">{name(tr.from)}</strong>
                  <span className="muted"> {t("split.paysTo")} </span>
                  <strong className="split-person-name">{name(tr.to)}</strong>
                  {swish && payee && !swishNumber(payee.phone) && <span className="split-warn">{t("split.noSwish", { name: first(payee.name) })}</span>}
                </span>
                <span className="split-transfer-amount">{formatAmount(tr.amount, lang)} kr</span>
                {!readOnly && (
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => confirm(t("split.markPaidConfirm", { from: name(tr.from), to: name(tr.to), amount: formatAmount(tr.amount, lang) })) && addPayment(doc, { ...tr, date: today })}
                  >
                    <Check aria-hidden size={16} /> {t("split.markPaid")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {view.payments.length > 0 && (
        <>
          <h3 className="split-subhead">{t("split.paid")}</h3>
          <ul className="split-payments">
            {[...view.payments].reverse().map((p) => (
              <li key={p.id}>
                <span>
                  {name(p.from)} <span className="muted">{t("split.paidTo")}</span> {name(p.to)}
                  {p.date && <span className="muted"> · {dates.day(p.date)}</span>}
                </span>
                <span className="split-transfer-amount muted">{formatAmount(p.amount, lang)} kr</span>
                {!readOnly && (
                  <button type="button" className="icon-button" aria-label={t("split.undoPaid")} title={t("split.undoPaid")} onClick={() => removePayment(doc, p.id)}>
                    <Undo2 aria-hidden size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** One person's PDF, made on the device (offline too), to look at or pass on. */
export function PdfButton({ view, personId, label }: { view: SplitView; personId: string; label?: string }) {
  const { t, lang } = useI18n();
  const { user } = useSession();
  const { household } = useHousehold();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="link-button small-text"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { splitPdf, splitMail } = await import("@noterat/core/letter");
          const letter = { lang, by: user.displayName, dates: household.locale, swish: household.money.swish };
          const bytes = await splitPdf(view, personId, letter);
          const { filename } = splitMail(view, personId, letter);
          await saveOrShare(new Blob([bytes as BlobPart], { type: "application/pdf" }), filename, view.title);
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileText aria-hidden size={14} /> {label ?? t("split.pdf")}
    </button>
  );
}

/**
 * Sending it out: everyone with an address gets their own mail and PDF, from the server. It reads the
 * server's copy, so it waits until this device's changes are there; and it needs the household's mail.
 */
export function SendForm({ id, view, onDone, onEditPerson }: { id: string; view: SplitView; onDone: () => void; onEditPerson: (personId: string) => void }) {
  const { t, lang, errorText } = useI18n();
  const dates = useDates();
  const { api } = useSession();
  const { connection, waiting } = useSyncState();
  const [mailReady, setMailReady] = useState<boolean | null>(null);
  const withMail = view.people.filter((p) => validEmail(p.email));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(withMail.map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, { sent: boolean; error?: string }> | null>(null);
  const [problem, setProblem] = useState("");
  const bs = new Map(balances(view).map((b) => [b.person.id, b.net]));
  const synced = connection === "online" && waiting === 0;
  const last = view.sends[view.sends.length - 1];

  useEffect(() => {
    api.mailReady().then((r) => setMailReady(r.ready), () => setMailReady(null));
  }, [api]);

  async function send() {
    setBusy(true);
    setProblem("");
    try {
      const r = await api.sendSplit(id, lang, [...chosen]);
      setResults(Object.fromEntries(r.results.map((x) => [x.id, x])));
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const part = (net: number) =>
    net < 0 ? t("split.part.pays", { amount: formatAmount(-net, lang) }) : net > 0 ? t("split.part.gets", { amount: formatAmount(net, lang) }) : t("split.part.even");

  return (
    <div className="stack split-send">
      <p className="muted small-text">{t("split.send.intro")}</p>
      <ul className="split-recipients">
        {view.people.map((p) => {
          const ok = validEmail(p.email);
          const r = results?.[p.id];
          const net = bs.get(p.id) ?? 0;
          return (
            <li key={p.id} className={ok ? undefined : "no-mail"}>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={!ok || !!results}
                  checked={ok && chosen.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setChosen(next);
                  }}
                />
                <span className="split-recipient">
                  <strong>{p.name}</strong>
                  <span className={net < 0 ? "split-part minus" : net > 0 ? "split-part plus" : "split-part"}>{part(net)}</span>
                  {ok ? (
                    <span className="muted small-text split-email">{p.email}</span>
                  ) : (
                    <button type="button" className="link-button small-text" onClick={() => onEditPerson(p.id)}>
                      {t("split.send.addEmail")}
                    </button>
                  )}
                </span>
              </label>
              <span className="split-recipient-end">
                {r ? r.sent ? <span className="split-sent"><Check aria-hidden size={16} /> {t("split.send.sent")}</span> : <span className="problem small-text">{r.error}</span> : <PdfButton view={view} personId={p.id} />}
              </span>
            </li>
          );
        })}
      </ul>
      {last && !results && <p className="muted small-text">{t("split.send.last", { when: dates.moment(last.at), by: last.by, n: last.to.length })}</p>}
      {mailReady === false && <Problem>{t("error.mail_off")}</Problem>}
      {!synced && <p className="notice small-text">{t(connection === "online" ? "split.send.waiting" : "split.send.offline")}</p>}
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        {results ? (
          <button type="button" className="primary" onClick={onDone}>
            {t("budget.done")}
          </button>
        ) : (
          <button type="button" className="primary" disabled={busy || !synced || mailReady === false || chosen.size === 0} onClick={() => void send()}>
            <Send aria-hidden size={18} /> {t(busy ? "split.send.sending" : "split.send.button", { n: chosen.size })}
          </button>
        )}
      </div>
    </div>
  );
}
