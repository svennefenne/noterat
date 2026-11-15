import { useRef, useState, type ChangeEvent } from "react";
import { Camera, FileText, ImagePlus, Receipt, ScanLine, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import type * as Y from "yjs";
import { formatAmount, initScan, readScan, scanText, scanTitle, type ScanKind, type ScanView } from "@noterat/core";
import { useLinkedAction } from "../lib/deepLinks";
import { hashOf } from "../lib/files";
import { useI18n } from "../lib/i18n";
import { canScanOnPhone, photosAsPages, scanOnPhone, type ScannedPage } from "../lib/scanner";
import { useDocsValues, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { when } from "../memos/MemosScreen";
import { useFileUrl } from "../things/useFileUrl";
import { Problem } from "../ui";
import { ScanStatus } from "./ScanStatus";

const readCard = (doc: Y.Doc) => ({ scan: readScan(doc), text: scanText(doc).toString() });

/**
 * Documents and receipts: scan one (on the phone the scanner crops and straightens the page and reads
 * it at once; on the website a photo is enough, the worker does the rest), and every scan this person
 * has, newest first.
 */
export function ScansScreen() {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const { homeLoaded } = useSyncState();
  const [, navigate] = useLocation();
  const items = useHomeItems().filter(([, item]) => item.type === "scan");
  const docs = sync.docsOf("scan", items.map(([id]) => id));
  const cards = useDocsValues(docs, readCard);
  const scans = items.map(([id, item], i) => ({ id, shared: item.role !== "owner", ...cards[i]! })).sort((a, b) => b.scan.createdAt - a.scan.createdAt);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [kind, setKind] = useState<ScanKind>("receipt");
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const touch = canScanOnPhone || matchMedia("(pointer: coarse)").matches;

  async function keep(pages: ScannedPage[]) {
    if (!pages.length) return;
    const hashes = await Promise.all(pages.map((p) => hashOf(p.blob)));
    const id = sync.create("scan", (doc) =>
      initScan(doc, {
        kind,
        pages: pages.map((p, i) => ({ hash: hashes[i]!, type: "image/jpeg", width: p.width, height: p.height, cropped: p.cropped })),
        text: pages
          .map((p) => p.text.trim())
          .filter(Boolean)
          .join("\n\n"),
        read: true,
        by: user.id,
      }),
    );
    // (the pages on the device before the scan's page shows them)
    for (const p of pages) await sync.files.add(p.blob, id);
    navigate(`/scans/${id}`);
  }

  async function scan(take: () => Promise<ScannedPage[]>) {
    setProblem("");
    setBusy(true);
    try {
      await keep(await take());
    } catch {
      setProblem(t("scans.failed"));
    } finally {
      setBusy(false);
    }
  }

  // "Scan" from the home screen (?scan=1): the scanner opens as its button opens it. (Only on the phone,
  // where those links come from: the website's buttons open a file picker, which a browser opens only
  // for a tap.)
  useLinkedAction("scan", () => {
    if (canScanOnPhone && !busy) void scan(scanOnPhone);
  });

  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length) void scan(() => photosAsPages(files));
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("scans.title")}</h1>
      </div>
      <section className="scanner" aria-label={t("scans.scan")}>
        <div className="segmented" role="group" aria-label={t("scans.kind")}>
          <button type="button" aria-pressed={kind === "receipt"} onClick={() => setKind("receipt")}>
            <Receipt aria-hidden size={16} />
            <span>{t("scan.kind.receipt")}</span>
          </button>
          <button type="button" aria-pressed={kind === "document"} onClick={() => setKind("document")}>
            <FileText aria-hidden size={16} />
            <span>{t("scan.kind.document")}</span>
          </button>
        </div>
        <div className="scanner-actions">
          {canScanOnPhone ? (
            <button type="button" className="primary scan-button" disabled={busy} onClick={() => void scan(scanOnPhone)}>
              <ScanLine aria-hidden size={22} /> {busy ? t("scans.busy") : t("scans.scan")}
            </button>
          ) : (
            <>
              {touch && (
                <button type="button" className="primary scan-button" disabled={busy} onClick={() => camera.current?.click()}>
                  <Camera aria-hidden size={22} /> {busy ? t("scans.busy") : t("scans.photo")}
                </button>
              )}
              <button type="button" className={touch ? "secondary" : "primary scan-button"} disabled={busy} onClick={() => picker.current?.click()}>
                <ImagePlus aria-hidden size={20} /> {t("scans.pick")}
              </button>
              <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
              <input ref={picker} type="file" accept="image/*" multiple hidden onChange={picked} />
            </>
          )}
        </div>
        <p className="muted small-text">{t(canScanOnPhone ? "scans.hintPhone" : "scans.hintWeb")}</p>
        {problem && <Problem>{problem}</Problem>}
      </section>
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : scans.length === 0 ? (
        <p className="muted empty-line">{t("scans.empty")}</p>
      ) : (
        <ul className="cards">
          {scans.map((s) => (
            <ScanCard key={s.id} id={s.id} scan={s.scan} text={s.text} shared={s.shared} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScanCard({ id, scan, text, shared }: { id: string; scan: ScanView; text: string; shared: boolean }) {
  const { t, lang } = useI18n();
  const r = scan.receipt;
  return (
    <li>
      <Link href={`/scans/${id}`} className="card scan-card">
        {scan.pages[0] && <PageThumb hash={scan.pages[0].hash} />}
        <span className="scan-card-main">
          <span className="card-title">{scanTitle(scan, text) || t(`scan.kind.${scan.kind}`)}</span>
          <span className="card-meta">
            {scan.kind === "receipt" && r?.total !== undefined && <strong>{formatAmount(r.total, lang)} kr</strong>}
            <span>{scan.kind === "receipt" && r?.date ? r.date : when(scan.createdAt, t)}</span>
            {scan.pages.length > 1 && <span>{t("scan.pages", { n: scan.pages.length })}</span>}
            <ScanStatus scan={scan} />
            {shared && (
              <span className="badge">
                <Users aria-hidden size={14} /> {t("lists.sharedWithYou")}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function PageThumb({ hash }: { hash: string }) {
  const url = useFileUrl(hash);
  return url ? <img className="scan-thumb" src={url} alt="" /> : <span className="scan-thumb empty" aria-hidden />;
}
