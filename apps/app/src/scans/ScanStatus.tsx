import { AlertCircle, CheckCircle2, CloudUpload, Hourglass, Loader } from "lucide-react";
import type { ScanView } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useUploads } from "../lib/sync-react";

/** Where a scan is: its pages still going up, waiting for the worker, being read, read, or failed. */
export function ScanStatus({ scan, detail = false }: { scan: ScanView; detail?: boolean }) {
  const { t } = useI18n();
  const uploads = useUploads();
  const up = scan.pages.map((p) => uploads[p.hash]).filter(Boolean);
  if (up.length) {
    const size = up.reduce((n, u) => n + u!.size, 0);
    const got = up.reduce((n, u) => n + u!.received, 0);
    return (
      <span className="memo-status">
        <CloudUpload aria-hidden size={14} /> {up.some((u) => u!.waiting) ? t("memo.uploadWaiting") : t("memo.uploading", { pct: size ? Math.round((got / size) * 100) : 0 })}
      </span>
    );
  }
  const o = scan.ocr;
  if (!o) return null;
  if (o.status === "done")
    return detail ? (
      <span className="memo-status ok">
        <CheckCircle2 aria-hidden size={14} /> {t(scan.pdf ? "scan.doneWithPdf" : "memo.done")}
      </span>
    ) : null;
  if (o.status === "failed")
    return (
      <span className="memo-status bad" title={o.error}>
        <AlertCircle aria-hidden size={14} /> {t("scan.failed")}
        {detail && o.error ? `: ${o.error}` : ""}
      </span>
    );
  if (o.status === "working")
    return (
      <span className="memo-status busy">
        <Loader aria-hidden size={14} className="spin" /> {t("scan.working", { pct: Math.round((o.progress ?? 0) * 100) })}
      </span>
    );
  return (
    <span className="memo-status">
      {o.status === "wanted" ? <CloudUpload aria-hidden size={14} /> : <Hourglass aria-hidden size={14} />} {t(o.status === "wanted" ? "scan.wanted" : "scan.queued")}
    </span>
  );
}
