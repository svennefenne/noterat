import type { ObjectType } from "./docs";

/**
 * The shapes the API sends and takes, and the rules both sides check (the app before sending, so it
 * can say what's wrong at once; the server, which decides).
 */

/** GET /api/server: whether an address is a Noterat server, and whether it still needs its first account. */
export interface ServerInfo {
  app: "noterat";
  version: string;
  /** no accounts yet: the first one made (POST /api/setup) is the admin */
  needsSetup: boolean;
}

export type Role = "admin" | "member";

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

/** POST /api/setup and POST /api/login: a session token (sent as `Authorization: Bearer …`) and who it's for. */
export interface SessionReply {
  token: string;
  user: User;
}

export interface SetupInput {
  username: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

/**
 * Why a request was turned down. The API answers `{ "error": code }`; the app shows the code's text in
 * the person's language (the codes are keys in its translations).
 */
export type ErrorCode =
  | "server_error"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "not_synced"
  | "invite_used"
  | "invite_expired"
  | "already_member"
  | "setup_done"
  | "login_failed"
  | "too_many_attempts"
  | "username_invalid"
  | "username_taken"
  | "name_missing"
  | "name_long"
  | "password_short"
  | "password_long"
  // files and transcription (phase 2)
  | "upload_offset"
  | "file_too_large"
  | "hash_mismatch"
  | "not_uploaded"
  | "wrong_type"
  | "no_transcriber";

export interface ApiErrorBody {
  error: ErrorCode;
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{2,32}$/i;
export const DISPLAY_NAME_MAX = 60;
export const PASSWORD_MIN = 10;
/** (scrypt takes anything, but a megabyte of password is someone testing the server, not a password) */
export const PASSWORD_MAX = 200;

export function checkUsername(username: string): ErrorCode | null {
  return USERNAME_PATTERN.test(username) ? null : "username_invalid";
}

export function checkDisplayName(name: string): ErrorCode | null {
  const n = name.trim();
  if (!n) return "name_missing";
  return n.length > DISPLAY_NAME_MAX ? "name_long" : null;
}

export function checkPassword(password: string): ErrorCode | null {
  if (password.length < PASSWORD_MIN) return "password_short";
  return password.length > PASSWORD_MAX ? "password_long" : null;
}

// ───────────── sharing (phase 1) ─────────────

/** What someone may do with a thing shared with them; its maker is its owner. */
export type ShareRole = "editor" | "viewer";
export type MemberRole = "owner" | ShareRole;
export const isShareRole = (r: unknown): r is ShareRole => r === "editor" || r === "viewer";

/** Someone on this server, as others see them. */
export interface Person {
  id: number;
  username: string;
  displayName: string;
}

export interface Member {
  person: Person;
  role: MemberRole;
}

/** A share link that hasn't been used yet. Its address (with the token) is only shown when it's made. */
export interface ShareLink {
  id: string;
  role: ShareRole;
  createdAt: number;
  expiresAt: number;
}

/** GET /api/objects/:id/share: who has a thing, and the invitations still open (the owner sees those). */
export interface ShareState {
  title: string;
  /** the asker's own role */
  role: MemberRole;
  members: Member[];
  links: ShareLink[];
  invitations: { id: string; person: Person; role: ShareRole; at: number }[];
}

/** POST /api/objects/:id/share: a link (no userId) or an invitation to someone on this server. */
export interface ShareInput {
  role: ShareRole;
  userId?: number;
}

export type ShareReply = { kind: "link"; url: string; link: ShareLink } | { kind: "invitation"; id: string };

/** GET /api/links/:token, before logging in: what the link is, for its page ("Sam wants to share …"). */
export interface LinkInfo {
  from: string;
  title: string;
  type: ObjectType;
  role: ShareRole;
  status: "open" | "used" | "expired";
}

/** Accepting a link or an invitation: the thing that's now shared with you. */
export interface AcceptReply {
  objectId: string;
  type: ObjectType;
}

/** POST /api/links/:token/signup: a new account made from a share link, which it then accepts. */
export interface SignupReply extends SessionReply {
  accepted: AcceptReply;
}

// ───────────── transcription (phase 2) ─────────────

/**
 * GET /api/transcriber: whether this server turns speech into text. "none": no worker is set up
 * (WORKER_TOKEN isn't set); "offline": one is, but it hasn't asked for work in the last minute.
 */
export interface TranscriberInfo {
  state: "none" | "offline" | "online";
  /** jobs waiting or being done */
  queued: number;
}

/** What a worker does: speech to text (decision 6), reading scans (decision 8). */
export type JobKind = "transcribe" | "ocr";

export interface WorkerFile {
  hash: string;
  type: string;
  size: number;
}

/** POST /api/worker/next: a job for the worker. */
export type WorkerJob =
  | {
      id: string;
      kind: "transcribe";
      file: WorkerFile;
      /** "sv", or null to let the model tell */
      language: string | null;
    }
  | {
      id: string;
      kind: "ocr";
      /** the scan's pages */
      files: WorkerFile[];
      /** as Tesseract names them: "swe+eng" */
      language: string;
      /** per page: a photo to find the page in and straighten, not a cropped page yet */
      crop: boolean[];
    };

/** POST /api/worker/jobs/:id/done, for a transcription (an OCR job's adds pages and pdf: decision 8) */
export interface WorkerDone {
  text: string;
  language?: string;
  duration?: number;
  model?: string;
  segments?: { start: number; end: number; text: string }[];
}
