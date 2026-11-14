/**
 * What the server and the app agree on: the shapes the API sends and takes, and the rules both check
 * (the app before sending, so it can say what's wrong at once; the server, which decides).
 *
 * The source is used as it is (no build step): Vite bundles it into the app, esbuild into the server.
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
  | "not_found"
  | "setup_done"
  | "login_failed"
  | "too_many_attempts"
  | "username_invalid"
  | "username_taken"
  | "name_missing"
  | "name_long"
  | "password_short"
  | "password_long";

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
