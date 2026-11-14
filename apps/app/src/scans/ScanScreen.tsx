import { useState } from "react";
import { FileDown, FileText, MoreVertical, Receipt, Share2 } from "lucide-react";
import type * as Y from "yjs";
import {
  formatAmount,
  objectDocName,
  parseAmount,
  readScan,
  scanText,
  scanTitle,
  setReceipt,
  setScanKind,
  setScanTitle,
  type MemberRole,
  type Page,
  type ReceiptGuess,
} from "@noterat/core";
import { ApiError, isApp } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocValue, useSession, useSyncState } from "../lib/sync-react";
import { MarkdownEditor } from "../notes/LazyEditor";
import { TitleInput } from "../notes/NoteScreen";
import { Back, NotHere, useAway, usePresence, useThing } from "../things/parts";
import { ShareDialog } from "../things/ShareDialog";
import { useFileUrl } from "../things/useFileUrl";
import { Dialog, Menu, MenuItem, Problem } from "../ui";
import { when } from "../memos/MemosScreen";
import { ScanStatus } from "./ScanStatus";

const readText = (doc: Y.Doc) => scanText(doc).toString();

/** A scan's page: only for a scan this person has. */
export function ScanScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { loading, role } = useThing("scan", id);
  if (loading) return <p className="muted">{t("lists.loading")}</p>;
  if (!role) return <NotHere type="scan" />;
  return <ScanPage id={id} role={role} />;
}

function ScanPage({ id, role }: { id: string; role: MemberRole }) {
  const { t, errorText } = useI18n();
  const { sync, api } = useSession();
  useSyncState();
  const name = objectDocName("scan", id);
  const doc = sync.doc(name);
  const scan = useDocValue(doc, readScan);
  const text = useDocValue(doc, readText);
  const [sharing, setSharing] = useState(false);
  const [shown, setShown] = useState<Page | null>(null);
  const { away, problem, setProblem } = useAway("scan", id);
  const readOnly = role === "viewer";
  const awareness = sync.awareness(name);
  usePresence(awareness);
  const title = scanTitle(scan, text) || t(`scan.kind.${scan.kind}`);

  async function readAgain() {
    setProblem("");
    try {
      await api.ocr(id);
    } catch (err) {
      setProblem(err instanceof ApiError && err.code === "network" ? t("list.needsOnline") : errorText(err));
    }
  }

  if (!sync.isLoaded(name)) return <p className="muted">{t("lists.loading")}</p>;

  return (
    <div className="screen scan-screen">
      <div className="list-head">
        <Back type="scan" />
        <div className="list-title-row">
          <TitleInput value={scan.title} placeholder={title} readOnly={readOnly} onCommit={(v) => setScanTitle(doc, v)} />
          <div className="list-actions">
            {!readOnly && (
              <div className="segmented" role="group" aria-label={t("scans.kind")}>
                <button type="button" aria-pressed={scan.kind === "receipt"} onClick={() => setScanKind(doc, "receipt")} title={t("scan.kind.receipt")}>
                  <Receipt aria-hidden size={16} />
                  <span>{t("scan.kind.receipt")}</span>
                </button>
                <button type="button" aria-pressed={scan.kind === "document"} onClick={() => setScanKind(doc, "document")} title={t("scan.kind.document")}>
                  <FileText aria-hidden size={16} />
                  <span>{t("scan.kind.document")}</span>
                </button>
              </div>
            )}
            <button type="button" className="secondary small" onClick={() => setSharing(true)}>
              <Share2 aria-hidden size={16} /> {t("list.share")}
            </button>
            <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={20} />}>
              {!readOnly && scan.ocr?.status !== "queued" && scan.ocr?.status !== "working" && <MenuItem onSelect={() => void readAgain()}>{t("scan.readAgain")}</MenuItem>}
              {role === "owner" ? (
                <MenuItem danger onSelect={() => void away("delete", t("scan.deleteConfirm"))}>
                  {t("scan.delete")}
                </MenuItem>
              ) : (
                <MenuItem danger onSelect={() => void away("leave", t("scan.leaveConfirm"))}>
                  {t("scan.leave")}
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
        <p className="memo-meta muted small-text">
          {when(scan.createdAt, t)} · {scan.pages.length === 1 ? t("scan.onePage") : t("scan.pages", { n: scan.pages.length })} · <ScanStatus scan={scan} detail />
        </p>
        {problem && <Problem>{problem}</Problem>}
      </div>

      {scan.kind === "receipt" && <ReceiptFields doc={doc} receipt={scan.receipt ?? {}} readOnly={readOnly} />}

      <ul className="scan-pages">
        {scan.pages.map((p, i) => (
          <li key={`${i}-${p.hash}`}>
            <button type="button" className="scan-page" onClick={() => setShown(p)} aria-label={t("scan.showPage", { n: i + 1 })}>
              <PageImage hash={p.hash} />
            </button>
          </li>
        ))}
      </ul>
      {scan.pdf && !isApp && <PdfLink hash={scan.pdf.hash} title={title} />}

      <section className="entry-section" aria-label={t("scan.text")}>
        <div className="entry-section-head">
          <h2>{t("scan.text")}</h2>
        </div>
        <MarkdownEditor text={scanText(doc)} awareness={awareness} readOnly={readOnly} toolbar={false} placeholder={t(scan.ocr && scan.ocr.status !== "done" ? "scan.textComing" : "scan.textPlaceholder")} label={t("scan.text")} />
      </section>

      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title })}>
        <ShareDialog id={id} />
      </Dialog>
      <Dialog open={!!shown} onClose={() => setShown(null)} title={title} wide>
        {shown && <PageImage hash={shown.hash} large />}
      </Dialog>
    </div>
  );
}

