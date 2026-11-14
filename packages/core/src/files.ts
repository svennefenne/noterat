/**
 * Files (recordings; later photos and scans) go to the server apart from the documents, named by the
 * SHA-256 of their bytes, in pieces that can be picked up where an upload stopped (decision 6).
 */

/** An upload's piece. */
export const CHUNK_SIZE = 1024 * 1024;
/** The largest file the server takes (a two-hour recording is about 60 MB). */
export const MAX_FILE_SIZE = 500 * 1024 * 1024;

export const isFileHash = (h: unknown): h is string => typeof h === "string" && /^[0-9a-f]{64}$/.test(h);

/** A media type as kept: lower case, without parameters ("audio/webm;codecs=opus" → "audio/webm"). */
export function cleanFileType(t: string | null | undefined): string {
  const base = (t ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z]+\/[a-z0-9.+-]+$/.test(base) ? base : "application/octet-stream";
}

/** GET /api/files/:hash/status: how much of a file the server has. */
export interface FileStatus {
  size: number;
  received: number;
  complete: boolean;
}

/** PUT /api/files/:hash: after a piece. */
export interface UploadReply {
  received: number;
  complete: boolean;
}
