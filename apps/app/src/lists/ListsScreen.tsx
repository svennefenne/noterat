import { useState, type FormEvent } from "react";
import { Plus, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import { initList, isRowDone, objectDocName, readList, type MemberRole } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocValue, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { Dialog } from "../ui";
import { TEMPLATES } from "./templates";

/** The lists this person has, their own and the ones shared with them, newest first. */
export function ListsScreen() {
  const { t } = useI18n();
  const { homeLoaded } = useSyncState();
  const lists = useHomeItems().filter(([, item]) => item.type === "list");
  const [making, setMaking] = useState(false);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("lists.title")}</h1>
        <button type="button" className="primary small" onClick={() => setMaking(true)}>
          <Plus aria-hidden size={18} /> {t("lists.new")}
        </button>
      </div>
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : lists.length === 0 ? (
        <div className="empty">
          <p>{t("lists.empty")}</p>
          <button type="button" className="primary" onClick={() => setMaking(true)}>
            <Plus aria-hidden size={18} /> {t("lists.new")}
          </button>
        </div>
      ) : (
        <ul className="cards">
          {lists.map(([id, item]) => (
            <ListCard key={id} id={id} role={item.role} />
          ))}
        </ul>
      )}
      <Dialog open={making} onClose={() => setMaking(false)} title={t("new.title")}>
        <NewList onMade={() => setMaking(false)} />
      </Dialog>
    </div>
  );
}

function ListCard({ id, role }: { id: string; role: MemberRole }) {
  const { t } = useI18n();
  const { sync } = useSession();
  const list = useDocValue(sync.doc(objectDocName("list", id)), readList);
  const filled = list.rows.filter((r) => Object.keys(r.cells).length > 0);
  const checks = list.columns.some((c) => c.type === "check");
  const done = filled.filter((r) => isRowDone(list.columns, r)).length;
  const summary = filled.length === 0 ? t("lists.noRows") : checks ? t("lists.done", { done, n: filled.length }) : filled.length === 1 ? t("lists.oneRow") : t("lists.rows", { n: filled.length });
  return (
    <li>
      <Link href={`/lists/${id}`} className="card">
        <span className="card-title">{list.title || t("lists.untitled")}</span>
        <span className="card-meta">
          {summary}
          {role !== "owner" && (
            <span className="badge">
              <Users aria-hidden size={14} /> {t("lists.sharedWithYou")}
            </span>
          )}
        </span>
        {checks && filled.length > 0 && (
          <span className="progress" aria-hidden>
            <span style={{ width: `${(done / filled.length) * 100}%` }} />
          </span>
        )}
      </Link>
    </li>
  );
}

/** A new list from a template: made on this device at once, on the server once it's online. */
function NewList({ onMade }: { onMade: () => void }) {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const [, navigate] = useLocation();
  const [template, setTemplate] = useState(TEMPLATES[0]!);
  const [title, setTitle] = useState("");

  function make(e: FormEvent) {
    e.preventDefault();
    const id = sync.create("list", (doc) =>
      initList(doc, {
        title: title.trim() || t(template.name),
        columns: template.columns.map((c) => ({ name: t(c.name), type: c.type })),
        settings: template.settings,
        rows: template.rows,
        by: user.id,
      }),
    );
    onMade();
    navigate(`/lists/${id}`);
  }

  return (
    <form className="new-list" onSubmit={make}>
      <label className="field">
        <span>{t("new.name")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(template.name)} maxLength={120} data-autofocus />
      </label>
      <fieldset className="templates">
        <legend>{t("new.kind")}</legend>
        {TEMPLATES.map((tpl) => (
          <label key={tpl.id} className={tpl === template ? "template chosen" : "template"}>
            <input type="radio" name="template" checked={tpl === template} onChange={() => setTemplate(tpl)} />
            <span className="template-name">{t(tpl.name)}</span>
            <span className="template-hint">{t(tpl.hint)}</span>
          </label>
        ))}
      </fieldset>
      <div className="dialog-actions">
        <button type="submit" className="primary">
          {t("new.create")}
        </button>
      </div>
    </form>
  );
}
