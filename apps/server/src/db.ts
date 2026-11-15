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
  /* 2: things, who has them, and sharing (phase 1) */ `
  -- one row per thing (a list…): id and type come from its document's name ("list/<id>"), the owner is
  -- whoever synced it first; state is the Yjs document. A deleted thing keeps its row (deleted_at), so a
  -- device that still has it learns it's gone instead of making it anew.
  create table objects (
    id text primary key,
    type text not null,
    owner_id integer not null references users(id) on delete cascade,
    title text not null default '',
    state blob,
    created_at integer not null,
    updated_at integer not null,
    deleted_at integer
  );

  create table members (
    object_id text not null references objects(id) on delete cascade,
    user_id integer not null references users(id) on delete cascade,
    role text not null check (role in ('owner', 'editor', 'viewer')),
    added_at integer not null,
    primary key (object_id, user_id)
  );
  create index members_user on members(user_id);

  -- each person's home document (home/<user id>)
  create table homes (
    user_id integer primary key references users(id) on delete cascade,
    state blob not null,
    updated_at integer not null
  );

  -- a share link (to_id null; id: its token's sha256) or an invitation to someone on this server (to_id)
  create table invites (
    id text primary key,
    object_id text not null references objects(id) on delete cascade,
    from_id integer not null references users(id) on delete cascade,
    to_id integer references users(id) on delete cascade,
    role text not null check (role in ('editor', 'viewer')),
    created_at integer not null,
    expires_at integer not null,
    used_at integer,
    used_by integer references users(id) on delete set null
  );
  create index invites_object on invites(object_id);
  `,
  /* 3: files, and work for the worker (phase 2) */ `
  -- a file people added (a recording…), named by the SHA-256 of its bytes: DATA_DIR/files/ab/abcd…
  -- (pieces of one still uploading wait in DATA_DIR/uploads/)
  create table files (
    hash text primary key,
    size integer not null,
    type text not null,
    uploaded_by integer references users(id) on delete set null,
    created_at integer not null
  );

  -- the things that refer to a file: anyone who has one of them may read it
  create table file_refs (
    object_id text not null references objects(id) on delete cascade,
    hash text not null references files(hash) on delete cascade,
    added_at integer not null,
    primary key (object_id, hash)
  );
  create index file_refs_hash on file_refs(hash);

  -- jobs for the worker (speech to text): a working job is its worker's until lease_until
  create table jobs (
    id text primary key,
    kind text not null,
    object_id text not null references objects(id) on delete cascade,
    hash text not null,
    language text,
    status text not null check (status in ('queued', 'working', 'done', 'failed', 'cancelled')),
    tries integer not null default 0,
    worker text,
    lease_until integer,
    error text,
    created_at integer not null,
    updated_at integer not null
  );
  create index jobs_status on jobs(status, created_at);
  create index jobs_object on jobs(object_id);
  `,
  /* 4: jobs over several files (a scan's pages, phase 4) */ `
  -- the job's files, as JSON: [{ "hash": …, "crop": true|false }] (a transcription's one recording too)
  alter table jobs add column files text;
  `,
  /* 5: what a job is given besides files (a recipe page's address, phase 5) */ `
  alter table jobs add column input text;
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
