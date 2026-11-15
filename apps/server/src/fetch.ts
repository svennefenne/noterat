import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Fetching a page from the internet on someone's behalf (a recipe's, decision 9), and only from the
 * internet: every address a name resolves to is checked when the connection is made (so a name can't
 * point somewhere else between the check and the request), redirects are followed and checked the
 * same way, and there are limits on size and time. A link to the home network, the server itself or
 * the cloud's metadata address gets nowhere.
 */

export interface Fetched {
  /** where it came from in the end (after redirects) */
  url: string;
  type: string;
  body: Buffer;
}

export class FetchFailed extends Error {
  constructor(
    message: string,
    readonly reason: "not_public" | "too_large" | "failed" = "failed",
  ) {
    super(message);
  }
}

/** Whether an address is out on the internet (not private, loopback, link-local, shared or reserved). */
export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !(v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff"));
  }
  return false;
}

// (a lookup that refuses anything that isn't public: used for the connection itself)
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (!list.length || bad) return callback(Object.assign(new Error(`${hostname} isn't on the internet`), { code: "NOT_PUBLIC" }), "", 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

export interface FetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
}

export function fetchPublic(url: string, o: FetchOptions = {}, redirects = 5): Promise<Fetched> {
  const maxBytes = o.maxBytes ?? 5 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new FetchFailed("that isn't a web address"));
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return reject(new FetchFailed("only http and https addresses"));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(u.hostname.replace(/^\[|\]$/g, ""))) return reject(new FetchFailed("that address isn't on the internet", "not_public"));
    const get = u.protocol === "https:" ? https.get : http.get;
    const req = get(
      u,
      {
        lookup: publicLookup,
        timeout: o.timeoutMs ?? 15_000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Noterat recipe import)",
          Accept: o.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "sv,en;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) return reject(new FetchFailed("too many redirects"));
          return resolve(fetchPublic(new URL(res.headers.location, u).toString(), o, redirects - 1));
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new FetchFailed(`the page answered ${status}`));
        }
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
          res.destroy();
          return reject(new FetchFailed("the page is too large", "too_large"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new FetchFailed("the page is too large", "too_large"));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ url: u.toString(), type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
        res.on("error", (err) => reject(new FetchFailed(err.message)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("the page took too long")));
    req.on("error", (err: NodeJS.ErrnoException) => reject(err.code === "NOT_PUBLIC" ? new FetchFailed("that address isn't on the internet", "not_public") : new FetchFailed(err.message)));
  });
}

/** A page's text, in the charset it says it's in (Content-Type, else a <meta charset>, else UTF-8). */
export function decodePage(f: Fetched): string {
  const fromHeader = /charset=([\w-]+)/i.exec(f.type)?.[1];
  const head = f.body.subarray(0, 4096).toString("latin1");
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(f.body);
  } catch {
    return new TextDecoder("utf-8").decode(f.body);
  }
}
