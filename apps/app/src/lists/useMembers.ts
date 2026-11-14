import { useEffect, useMemo, useState } from "react";
import type { Person } from "@noterat/core";
import { useSession, useSyncState } from "../lib/sync-react";

const read = (key: string): Person[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as Person[]) : [];
  } catch {
    return [];
  }
};

/**
 * The people a list is shared with (for its person columns): as last seen, from the device, and asked
 * for again whenever there's a connection (and when `again` changes, after sharing). Always with
 * yourself in it.
 */
export function useMembers(id: string, again = 0): Person[] {
  const { api, user } = useSession();
  const { connection } = useSyncState();
  const key = `noterat.members.${id}`;
  const [people, setPeople] = useState<Person[]>(() => read(key));
  useEffect(() => {
    if (connection !== "online") return;
    let live = true;
    api
      .shareState(id)
      .then((s) => {
        if (!live) return;
        const p = s.members.map((m) => m.person);
        try {
          localStorage.setItem(key, JSON.stringify(p));
        } catch {
          // (asked for again next time)
        }
        setPeople(p);
      })
      .catch(() => {
        // (not synced yet, or no longer shared: what's kept stays)
      });
    return () => {
      live = false;
    };
  }, [id, key, connection, api, again]);
  return useMemo(
    () => (people.some((p) => p.id === user.id) ? people : [{ id: user.id, username: user.username, displayName: user.displayName }, ...people]),
    [people, user],
  );
}
