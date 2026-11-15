import { useState } from "react";
import { ArrowRightLeft, MoreVertical, Share2 } from "lucide-react";
import type * as Y from "yjs";
import { memoText, memoTitle, objectDocName, readMemo, setMemoTitle, type MemberRole } from "@noterat/core";
import { ApiError } from "../lib/api";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useDocValue, useSession, useSyncState, useUploads } from "../lib/sync-react";
import { MarkdownEditor } from "../notes/LazyEditor";
import { TitleInput } from "../notes/NoteScreen";
import { Back, NotHere, useAway, usePresence, useThing } from "../things/parts";
import { ShareDialog } from "../things/ShareDialog";
import { Dialog, Menu, MenuItem, Problem } from "../ui";
import { when } from "./MemosScreen";
import { MoveDialog } from "./MoveDialog";
import { clock, MemoStatus, Player } from "./parts";

const readText = (doc: Y.Doc) => memoText(doc).toString();

/** A voice memo's page: only for a memo this person has. */
export function MemoScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { loading, role } = useThing("memo", id);
  if (loading) return <p className="muted">{t("lists.loading")}</p>;
  if (!role) return <NotHere type="memo" />;
  return <MemoPage id={id} role={role} />;
}

function MemoPage({ id, role }: { id: string; role: MemberRole }) {
  const { t, errorText } = useI18n();
  const dates = useDates();
  const { sync, api } = useSession();
  useSyncState();
  const name = objectDocName("memo", id);
  const doc = sync.doc(name);
  const memo = useDocValue(doc, readMemo);
  const text = useDocValue(doc, readText);
  const uploads = useUploads();
  const [sharing, setSharing] = useState(false);
  const [moving, setMoving] = useState(false);
  const { away, problem, setProblem } = useAway("memo", id);
  const readOnly = role === "viewer";
  const awareness = sync.awareness(name);
  usePresence(awareness);
  const title = memoTitle(memo, text) || when(memo.createdAt, t, dates);
  const status = memo.transcription?.status;
  const uploading = !!(memo.audio && uploads[memo.audio.hash]);

  async function transcribe() {
    setProblem("");
    try {
      await api.transcribe(id);
    } catch (err) {
      setProblem(err instanceof ApiError && err.code === "network" ? t("list.needsOnline") : errorText(err));
    }
  }

  if (!sync.isLoaded(name)) return <p className="muted">{t("lists.loading")}</p>;

  return (
    <div className="screen memo-screen">
      <div className="list-head">
        <Back type="memo" />
        <div className="list-title-row">
          <TitleInput value={memo.title} placeholder={title} readOnly={readOnly} onCommit={(v) => setMemoTitle(doc, v)} />
          <div className="list-actions">
            <button type="button" className="primary small" onClick={() => setMoving(true)} disabled={!text.trim() && !memo.audio}>
              <ArrowRightLeft aria-hidden size={16} /> {t("memo.move")}
            </button>
            <button type="button" className="secondary small" onClick={() => setSharing(true)}>
              <Share2 aria-hidden size={16} /> {t("list.share")}
            </button>
            <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={20} />}>
              {!readOnly && !uploading && status !== "queued" && status !== "working" && (
                <MenuItem onSelect={() => void transcribe()}>{status === "done" || status === "failed" ? t("memo.again") : t("memo.transcribe")}</MenuItem>
              )}
              {role === "owner" ? (
                <MenuItem danger onSelect={() => void away("delete", t("memo.deleteConfirm"))}>
                  {t("memo.delete")}
                </MenuItem>
              ) : (
                <MenuItem danger onSelect={() => void away("leave", t("memo.leaveConfirm"))}>
                  {t("memo.leave")}
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
        <p className="memo-meta muted small-text">
          {when(memo.createdAt, t, dates)}
          {memo.audio && ` · ${clock(memo.audio.duration)}`}
        </p>
        {problem && <Problem>{problem}</Problem>}
      </div>

      {memo.audio && <Player hash={memo.audio.hash} />}
      <div className="memo-transcript">
        <div className="memo-transcript-head">
          <h2>{t("memo.text")}</h2>
          <MemoStatus memo={memo} detail />
        </div>
        {memo.transcription?.status === "working" && (
          <span className="progress" aria-hidden>
            <span style={{ width: `${Math.round((memo.transcription.progress ?? 0) * 100)}%` }} />
          </span>
        )}
        <MarkdownEditor text={memoText(doc)} awareness={awareness} readOnly={readOnly} toolbar={false} placeholder={t(status ? "memo.textComing" : "memo.textPlaceholder")} label={t("memo.text")} />
      </div>

      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title })}>
        <ShareDialog id={id} />
      </Dialog>
      <Dialog open={moving} onClose={() => setMoving(false)} title={t("move.title")}>
        <MoveDialog memoId={id} title={memo.title} text={text} owner={role === "owner"} onDone={() => setMoving(false)} />
      </Dialog>
    </div>
  );
}
