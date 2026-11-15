import { useEffect } from "react";
import { isApp } from "../lib/api";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { scheduleReminders } from "../lib/reminders";
import { useHomeItems, useSession } from "../lib/sync-react";

/** The phone's calendar reminders, scheduled again a little after any calendar changes (in the app only). */
export function useReminders() {
  const { t } = useI18n();
  const { time } = useDates();
  const { sync } = useSession();
  const items = useHomeItems().filter(([, i]) => i.type === "calendar");
  const docs = sync.docsOf("calendar", items.map(([id]) => id));
  useEffect(() => {
    if (!isApp) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void scheduleReminders(
          docs.map((doc, i) => ({ id: items[i]?.[0] ?? "", doc })),
          (e, start) => ({ title: e.title || t("calendar.untitled"), body: e.allDay ? t("calendar.allDay") : `${time(start)}${e.location ? ` · ${e.location}` : ""}` }),
        );
      }, 2000);
    };
    again();
    for (const d of docs) d.on("update", again);
    return () => {
      clearTimeout(timer);
      docs.forEach((d) => d.off("update", again));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- (the documents are the same while the calendars are)
  }, [docs, t, time]);
}
