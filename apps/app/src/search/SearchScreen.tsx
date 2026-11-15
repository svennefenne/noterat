import { useEffect, useMemo, useState } from "react";
import { BookHeart, CalendarDays, ChefHat, Lock, ListChecks, Mic, NotebookPen, ScanLine, Search } from "lucide-react";
import { Link } from "wouter";
import { plainLine, type ObjectType } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { buildIndex, snippet, type Hit } from "../lib/search";
import { useHomeItems, useLock, useSession } from "../lib/sync-react";
import { pathOf } from "../lib/things";

const ICONS: Record<ObjectType, typeof ListChecks> = { list: ListChecks, note: NotebookPen, memo: Mic, journal: BookHeart, scan: ScanLine, recipe: ChefHat, calendar: CalendarDays };

/**
 * Search in everything this person has, on the device (decision 7): it works the same offline. The
 * index is built when the page opens and again a moment after anything changes. The journal is left out
 * while it's locked.
 */
export function SearchScreen() {
  const { t } = useI18n();
  const { sync, lock } = useSession();
  useLock();
  const journalHidden = lock.hides("journal");
  const items = useHomeItems().filter(([, i]) => !(journalHidden && i.type === "journal"));
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [version, setVersion] = useState(0);

  const things = sync.thingsOf(items.map(([id, item]) => ({ id, type: item.type })));

  // (again a moment after any of them changes, here or elsewhere)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 400);
    };
    for (const x of things) x.doc.on("update", again);
    return () => {
      clearTimeout(timer);
      things.forEach((x) => x.doc.off("update", again));
    };
  }, [things]);

  const index = useMemo(() => {
    void version; // (built again a moment after what the things say changes)
    return buildIndex(things);
  }, [things, version]);
  const hits = useMemo(() => index.search(query), [index, query]);

  // (the words in the address, so going back keeps the search)
  useEffect(() => {
    history.replaceState(history.state, "", query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  }, [query]);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("search.title")}</h1>
      </div>
      <label className="search">
        <Search aria-hidden size={18} />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.title")} autoFocus />
      </label>
      {journalHidden && (
        <p className="muted small-text lock-note">
          <Lock aria-hidden size={14} /> {t("search.journalLocked")}
        </p>
      )}
      {query.trim() && hits.length === 0 && <p className="muted">{t("search.none")}</p>}
      {!query.trim() && <p className="muted small-text">{t("search.hint", { n: things.length })}</p>}
      {hits.length > 0 && (
        <ul className="hits" aria-live="polite">
          {hits.slice(0, 50).map((h) => (
            <HitRow key={h.id} hit={h} />
          ))}
        </ul>
      )}
    </div>
  );
}

function HitRow({ hit }: { hit: Hit }) {
  const { t } = useI18n();
  const Icon = ICONS[hit.type];
  // (the words as they read: without Markdown's marks)
  const pieces = snippet(hit.text.split("\n").map(plainLine).filter(Boolean).join(" "), hit.terms);
  return (
    <li>
      <Link href={pathOf(hit.type, hit.id)} className="hit">
        <span className="hit-head">
          <Icon aria-hidden size={16} />
          <span className="hit-title">{hit.title || t(`untitled.${hit.type}`)}</span>
          <span className="hit-kind">{t(`kind.${hit.type}`)}</span>
        </span>
        <span className="hit-snippet">
          {pieces.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
        </span>
      </Link>
    </li>
  );
}
