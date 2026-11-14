import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CloudUpload, Hourglass, Loader } from "lucide-react";
import type { MemoView, TranscriberInfo } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useSession, useUploads } from "../lib/sync-react";

/** 75 → "1:15" */
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/**
 * Where a memo is on its way to text: its recording still on the device (waiting for a connection, or
 * going up), waiting for the transcriber, being transcribed, done, or failed.
 */
export function MemoStatus({ memo, detail = false }: { memo: MemoView; detail?: boolean }) {
  const { t } = useI18n();
  const uploads = useUploads();
  const up = memo.audio ? uploads[memo.audio.hash] : undefined;
  const tr = memo.transcription;
  const transcriber = useTranscriber(detail && tr?.status === "queued");

  if (up) {
    const pct = up.size ? Math.round((up.received / up.size) * 100) : 0;
    return (
      <span className="memo-status">
        <CloudUpload aria-hidden size={14} /> {up.waiting ? t("memo.uploadWaiting") : t("memo.uploading", { pct })}
      </span>
    );
  }
  if (!tr) return null;
  if (tr.status === "done")
    return detail ? (
      <span className="memo-status ok">
        <CheckCircle2 aria-hidden size={14} /> {t("memo.done")}
      </span>
    ) : null;
  if (tr.status === "failed")
    return (
      <span className="memo-status bad" title={tr.error}>
        <AlertCircle aria-hidden size={14} /> {t("memo.failed")}
        {detail && tr.error ? `: ${tr.error}` : ""}
      </span>
    );
  if (tr.status === "working")
    return (
      <span className="memo-status busy">
        <Loader aria-hidden size={14} className="spin" /> {t("memo.working", { pct: Math.round((tr.progress ?? 0) * 100) })}
      </span>
    );
  // (recorded on another device, which hasn't uploaded it yet)
  if (tr.status === "wanted")
    return (
      <span className="memo-status">
        <CloudUpload aria-hidden size={14} /> {t("memo.wanted")}
      </span>
    );
  return (
    <span className="memo-status">
      <Hourglass aria-hidden size={14} /> {t("memo.queued")}
      {transcriber && transcriber.state !== "online" && <span className="muted"> · {t(transcriber.state === "none" ? "memo.noTranscriber" : "memo.transcriberAway")}</span>}
    </span>
  );
}

/** Whether the server's transcriber is there (asked when it matters, and again now and then). */
function useTranscriber(ask: boolean): TranscriberInfo | null {
  const { api } = useSession();
  const [info, setInfo] = useState<TranscriberInfo | null>(null);
  useEffect(() => {
    if (!ask) return;
    let on = true;
    const get = () =>
      void api
        .transcriber()
        .then((i) => on && setInfo(i))
        .catch(() => {});
    get();
    const timer = setInterval(get, 30_000);
    return () => {
      on = false;
      clearInterval(timer);
    };
  }, [ask, api]);
  return ask ? info : null;
}

/** A memo's recording, played from the device (fetched from the server the first time, if it's someone else's). */
export function Player({ hash }: { hash: string }) {
  const { t } = useI18n();
  const { sync } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let made: string | null = null;
    let on = true;
    void sync.files.get(hash).then((blob) => {
      if (!on) return;
      if (!blob) return setMissing(true);
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      on = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [hash, sync]);
  if (missing) return <p className="muted small-text">{t("memo.noAudio")}</p>;
  if (!url) return <p className="muted small-text">{t("lists.loading")}</p>;
  return <audio className="player" controls preload="metadata" src={url} />;
}
