import { useEffect, useState } from "react";
import { useSession } from "../lib/sync-react";

/**
 * A file (a photo, a recording) to show: from the device, else fetched from the server the first time
 * and kept. undefined while it's being got; null when it can't be had now (offline, not uploaded yet).
 */
export function useFileUrl(hash: string): string | null | undefined {
  const { sync } = useSession();
  const [got, setGot] = useState<{ hash: string; url: string | null } | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let on = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    const get = () =>
      void sync.files.get(hash).then((blob) => {
        if (!on) return;
        made = blob ? URL.createObjectURL(blob) : null;
        setGot({ hash, url: made });
        // (not here yet: someone else's file that hasn't been uploaded, or no connection; try again later)
        if (!blob) again = setTimeout(get, 20_000);
      });
    get();
    return () => {
      on = false;
      clearTimeout(again);
      if (made) URL.revokeObjectURL(made);
    };
  }, [hash, sync]);
  return got?.hash === hash ? got.url : undefined;
}
