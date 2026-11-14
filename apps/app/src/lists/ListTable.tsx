import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type * as Y from "yjs";
import {
  addRow,
  canAddRows,
  canEditList,
  canEditRow,
  clearRow,
  isRowDone,
  MAX_ROWS,
  moveRow,
  removeRow,
  rowOwner,
  setCell,
  type ListView,
  type MemberRole,
  type Person,
} from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { Menu, MenuItem } from "../ui";
import { CellInput, TYPE_ICONS, usePersonName } from "./CellInput";

/**
 * A list as Hooden shows it: a table, every cell filled in right there as its column's kind says. With
 * automatic rows a new row waits last; filling in one of its cells adds the row. A row with all its
 * boxes ticked is struck through; someone else's row (with "own rows") can't be changed. Wide tables
 * scroll sideways, the row's number staying put.
 */
export function ListTable({ doc, list, role, me, people }: { doc: Y.Doc; list: ListView; role: MemberRole; me: number; people: Person[] }) {
  const { t } = useI18n();
  const name = usePersonName(people, me);
  const owner = canEditList(role);
  const mayAdd = canAddRows(role, list.settings) && list.rows.length < MAX_ROWS;
  // the new row is made again once something is added from it; after Enter, writing goes on in the same cell
  const [fresh, setFresh] = useState<{ n: number; focus: string | null }>({ n: 0, focus: null });

  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="list-table">
          <thead>
            <tr>
              <th scope="col" className="row-num">
                #
              </th>
              {list.columns.map((c) => {
                const Icon = TYPE_ICONS[c.type];
                return (
                  <th scope="col" key={c.id} className={`col-${c.type}`}>
                    <span className="col-head">
                      <Icon aria-hidden size={14} />
                      {c.name}
                    </span>
                  </th>
                );
              })}
              <th scope="col" className="row-actions">
                <span className="visually-hidden">{t("list.more")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r, i) => {
              const editable = canEditRow(role, list.settings, list.columns, r, me);
              const who = rowOwner(list.columns, r);
              const lockedBy = !editable && list.settings.ownRows && who !== null && who !== me ? t("row.locked", { name: name(who) }) : undefined;
              return (
                <tr key={r.id} className={isRowDone(list.columns, r) ? "done" : undefined} title={lockedBy}>
                  <th scope="row" className="row-num">
                    {i + 1}
                  </th>
                  {list.columns.map((c) => (
                    <td key={c.id} className={`col-${c.type}`}>
                      <CellInput col={c} value={r.cells[c.id]} editable={editable} onCommit={(v) => setCell(doc, r.id, c.id, v, me)} people={people} me={me} label={`${c.name}, ${t("row.menu", { n: i + 1 })}`} />
                    </td>
                  ))}
                  <td className="row-actions">
                    {(editable || owner) && (
                      <Menu label={t("row.menu", { n: i + 1 })} icon={<MoreHorizontal aria-hidden size={18} />}>
                        {editable && <MenuItem onSelect={() => clearRow(doc, r.id, me)}>{t("row.clear")}</MenuItem>}
                        {owner && (
                          <>
                            <MenuItem onSelect={() => moveRow(doc, r.id, i - 1)} disabled={i === 0}>
                              {t("row.up")}
                            </MenuItem>
                            <MenuItem onSelect={() => moveRow(doc, r.id, i + 1)} disabled={i === list.rows.length - 1}>
                              {t("row.down")}
                            </MenuItem>
                            <MenuItem danger onSelect={() => removeRow(doc, r.id)}>
                              {t("row.remove")}
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    )}
                  </td>
                </tr>
              );
            })}
            {mayAdd && list.settings.autoRows && (
              // (the new row isn't in the list until something is written in it: it's made fresh each time)
              <tr key={`new-${fresh.n}`} className="new-row">
                <th scope="row" className="row-num">
                  +
                </th>
                {list.columns.map((c) => (
                  <td key={c.id} className={`col-${c.type}`}>
                    <CellInput
                      col={c}
                      value={undefined}
                      editable
                      onCommit={(v, via) => {
                        if (v === null) return;
                        addRow(doc, { cells: { [c.id]: v }, by: me });
                        setFresh((f) => ({ n: f.n + 1, focus: via === "enter" ? c.id : null }));
                      }}
                      autoFocus={fresh.focus === c.id}
                      people={people}
                      me={me}
                      label={`${c.name}, ${t("list.newRow")}`}
                      placeholder={c === list.columns.find((x) => x.type === "text") ? t("list.addPlaceholder") : undefined}
                    />
                  </td>
                ))}
                <td className="row-actions" />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {mayAdd && !list.settings.autoRows && (
        <button type="button" className="secondary small add-row" onClick={() => addRow(doc, { by: me })}>
          {t("list.addRow")}
        </button>
      )}
    </div>
  );
}
