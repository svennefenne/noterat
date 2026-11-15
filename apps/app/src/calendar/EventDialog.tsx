import { useState, type FormEvent } from "react";
import { addEvent, objectDocName, readCalendar, readRepeat, removeEvent, skipOccurrence, updateEvent, wallOf, writeRepeat, type EventInput, type Freq } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/sync-react";
import { Dialog, Problem } from "../ui";
import type { Cal } from "./CalendarScreen";

export interface Editing {
  calendarId: string;
  /** an event to change (else a new one, on `day`) */
  eventId?: string;
  /** the occurrence picked (a repeating event's), for "only this one" */
  occurrence?: string;
  day?: string;
}

const REMINDERS = [-1, 0, 5, 15, 30, 60, 120, 1440];

/** A new event, or one to change: its time, repeat, reminder, place and notes. */
export function EventDialog({ editing, calendars, onClose }: { editing: Editing; calendars: Cal[]; onClose: () => void }) {
  const { t } = useI18n();
  const { sync } = useSession();
  const docOf = (id: string) => sync.doc(objectDocName("calendar", id));
  const was = editing.eventId ? readCalendar(docOf(editing.calendarId)).events.find((e) => e.id === editing.eventId) : undefined;
  const day = editing.day ?? editing.occurrence?.slice(0, 10) ?? wallOf(new Date(), true);
  const rep = readRepeat(was?.rrule ?? "");

  const [calendarId, setCalendarId] = useState(editing.calendarId);
  const [title, setTitle] = useState(was?.title ?? "");
  const [allDay, setAllDay] = useState(was?.allDay ?? false);
  const [startDay, setStartDay] = useState(was?.start.slice(0, 10) ?? day);
  const [startTime, setStartTime] = useState(was && !was.allDay ? was.start.slice(11, 16) : "09:00");
  const [endDay, setEndDay] = useState(was?.end.slice(0, 10) ?? day);
  const [endTime, setEndTime] = useState(was && !was.allDay ? was.end.slice(11, 16) : "10:00");
  const [freq, setFreq] = useState<Freq>(rep.freq);
  const [interval, setInterval] = useState(rep.interval);
  const [days, setDays] = useState<number[]>(rep.days);
  const [until, setUntil] = useState(rep.until);
  const [reminder, setReminder] = useState(was?.reminders[0] ?? -1);
  const [location, setLocation] = useState(was?.location ?? "");
  const [notes, setNotes] = useState(was?.notes ?? "");
  const [problem, setProblem] = useState("");
  const [deleting, setDeleting] = useState(false);

  function save(e: FormEvent) {
    e.preventDefault();
    const start = allDay ? startDay : `${startDay}T${startTime}`;
    const end = allDay ? endDay : `${endDay}T${endTime}`;
    if (end < start) return setProblem(t("event.endBeforeStart"));
    const input: EventInput = {
      title: title.trim(),
      start,
      end,
      allDay,
      // (a rule the editor can't show is kept as it was, unless the repeat was changed)
      rrule: rep.custom && freq === rep.freq ? (was?.rrule ?? "") : writeRepeat({ freq, interval, days, until }),
      exdates: was?.exdates ?? [],
      location: location.trim(),
      notes: notes.trim(),
      reminders: reminder >= 0 ? [reminder] : [],
    };
    if (was && calendarId === editing.calendarId) updateEvent(docOf(calendarId), was.id, input);
    else {
      if (was) removeEvent(docOf(editing.calendarId), was.id);
      addEvent(docOf(calendarId), input);
    }
    onClose();
  }

  const weekday = (i: number) => new Date(2024, 0, 1 + i).toLocaleDateString(t("locale"), { weekday: "short" });

  return (
    <Dialog open onClose={onClose} title={t(was ? "event.edit" : "event.new")}>
      <form onSubmit={save} className="stack event-form">
        <label className="field">
          <span>{t("event.title")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-autofocus required />
        </label>
        {calendars.length > 1 && (
          <label className="field">
            <span>{t("event.calendar")}</span>
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.view.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> {t("calendar.allDay")}
        </label>
        <div className="event-times">
          <label className="field">
            <span>{t("event.starts")}</span>
            <span className="event-when">
              <input
                type="date"
                value={startDay}
                onChange={(e) => {
                  setStartDay(e.target.value);
                  if (endDay < e.target.value) setEndDay(e.target.value);
                }}
                required
              />
              {!allDay && <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />}
            </span>
          </label>
          <label className="field">
            <span>{t("event.ends")}</span>
            <span className="event-when">
              <input type="date" value={endDay} min={startDay} onChange={(e) => setEndDay(e.target.value)} required />
              {!allDay && <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />}
            </span>
          </label>
        </div>
        <div className="event-repeat">
          <label className="field">
            <span>{t("event.repeat")}</span>
            <select value={freq} onChange={(e) => setFreq(e.target.value as Freq)}>
              {(["none", "daily", "weekly", "monthly", "yearly"] as const).map((f) => (
                <option key={f} value={f}>
                  {t(`repeat.${f}`)}
                </option>
              ))}
            </select>
          </label>
          {freq !== "none" && (
            <>
              <label className="field">
                <span>{t("event.every")}</span>
                <input type="number" min={1} max={99} value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="field">
                <span>{t("event.until")}</span>
                <input type="date" value={until} min={startDay} onChange={(e) => setUntil(e.target.value)} />
              </label>
            </>
          )}
        </div>
        {freq === "weekly" && (
          <div className="weekdays" role="group" aria-label={t("event.onDays")}>
            {Array.from({ length: 7 }, (_, i) => (
              <label key={i} className="chip">
                <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays((d) => (e.target.checked ? [...d, i] : d.filter((x) => x !== i)))} /> {weekday(i)}
              </label>
            ))}
          </div>
        )}
        {rep.custom && <p className="muted small-text">{t("event.customRepeat")}</p>}
        <label className="field">
          <span>{t("event.reminder")}</span>
          <select value={reminder} onChange={(e) => setReminder(Number(e.target.value))}>
            {REMINDERS.map((m) => (
              <option key={m} value={m}>
                {m < 0 ? t("event.noReminder") : m === 0 ? t("event.atStart") : m >= 1440 ? t("event.daysBefore", { n: m / 1440 }) : m >= 60 ? t("event.hoursBefore", { n: m / 60 }) : t("event.minutesBefore", { n: m })}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("event.location")}</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
        </label>
        <label className="field">
          <span>{t("event.notes")}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} />
        </label>
        {was?.rrule && <p className="muted small-text">{t("event.allOccurrences")}</p>}
        {problem && <Problem>{problem}</Problem>}
        <div className="dialog-actions">
          {was && (
            <button
              type="button"
              className="secondary danger-text"
              onClick={() => {
                if (was.rrule && editing.occurrence) return setDeleting(true);
                if (!confirm(t("event.deleteConfirm"))) return;
                removeEvent(docOf(editing.calendarId), was.id);
                onClose();
              }}
            >
              {t("event.delete")}
            </button>
          )}
          <button type="submit" className="primary">
            {t("note.save")}
          </button>
        </div>
        {deleting && was && (
          <div className="event-delete">
            <p>{t("event.deleteWhich")}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  skipOccurrence(docOf(editing.calendarId), was.id, editing.occurrence!);
                  onClose();
                }}
              >
                {t("event.deleteThis")}
              </button>
              <button
                type="button"
                className="secondary danger-text"
                onClick={() => {
                  removeEvent(docOf(editing.calendarId), was.id);
                  onClose();
                }}
              >
                {t("event.deleteAll")}
              </button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
