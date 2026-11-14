import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

/**
 * The one SQLite database (DATA_DIR/noterat.db). Every timestamp is milliseconds since the epoch (UTC).
 * Migrations run in order when it opens; each is applied once and recorded in meta.schema_version.
 * Add new ones at the end; never change one that has shipped.
 */
const MIGRATIONS: string[] = [
  /* 1: accounts and sessions */ `
  create table users (
    id integer primary key,
    username text not null unique collate nocase,
    display_name text not null,
    password_hash text not null,
    role text not null default 'member' check (role in ('admin', 'member')),
    created_at integer not null
  );

  -- id: the token's sha256 (the token itself is only ever on the device)
  create table sessions (
    id text primary key,
    user_id integer not null references users(id) on delete cascade,
    created_at integer not null,
    last_used integer not null,
    expires_at integer not null,
    user_agent text not null default ''
  );
  create index sessions_user on sessions(user_id);
  `,
];

/** Open (or make) the database at file (":memory:" for tests), brought up to the latest schema. */
export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec("create table if not exists meta (key text primary key, value text not null)");
  const row = db.prepare("select value from meta where key = 'schema_version'").get() as { value: string } | undefined;
  const from = row ? Number(row.value) : 0;
  if (from > MIGRATIONS.length) throw new Error(`The database is from a newer Noterat (schema ${from}; this one knows ${MIGRATIONS.length}).`);
  for (let v = from; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.prepare("insert into meta (key, value) values ('schema_version', ?) on conflict(key) do update set value = excluded.value").run(String(v + 1));
    })();
  }
}
