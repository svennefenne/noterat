import { useState } from "react";
import { ArrowLeft, List as ListIcon, MoreVertical, Share2, Table2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { canEditList, canFill, clearList, objectDocName, readList, removeDone, type MemberRole } from "@noterat/core";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocValue, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { Dialog, Menu, MenuItem, Problem, useStored } from "../ui";
import { ColumnEditor } from "./ColumnEditor";
import { ListChecklist } from "./ListChecklist";
import { ListTable } from "./ListTable";
import { ShareDialog } from "./ShareDialog";
import { useMembers } from "./useMembers";

/** A list's page: only for a list this person has (one in their home document). */
export function ListScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { homeLoaded } = useSyncState();
  const item = useHomeItems().find(([i]) => i === id)?.[1];
  if (!homeLoaded) return <p className="muted">{t("lists.loading")}</p>;
  if (!item || item.type !== "list")
    return (
      <div className="screen">
        <Link href="/" className="back">
          <ArrowLeft aria-hidden size={18} /> {t("list.back")}
        </Link>
        <p className="notice">{t("list.notFound")}</p>
      </div>
    );
  return <ListPage id={id} role={item.role} />;
}

function ListPage({ id, role }: { id: string; role: MemberRole }) {
  const { t, errorText } = useI18n();
  const { sync, user, api } = useSession();
  useSyncState();
  const [, navigate] = useLocation();
  const name = objectDocName("list", id);
  const doc = sync.doc(name);
  const list = useDocValue(doc, readList);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState("");
  const [shared, setShared] = useState(0);
  const people = useMembers(id, shared);
  const checklist = list.columns.some((c) => c.type === "check") && list.columns.some((c) => c.type === "text");
  const [view, setView] = useStored<"checklist" | "table">(`noterat.view.${id}`, "checklist");
  const shown = checklist ? view : "table";
  const owner = canEditList(role);
  const title = list.title || t("lists.untitled");

  async function away(f: () => Promise<unknown>, question: string) {
    if (!confirm(question)) return;
    try {
      await f();
    } catch (err) {
      // (made offline and never synced: no one else has it, so it simply goes from this device)
      if (!(err instanceof ApiError && err.code === "not_synced")) return setProblem(err instanceof ApiError && err.code === "network" ? t("list.needsOnline") : errorText(err));
    }
    sync.drop(id);
    navigate("/");
  }

  if (!sync.isLoaded(name)) return <p className="muted">{t("lists.loading")}</p>;

  return (
    <div className="screen list-screen">
      <div className="list-head">
        <Link href="/" className="back">
          <ArrowLeft aria-hidden size={18} /> {t("list.back")}
        </Link>
        <div className="list-title-row">
          <h1>{title}</h1>
          <div className="list-actions">
            {checklist && (
              <div className="segmented" role="group" aria-label={t("list.viewTable")}>
                <button type="button" aria-pressed={shown === "checklist"} onClick={() => setView("checklist")} title={t("list.viewChecklist")}>
                  <ListIcon aria-hidden size={16} />
                  <span>{t("list.viewChecklist")}</span>
                </button>
                <button type="button" aria-pressed={shown === "table"} onClick={() => setView("table")} title={t("list.viewTable")}>
                  <Table2 aria-hidden size={16} />
                  <span>{t("list.viewTable")}</span>
                </button>
              </div>
            )}
            <button type="button" className="secondary small" onClick={() => setSharing(true)}>
              <Share2 aria-hidden size={16} /> {t("list.share")}
            </button>
            <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={20} />}>
              {owner && <MenuItem onSelect={() => setEditing(true)}>{t("list.editColumns")}</MenuItem>}
              {canFill(role, list.settings) && <MenuItem onSelect={() => removeDone(doc)}>{t("list.removeDone")}</MenuItem>}
              {owner && <MenuItem onSelect={() => confirm(t("list.clearConfirm")) && clearList(doc)}>{t("list.clear")}</MenuItem>}
              {owner ? (
                <MenuItem danger onSelect={() => void away(() => api.deleteObject(id), t("list.deleteConfirm"))}>
                  {t("list.delete")}
                </MenuItem>
              ) : (
                <MenuItem danger onSelect={() => void away(() => api.removeMember(id, user.id), t("list.leaveConfirm"))}>
                  {t("list.leave")}
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
        {role === "viewer" && <p className="muted small-text">{t("list.readOnly")}</p>}
        {role === "editor" && list.settings.fill === "owner" && <p className="muted small-text">{t("list.ownerFills")}</p>}
        {problem && <Problem>{problem}</Problem>}
      </div>

      {shown === "checklist" ? <ListChecklist doc={doc} list={list} role={role} me={user.id} people={people} /> : <ListTable doc={doc} list={list} role={role} me={user.id} people={people} />}

      <Dialog
        open={sharing}
        onClose={() => {
          setSharing(false);
          setShared((n) => n + 1);
        }}
        title={t("share.title", { title })}
      >
        <ShareDialog id={id} />
      </Dialog>
      <Dialog open={editing} onClose={() => setEditing(false)} title={t("editor.title")} wide>
        <ColumnEditor doc={doc} list={list} onDone={() => setEditing(false)} />
      </Dialog>
    </div>
  );
}
