import { useCallback } from "react";
import { initScan, type ScanKind } from "@noterat/core";
import { hashOf } from "../lib/files";
import type { ScannedPage } from "../lib/scanner";
import { useSession } from "../lib/sync-react";

/**
 * Scanned pages kept as a scan of this person's (decision 8): what the phone read goes in at once (and a
 * receipt's shop, day and total with it), the worker is asked for the rest, and the pages are on the
 * device before anything shows them. Its id, or null for nothing scanned.
 */
export function useKeepScan() {
  const { sync, user } = useSession();
  return useCallback(
    async (pages: ScannedPage[], kind: ScanKind): Promise<string | null> => {
      if (!pages.length) return null;
      const hashes = await Promise.all(pages.map((p) => hashOf(p.blob)));
      const id = sync.create("scan", (doc) =>
        initScan(doc, {
          kind,
          pages: pages.map((p, i) => ({ hash: hashes[i]!, type: "image/jpeg", width: p.width, height: p.height, cropped: p.cropped })),
          text: pages
            .map((p) => p.text.trim())
            .filter(Boolean)
            .join("\n\n"),
          read: true,
          by: user.id,
        }),
      );
      for (const p of pages) await sync.files.add(p.blob, id);
      return id;
    },
    [sync, user.id],
  );
}
