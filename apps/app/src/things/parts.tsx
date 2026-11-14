import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation } from "wouter";
import type { Awareness } from "y-protocols/awareness";
import type { ObjectType } from "@noterat/core";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { personColor, SECTION } from "../lib/things";

/** Back to a section's page. */
export function Back({ type }: { type: ObjectType }) {
  const { t } = useI18n();
  return (
    <Link href={SECTION[type]} className="back">
      <ArrowLeft aria-hidden size={18} /> {t(`section.${type}`)}
    </Link>
  );
}

/**
 * A thing's page, only for a thing this person has (in their home document) of the right kind; else
 * "not here" (deleted, no longer shared, or never theirs).
 */
export function useThing(type: ObjectType, id: string) {
  const { homeLoaded } = useSyncState();
  const item = useHomeItems().find(([i]) => i === id)?.[1];
  return { loading: !homeLoaded, role: item && item.type === type ? item.role : null };
}

export function NotHere({ type }: { type: ObjectType }) {
  const { t } = useI18n();
  return (
    <div className="screen">
      <Back type={type} />
      <p className="notice">{t(`notHere.${type}`)}</p>
    </div>
  );
}

/**
 * Deleting a thing (its owner) or leaving it (anyone else), asked first; then it goes from the device
 * and the page goes back to its section. A thing made offline that never reached the server simply goes.
 */
export function useAway(type: ObjectType, id: string) {
  const { t, errorText } = useI18n();
  const { sync, api, user } = useSession();
  const [, navigate] = useLocation();
  const [problem, setProblem] = useState("");

  async function away(how: "delete" | "leave", question: string, then = SECTION[type]) {
    if (question && !confirm(question)) return false;
    try {
      await (how === "delete" ? api.deleteObject(id) : api.removeMember(id, user.id));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "not_synced")) {
        setProblem(err instanceof ApiError && err.code === "network" ? t("list.needsOnline") : errorText(err));
        return false;
      }
    }
    sync.drop(id);
    navigate(then);
    return true;
  }

  return { away, problem, setProblem };
}

/** This person, shown to the others who have a document open (their cursor and name in a note). */
export function usePresence(awareness: Awareness | null) {
  const { user } = useSession();
  useEffect(() => {
    const color = personColor(user.id);
    awareness?.setLocalStateField("user", { name: user.displayName, color, colorLight: `${color.slice(0, -1)} / 0.2)` });
  }, [awareness, user]);
}
