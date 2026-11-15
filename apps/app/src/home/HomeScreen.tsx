import { type ReactNode } from "react";
import { Link } from "wouter";
import { BookHeart, CalendarDays, ChefHat, ChevronRight, ListChecks, Mic, NotebookPen, ScanLine, Settings2, Wallet } from "lucide-react";
import type * as Y from "yjs";
import {
  balances,
  entryBody,
  entryPreview,
  entryTitle,
  formatAmount,
  isRowDone,
  memoText,
  memoTitle,
  monthSummary,
  noteBody,
  notePreview,
  noteTitle,
  occurrences,
  readBudget,
  readCalendar,
  readEntry,
  readList,
  readMemo,
  readNote,
  readRecipe,
  readScan,
  readSplit,
  recipeIngredients,
  recipeTitle,
  scanText,
  scanTitle,
  splitTotal,
  wallOf,
  type HomeSection,
  type ObjectType,
} from "@noterat/core";
import { useDates } from "../lib/dates";
import { useHousehold } from "../lib/household";
import { useI18n, type TextKey } from "../lib/i18n";
import { useDocsValues, useHomeItems, useLock, useSession, useSyncState } from "../lib/sync-react";
import { SECTION } from "../lib/things";
import { dayName } from "../journal/JournalScreen";
import { clock } from "../memos/parts";
import { when } from "../memos/MemosScreen";
import { PageThumb } from "../scans/ScansScreen";
import { useStored } from "../ui";

/**
 * The start page (decision 15): the latest of each section, in the order and number the household's
 * admin set; what's coming up in the calendar. The journal and money only when the household says so,
 * and the journal not while it's locked. Read from what's on the device, so it's there offline too.
 */

const ICON = { calendar: CalendarDays, list: ListChecks, note: NotebookPen, memo: Mic, scan: ScanLine, recipe: ChefHat, journal: BookHeart, money: Wallet } as const;
const PATH: Record<HomeSection, string> = { calendar: SECTION.calendar, list: SECTION.list, note: SECTION.note, memo: SECTION.memo, scan: SECTION.scan, recipe: SECTION.recipe, journal: SECTION.journal, money: "/budget" };

