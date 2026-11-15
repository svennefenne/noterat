import { useEffect, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Eye, EyeOff, Link2, MoreVertical, Plus, RefreshCw, Rss, Smartphone, Users } from "lucide-react";
import type * as Y from "yjs";
import { CALENDAR_COLORS, initCalendar, occurrences, readCalendar, wallOf, type CalendarView, type MemberRole, type Occurrence } from "@noterat/core";
import { ApiError } from "../lib/api";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { canReadPhone, phoneAccess, phoneCalendars, phoneEvents, type PhoneCalendar } from "../lib/phoneCalendars";
import { useDocsValues, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { ShareDialog } from "../things/ShareDialog";
import { useAway } from "../things/parts";
import { Dialog, Menu, MenuItem, Problem, useStored } from "../ui";
import { EventDialog, type Editing } from "./EventDialog";

export interface Cal {
  id: string;
  doc: Y.Doc | null;
  view: CalendarView;
  role: MemberRole | "phone";
}

const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return wallOf(d, true);
};

/**
 * The calendar (decision 10): a month, every calendar this person has (their own, shared ones such as
 * the family's, subscriptions, and on the phone the phone's own) in its colour, and the day picked.
 */
export function CalendarScreen() {
  const { t } = useI18n();
  const dates = useDates();
  const timeOf = dates.time;
  const { sync, user } = useSession();
  const { homeLoaded } = useSyncState();
  const items = useHomeItems().filter(([, i]) => i.type === "calendar");
  const docs = sync.docsOf("calendar", items.map(([id]) => id));
  const views = useDocsValues(docs, readCalendar);
  const [hidden, setHidden] = useStored<string>("noterat.calendar.hidden", "");
  const [phoneOn, setPhoneOn] = useStored<"on" | "off">("noterat.calendar.phone", "off");
  const today = wallOf(new Date(), true);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState(today);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState<"new" | "subscribe" | null>(null);
  const [feed, setFeed] = useState(false);
  const [phone, setPhone] = useState<{ cals: PhoneCalendar[]; events: Map<string, Cal["view"]["events"]> } | null>(null);

  const own: Cal[] = items.map(([id, item], i) => ({ id, doc: docs[i]!, view: views[i]!, role: item.role }));
  const hide = new Set(hidden.split(",").filter(Boolean));

  // the month on screen, with a week either side
  const first = `${month}-01`;
  // (weeks start on the household's first day: Monday, or Sunday)
  const lead = dates.weekIndex(new Date(`${first}T12:00:00`));
  const gridStart = addDays(first, -lead);
  const gridEnd = addDays(gridStart, 41);

  // the phone's calendars, for the month on screen
  useEffect(() => {
    if (!canReadPhone || phoneOn !== "on") return;
    let on = true;
    void (async () => {
      if (!(await phoneAccess(false))) return;
      const [cals, events] = await Promise.all([phoneCalendars(), phoneEvents(gridStart, gridEnd)]);
      if (on) setPhone({ cals, events });
    })().catch(() => {});
    return () => {
      on = false;
    };
  }, [phoneOn, gridStart, gridEnd]);

  const phoneCals: Cal[] =
    phoneOn === "on" && phone
      ? phone.cals.map((c) => ({ id: c.id, doc: null, role: "phone", view: { title: c.title, color: c.color, source: "", refreshedAt: 0, error: "", events: phone.events.get(c.id) ?? [] } }))
      : [];
  const all = [...own, ...phoneCals];
  const shown = all.filter((c) => !hide.has(c.id));
  const occ: Occurrence[] = shown.flatMap((c) => occurrences(c.id, c.view.events, gridStart, gridEnd));
  const color = new Map(all.map((c) => [c.id, c.view.color]));
  const onDay = (day: string) => occ.filter((o) => o.start.slice(0, 10) <= day && o.end.slice(0, 10) >= day);
  const writable = own.filter((c) => c.role !== "viewer" && !c.view.source);

  function newCalendar(title: string) {
    return sync.create("calendar", (doc) => initCalendar(doc, { title, color: CALENDAR_COLORS[own.length % CALENDAR_COLORS.length], by: user.id }));
  }

  function newEvent(day: string) {
    let calendarId = writable[0]?.id;
    if (!calendarId) calendarId = newCalendar(t("calendar.mine"));
    setEditing({ calendarId, day });
  }

  const toggle = (id: string) => {
    const next = new Set(hide);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden([...next].join(","));
  };

  const shift = (n: number) => {
    const d = new Date(`${first}T12:00:00`);
    d.setMonth(d.getMonth() + n);
    setMonth(wallOf(d, true).slice(0, 7));
  };
  const weekdays = dates.weekdays("short");
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const dayList = onDay(picked);

  return (
    <div className="screen calendar-screen">
      <div className="screen-head">
        <h1>{t("calendar.title")}</h1>
        <button type="button" className="primary small" onClick={() => newEvent(picked)}>
          <Plus aria-hidden size={18} /> {t("calendar.newEvent")}
        </button>
      </div>
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : (
        <div className="calendar-layout">
          <div className="calendar-main">
            <div className="calendar-head">
              <button type="button" className="icon-button" onClick={() => shift(-1)} aria-label={t("journal.prevMonth")}>
                <ChevronLeft aria-hidden size={20} />
              </button>
              <h2>{dates.month(first)}</h2>
              <button type="button" className="icon-button" onClick={() => shift(1)} aria-label={t("journal.nextMonth")}>
                <ChevronRight aria-hidden size={20} />
              </button>
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  setMonth(today.slice(0, 7));
                  setPicked(today);
                }}
              >
                {t("calendar.today")}
              </button>
            </div>
            <div className="month-grid" role="grid">
              {weekdays.map((w) => (
                <span key={w} className="calendar-weekday" aria-hidden>
                  {w}
                </span>
              ))}
              {cells.map((day) => {
                const list = onDay(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={`month-day${day.slice(0, 7) !== month ? " other" : ""}${day === today ? " today" : ""}`}
                    aria-pressed={day === picked}
                    onClick={() => setPicked(day)}
                    onDoubleClick={() => newEvent(day)}
                    aria-label={`${dates.day(day, { weekday: true, long: true })}${list.length ? `, ${list.length}` : ""}`}
                  >
                    <span className="month-num">{Number(day.slice(8))}</span>
                    {list.slice(0, 3).map((o) => (
                      <span key={`${o.calendarId}${o.event.id}${o.start}`} className="month-chip" style={{ background: color.get(o.calendarId) }}>
                        {o.event.allDay ? "" : `${timeOf(o.start)} `}
                        {o.event.title}
                      </span>
                    ))}
                    {list.length > 3 && <span className="month-more">+{list.length - 3}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="calendar-side">
            <section className="day-agenda" aria-label={t("calendar.day")}>
              <h3>{dates.day(picked, { weekday: true, long: true })}</h3>
              {dayList.length === 0 && <p className="muted small-text">{t("calendar.nothing")}</p>}
              <ul className="agenda">
                {dayList.map((o) => {
                  const cal = all.find((c) => c.id === o.calendarId)!;
                  const canEdit = cal.role !== "viewer" && cal.role !== "phone" && !cal.view.source;
                  return (
                    <li key={`${o.calendarId}${o.event.id}${o.start}`}>
                      <button type="button" className="agenda-item" style={{ borderLeftColor: cal.view.color }} onClick={() => canEdit && setEditing({ calendarId: cal.id, eventId: o.event.id, occurrence: o.start })} disabled={!canEdit}>
                        <span className="agenda-time">{o.event.allDay ? t("calendar.allDay") : `${timeOf(o.start)}–${o.end.slice(0, 10) === o.start.slice(0, 10) ? timeOf(o.end) : ""}`}</span>
                        <span className="agenda-title">{o.event.title || t("calendar.untitled")}</span>
                        {o.event.location && <span className="muted small-text">{o.event.location}</span>}
                        <span className="muted small-text">{cal.view.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="calendar-list" aria-label={t("calendar.calendars")}>
              <h3>{t("calendar.calendars")}</h3>
              <ul>
                {own.map((c) => (
                  <CalendarRow key={c.id} cal={c} hidden={hide.has(c.id)} onToggle={() => toggle(c.id)} />
                ))}
                {phoneCals.map((c) => (
                  <li key={c.id} className="calendar-row">
                    <button type="button" className="calendar-toggle" onClick={() => toggle(c.id)} aria-pressed={!hide.has(c.id)}>
                      <span className="calendar-dot" style={{ background: c.view.color }} />
                      <span>{c.view.title}</span>
                      <Smartphone aria-hidden size={14} className="muted" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="calendar-add">
                <button type="button" className="secondary small" onClick={() => setAdding("new")}>
                  <CalendarPlus aria-hidden size={16} /> {t("calendar.new")}
                </button>
                <button type="button" className="secondary small" onClick={() => setAdding("subscribe")}>
                  <Link2 aria-hidden size={16} /> {t("calendar.subscribe")}
                </button>
                {canReadPhone && (
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() =>
                      void (async () => {
                        if (phoneOn === "on") return setPhoneOn("off");
                        if (await phoneAccess(true)) setPhoneOn("on");
                      })()
                    }
                  >
                    <Smartphone aria-hidden size={16} /> {t(phoneOn === "on" ? "calendar.phoneOff" : "calendar.phoneOn")}
                  </button>
                )}
                <button type="button" className="link-button small-text" onClick={() => setFeed(true)}>
                  <Rss aria-hidden size={14} /> {t("calendar.feed")}
                </button>
              </div>
            </section>
          </aside>
        </div>
      )}

      {editing && <EventDialog editing={editing} calendars={writable} onClose={() => setEditing(null)} />}
      <Dialog open={adding !== null} onClose={() => setAdding(null)} title={t(adding === "subscribe" ? "calendar.subscribe" : "calendar.new")}>
        {adding && <AddCalendar subscribe={adding === "subscribe"} count={own.length} onDone={() => setAdding(null)} />}
      </Dialog>
      <Dialog open={feed} onClose={() => setFeed(false)} title={t("calendar.feed")}>
        {feed && <Feed />}
      </Dialog>
    </div>
  );
}

function CalendarRow({ cal, hidden, onToggle }: { cal: Cal; hidden: boolean; onToggle: () => void }) {
  const { t, errorText } = useI18n();
  const { api } = useSession();
  const [sharing, setSharing] = useState(false);
  const [problem, setProblem] = useState("");
  const { away } = useAway("calendar", cal.id);
  const refresh = async () => {
    setProblem("");
    try {
      await api.refreshCalendar(cal.id);
    } catch (err) {
      setProblem(err instanceof ApiError && err.code === "network" ? t("list.needsOnline") : errorText(err));
    }
  };
  return (
    <li className="calendar-row">
      <button type="button" className="calendar-toggle" onClick={onToggle} aria-pressed={!hidden} title={t(hidden ? "calendar.show" : "calendar.hide")}>
        <span className="calendar-dot" style={{ background: hidden ? "transparent" : cal.view.color, borderColor: cal.view.color }} />
        <span>{cal.view.title || t("untitled.calendar")}</span>
        {cal.role !== "owner" && <Users aria-hidden size={14} className="muted" />}
        {cal.view.source && <Rss aria-hidden size={14} className="muted" />}
        {hidden ? <EyeOff aria-hidden size={14} className="muted" /> : <Eye aria-hidden size={14} className="muted visible-eye" />}
      </button>
      <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={18} />}>
        {cal.view.source && (
          <MenuItem onSelect={() => void refresh()}>
            <RefreshCw aria-hidden size={14} /> {t("calendar.refresh")}
          </MenuItem>
        )}
        {cal.role === "owner" && cal.doc && <ColorItems doc={cal.doc} />}
        <MenuItem onSelect={() => setSharing(true)}>{t("list.share")}</MenuItem>
        {cal.role === "owner" ? (
          <MenuItem danger onSelect={() => void away("delete", t("calendar.deleteConfirm"), "/calendar")}>
            {t("calendar.delete")}
          </MenuItem>
        ) : (
          <MenuItem danger onSelect={() => void away("leave", t("calendar.leaveConfirm"), "/calendar")}>
            {t("calendar.leave")}
          </MenuItem>
        )}
      </Menu>
      {cal.view.error && <p className="problem small-text">{cal.view.error}</p>}
      {problem && <Problem>{problem}</Problem>}
      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title: cal.view.title })}>
        <ShareDialog id={cal.id} />
      </Dialog>
    </li>
  );
}

function ColorItems({ doc }: { doc: Y.Doc }) {
  const { t } = useI18n();
  return (
    <div className="color-row" role="group" aria-label={t("calendar.color")}>
      {CALENDAR_COLORS.map((c) => (
        <button key={c} type="button" role="menuitem" className="color-swatch" style={{ background: c }} aria-label={c} onClick={() => doc.getMap("meta").set("color", c)} />
      ))}
    </div>
  );
}

/** A new calendar of one's own, or a subscription to another one's ICS address. */
function AddCalendar({ subscribe, count, onDone }: { subscribe: boolean; count: number; onDone: () => void }) {
  const { t } = useI18n();
  const { sync, user, api } = useSession();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const source = url.trim().replace(/^webcals?:\/\//i, "https://");
        if (subscribe && !/^https?:\/\/\S+\.\S+/i.test(source)) return setProblem(t("calendar.badLink"));
        const id = sync.create("calendar", (doc) => initCalendar(doc, { title: title.trim() || (subscribe ? "" : t("calendar.mine")), color: CALENDAR_COLORS[count % CALENDAR_COLORS.length], source: subscribe ? source : undefined, by: user.id }));
        // (the server fetches it once it has the calendar: asked a moment after it's synced)
        if (subscribe) {
          let tries = 0;
          const ask = () =>
            void api.refreshCalendar(id).catch((err: unknown) => {
              if (err instanceof ApiError && err.code === "not_synced" && ++tries < 10) setTimeout(ask, 1500);
            });
          setTimeout(ask, 1000);
        }
        onDone();
      }}
    >
      {subscribe && <p className="muted small-text">{t("calendar.subscribeHint")}</p>}
      {subscribe && (
        <label className="field">
          <span>{t("calendar.link")}</span>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/…/basic.ics" data-autofocus />
        </label>
      )}
      <label className="field">
        <span>{t("calendar.name")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={subscribe ? t("calendar.nameFromFeed") : t("calendar.mine")} maxLength={80} data-autofocus={!subscribe || undefined} />
      </label>
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        <button type="submit" className="primary">
          {t(subscribe ? "calendar.subscribeGo" : "calendar.create")}
        </button>
      </div>
    </form>
  );
}

/** This person's private ICS address, for other calendar apps. */
function Feed() {
  const { t, errorText } = useI18n();
  const { api } = useSession();
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api.calendarFeed().then(
      (r) => setUrl(r.url),
      (err: unknown) => setProblem(errorText(err)),
    );
  }, [api, errorText]);
  return (
    <div className="stack">
      <p className="muted small-text">{t("calendar.feedHint")}</p>
      {url && <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t("calendar.feed")} />}
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        {navigator.clipboard && url && (
          <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(url)}>
            {t("share.copy")}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => confirm(t("calendar.feedNewConfirm")) && api.calendarFeed(true).then((r) => setUrl(r.url), (err: unknown) => setProblem(errorText(err)))}
        >
          {t("calendar.feedNew")}
        </button>
      </div>
    </div>
  );
}

export { pad };
