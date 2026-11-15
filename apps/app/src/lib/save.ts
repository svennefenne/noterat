import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { isNative } from "./api";

/**
 * A file the app made (a recipe's PDF, a scan's PDF) out to the person: a download on the web; in the
 * app, the phone's share sheet (save to Files, send, open in a PDF reader), from a copy in the cache.
 */
export async function saveOrShare(blob: Blob, filename: string, title: string): Promise<void> {
  const name = filename.replace(/[\\/:*?"<>|]+/g, " ").trim() || "noterat";
  if (!isNative) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
  await Share.share({ title, files: [uri] });
}