export function HomeScreen() {
  const { t } = useI18n();
  const { user, lock } = useSession();
  useLock();
  const { household } = useHousehold();
  const { homeLoaded } = useSyncState();
  const dates = useDates();
  const hour = new Date().getHours();
  const greeting = t(hour < 10 ? "home.morning" : hour < 18 ? "home.day" : "home.evening", { name: user.displayName.split(" ")[0] || user.displayName });
  const sections = household.home.sections.filter((s) => s.show && !(s.type === "journal" && lock.hides("journal")));

  return (
    <div className="screen home-screen">
      <div className="home-head">
        <div>
          <h1>{greeting}</h1>
          <p className="muted home-today">{dates.day(new Date(), { weekday: true, long: true })}</p>
        </div>
        {user.role === "admin" && (
          <Link href="/admin/home" className="icon-button" aria-label={t("home.setUp")} title={t("home.setUp")}>
            <Settings2 aria-hidden size={20} />
          </Link>
        )}
      </div>
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : sections.length === 0 ? (
        <p className="muted">{t("home.nothing")}</p>
      ) : (
        <div className="home-grid">
          {sections.map((s) => (
            <HomeCard key={s.type} type={s.type} count={s.count} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A section's card: its name (to the section), then its latest, or a line saying there's none. */
function HomeCard({ type, count }: { type: HomeSection; count: number }) {
  const { t } = useI18n();
  const Icon = ICON[type];
  const Body = BODIES[type];
  return (
    <section className="home-card" aria-labelledby={`home-${type}`}>
      <Link href={PATH[type]} className="home-card-head">
        <Icon aria-hidden size={18} />
        <h2 id={`home-${type}`}>{t(`home.section.${type}` as TextKey)}</h2>
        <ChevronRight aria-hidden size={16} className="home-card-more" />
      </Link>
      <Body count={count} />
    </section>
  );
}

function Items({ children }: { children: ReactNode[] }) {
  return <ul className="home-items">{children}</ul>;
}

function Item({ href, title, meta, lead }: { href: string; title: ReactNode; meta?: ReactNode; lead?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="home-item">
        {lead}
        <span className="home-item-main">
          <span className="home-item-title">{title}</span>
          {meta && <span className="home-item-meta">{meta}</span>}
        </span>
      </Link>
    </li>
  );
}

function Empty({ type }: { type: HomeSection }) {
  const { t } = useI18n();
  return (
    <p className="muted small-text home-empty">
      {t(`home.empty.${type}` as TextKey)}{" "}
      <Link href={PATH[type]}>{t("home.go")}</Link>
    </p>
  );
}

/** the documents of one kind this person has, as read by `read` (a function that stays the same) */
function useThings<T>(type: ObjectType, read: (doc: Y.Doc) => T) {
  const { sync } = useSession();
  const items = useHomeItems().filter(([, i]) => i.type === type);
  const docs = sync.docsOf(type, items.map(([id]) => id));
  const values = useDocsValues(docs, read);
  return items.map(([id, item], i) => ({ id, addedAt: item.addedAt, ...values[i]! }));
}

// ───────────── the sections ─────────────

const readCal = (doc: Y.Doc) => ({ cal: readCalendar(doc) });

/** What's coming: the next events, today and the two weeks after, in every calendar shown. */
function CalendarBody({ count }: { count: number }) {
  const { t } = useI18n();
  const dates = useDates();
  const cals = useThings("calendar", readCal);
  const [hidden] = useStored<string>("noterat.calendar.hidden", "");
  const hide = new Set(hidden.split(",").filter(Boolean));
  const now = wallOf(new Date(), false);
  const today = now.slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() + 14);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const next = cals
    .filter((c) => !hide.has(c.id))
    .flatMap((c) => occurrences(c.id, c.cal.events, today, wallOf(end, true)).map((o) => ({ ...o, color: c.cal.color })))
    .filter((o) => (o.event.allDay ? o.end.slice(0, 10) >= today : o.end > now))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, count);
  if (!next.length) return <Empty type="calendar" />;
  const day = (d: string) => (d === today ? t("home.today") : d === wallOf(tomorrow, true) ? t("home.tomorrow") : dates.day(d, { weekday: true }));
  return (
    <Items>
      {next.map((o) => (
        <Item
          key={`${o.calendarId}:${o.event.id}:${o.start}`}
          href={PATH.calendar}
          lead={<span className="home-dot" style={{ background: o.color }} aria-hidden />}
          title={o.event.title || t("calendar.untitled")}
          meta={o.event.allDay ? `${day(o.start.slice(0, 10))} · ${t("calendar.allDay")}` : `${day(o.start.slice(0, 10))} ${dates.time(o.start)}`}
        />
      ))}
    </Items>
  );
}

const readListCard = (doc: Y.Doc) => {
  const list = readList(doc);
  const filled = list.rows.filter((r) => Object.keys(r.cells).length > 0);
  return {
    title: list.title,
    filled: filled.length,
    checks: list.columns.some((c) => c.type === "check"),
    done: filled.filter((r) => isRowDone(list.columns, r)).length,
    changed: Math.max(0, ...list.rows.map((r) => r.updatedAt ?? 0)),
  };
};

/** The lists changed last, with how far along they are. */
function ListBody({ count }: { count: number }) {
  const { t } = useI18n();
  const lists = useThings("list", readListCard)
    .sort((a, b) => Math.max(b.changed, b.addedAt) - Math.max(a.changed, a.addedAt))
    .slice(0, count);
  if (!lists.length) return <Empty type="list" />;
  return (
    <Items>
      {lists.map((l) => (
        <Item
          key={l.id}
          href={`/lists/${l.id}`}
          title={l.title || t("lists.untitled")}
          meta={l.filled === 0 ? t("lists.noRows") : l.checks ? t("lists.done", { done: l.done, n: l.filled }) : l.filled === 1 ? t("lists.oneRow") : t("lists.rows", { n: l.filled })}
        />
      ))}
    </Items>
  );
}

const readNoteCard = (doc: Y.Doc) => {
  const note = readNote(doc);
  const body = noteBody(doc).toString();
  return { title: noteTitle(note, body), preview: notePreview(note, body), at: note.updatedAt };
};

/** The notes changed last, with their first lines. */
function NoteBody({ count }: { count: number }) {
  const { t } = useI18n();
  const dates = useDates();
  const notes = useThings("note", readNoteCard)
    .sort((a, b) => b.at - a.at)
    .slice(0, count);
  if (!notes.length) return <Empty type="note" />;
  return (
    <Items>
      {notes.map((n) => (
        <Item
          key={n.id}
          href={`/notes/${n.id}`}
          title={n.title || t("notes.untitled")}
          meta={
            <>
              {dates.day(new Date(n.at))}
              {n.preview && <span className="home-preview"> · {n.preview}</span>}
            </>
          }
        />
      ))}
    </Items>
  );
}

const readMemoCard = (doc: Y.Doc) => {
  const memo = readMemo(doc);
  return { memo, title: memoTitle(memo, memoText(doc).toString()) };
};

/** The latest voice memos, how long they are and when. */
function MemoBody({ count }: { count: number }) {
  const { t } = useI18n();
  const dates = useDates();
  const memos = useThings("memo", readMemoCard)
    .sort((a, b) => b.memo.createdAt - a.memo.createdAt)
    .slice(0, count);
  if (!memos.length) return <Empty type="memo" />;
  return (
    <Items>
      {memos.map((m) => (
        <Item
          key={m.id}
          href={`/memos/${m.id}`}
          title={m.title || when(m.memo.createdAt, t, dates)}
          meta={[m.title ? when(m.memo.createdAt, t, dates) : "", m.memo.audio ? clock(m.memo.audio.duration) : ""].filter(Boolean).join(" · ")}
        />
      ))}
    </Items>
  );
}

const readScanCard = (doc: Y.Doc) => {
  const scan = readScan(doc);
  return { scan, title: scanTitle(scan, scanText(doc).toString()) };
};

/** The latest scans, with a look at their first page and a receipt's total. */
function ScanBody({ count }: { count: number }) {
  const { t, lang } = useI18n();
  const dates = useDates();
  const scans = useThings("scan", readScanCard)
    .sort((a, b) => b.scan.createdAt - a.scan.createdAt)
    .slice(0, count);
  if (!scans.length) return <Empty type="scan" />;
  return (
    <Items>
      {scans.map((s) => (
        <Item
          key={s.id}
          href={`/scans/${s.id}`}
          lead={s.scan.pages[0] ? <PageThumb hash={s.scan.pages[0].hash} /> : undefined}
          title={s.title || t(`scan.kind.${s.scan.kind}`)}
          meta={[s.scan.receipt?.total !== undefined ? `${formatAmount(s.scan.receipt.total, lang)} kr` : "", when(s.scan.createdAt, t, dates)].filter(Boolean).join(" · ")}
        />
      ))}
    </Items>
  );
}

const readRecipeCard = (doc: Y.Doc) => {
  const r = readRecipe(doc);
  return { title: recipeTitle(r, recipeIngredients(doc).toString()), minutes: r.minutes, at: r.createdAt };
};

/** The recipes added last. */
function RecipeBody({ count }: { count: number }) {
  const { t } = useI18n();
  const dates = useDates();
  const recipes = useThings("recipe", readRecipeCard)
    .sort((a, b) => b.at - a.at)
    .slice(0, count);
  if (!recipes.length) return <Empty type="recipe" />;
  return (
    <Items>
      {recipes.map((r) => (
        <Item
          key={r.id}
          href={`/recipes/${r.id}`}
          title={r.title || t("untitled.recipe")}
          meta={[r.minutes ? t("home.minutes", { n: r.minutes }) : "", t("home.added", { when: dates.day(new Date(r.at)) })].filter(Boolean).join(" · ")}
        />
      ))}
    </Items>
  );
}

const readEntryCard = (doc: Y.Doc) => {
  const entry = readEntry(doc);
  const body = entryBody(doc).toString();
  return { entry, title: entryTitle(entry, body), preview: entryPreview(entry, body) };
};

/** The latest journal entries (only when the household shows the journal here). */
function JournalBody({ count }: { count: number }) {
  const dates = useDates();
  const entries = useThings("journal", readEntryCard)
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.entry.createdAt - a.entry.createdAt)
    .slice(0, count);
  if (!entries.length) return <Empty type="journal" />;
  return (
    <Items>
      {entries.map((e) => (
        <Item
          key={e.id}
          href={`/journal/${e.id}`}
          title={e.title || dayName(e.entry.date, dates)}
          meta={
            <>
              {e.title ? dayName(e.entry.date, dates) : ""}
              {e.preview && (
                <span className="home-preview">
                  {e.title ? " · " : ""}
                  {e.preview}
                </span>
              )}
            </>
          }
        />
      ))}
    </Items>
  );
}

const readBudgetCard = (doc: Y.Doc) => {
  const v = readBudget(doc);
  return { title: v.title, sum: monthSummary(v, wallOf(new Date(), true).slice(0, 7)) };
};
const readSplitCard = (doc: Y.Doc) => {
  const v = readSplit(doc);
  return { title: v.title, total: splitTotal(v), people: v.people, balances: balances(v) };
};

/** This month in the budgets, and where someone stands in the shared costs (only when the household shows money here). */
function MoneyBody({ count }: { count: number }) {
  const { t, lang } = useI18n();
  const { user } = useSession();
  const dates = useDates();
  const budgets = useThings("budget", readBudgetCard).map((b) => ({ ...b, kind: "budget" as const }));
  const splits = useThings("split", readSplitCard).map((s) => ({ ...s, kind: "split" as const }));
  const all = [...budgets, ...splits].sort((a, b) => b.addedAt - a.addedAt).slice(0, count);
  if (!all.length) return <Empty type="money" />;
  const month = dates.month(new Date());
  return (
    <Items>
      {all.map((m) => {
        if (m.kind === "budget")
          return (
            <Item
              key={m.id}
              href={`/budget/${m.id}`}
              title={m.title || t("untitled.budget")}
              meta={
                m.sum.planned > 0
                  ? t("home.budgetOf", { spent: formatAmount(m.sum.spending, lang), planned: formatAmount(m.sum.planned, lang), month })
                  : t("home.budgetSpent", { spent: formatAmount(m.sum.spending, lang), month })
              }
            />
          );
        const me = m.people.find((p) => p.userId === user.id);
        const net = me ? (m.balances.find((b) => b.person.id === me.id)?.net ?? 0) : 0;
        return (
          <Item
            key={m.id}
            href={`/budget/splits/${m.id}`}
            title={m.title || t("untitled.split")}
            meta={[`${formatAmount(m.total, lang)} kr`, me ? (net > 0 ? t("split.part.gets", { amount: formatAmount(net, lang) }) : net < 0 ? t("split.part.pays", { amount: formatAmount(-net, lang) }) : t("split.part.even")) : ""]
              .filter(Boolean)
              .join(" · ")}
          />
        );
      })}
    </Items>
  );
}

const BODIES: Record<HomeSection, (p: { count: number }) => ReactNode> = {
  calendar: CalendarBody,
  list: ListBody,
  note: NoteBody,
  memo: MemoBody,
  scan: ScanBody,
  recipe: RecipeBody,
  journal: JournalBody,
  money: MoneyBody,
};