/** A receipt's shop, day and total: suggested from its text, kept as someone corrects them. */
function ReceiptFields({ doc, receipt, readOnly }: { doc: Y.Doc; receipt: ReceiptGuess & { edited?: boolean }; readOnly: boolean }) {
  const { t, lang } = useI18n();
  const [total, setTotal] = useState<string | null>(null);
  const shownTotal = total ?? (receipt.total !== undefined ? formatAmount(receipt.total, lang) : "");
  const commitTotal = () => {
    if (total === null) return;
    const v = parseAmount(total);
    if (total.trim() === "" || v !== null) setReceipt(doc, { total: total.trim() === "" ? undefined : v! });
    setTotal(null);
  };
  return (
    <div className="receipt card">
      <label className="field">
        <span>{t("receipt.shop")}</span>
        <input defaultValue={receipt.shop ?? ""} key={`shop-${receipt.shop}`} readOnly={readOnly} onBlur={(e) => e.target.value !== (receipt.shop ?? "") && setReceipt(doc, { shop: e.target.value.trim() })} />
      </label>
      <label className="field">
        <span>{t("receipt.date")}</span>
        <input type="date" value={receipt.date ?? ""} readOnly={readOnly} onChange={(e) => setReceipt(doc, { date: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("receipt.total")}</span>
        <input inputMode="decimal" value={shownTotal} readOnly={readOnly} onChange={(e) => setTotal(e.target.value)} onBlur={commitTotal} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      </label>
      <p className="muted small-text receipt-note">{t(receipt.edited ? "receipt.edited" : "receipt.suggested")}</p>
    </div>
  );
}

function PageImage({ hash, large = false }: { hash: string; large?: boolean }) {
  const { t } = useI18n();
  const url = useFileUrl(hash);
  if (url === null) return <span className="photo-missing small-text">{t("entry.photoMissing")}</span>;
  if (!url) return <span className="photo-missing" aria-hidden />;
  return <img src={url} alt="" className={large ? "photo-large" : undefined} loading="lazy" />;
}

function PdfLink({ hash, title }: { hash: string; title: string }) {
  const { t } = useI18n();
  const url = useFileUrl(hash);
  if (!url) return null;
  return (
    <a className="secondary small pdf-link" href={url} download={`${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "scan"}.pdf`}>
      <FileDown aria-hidden size={16} /> {t("scan.pdf")}
    </a>
  );
}
