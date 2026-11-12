// Хранилище в PostgreSQL. Таблицы создаются сами при первом запуске.
import crypto from 'node:crypto';

const SCHEMA = `
create table if not exists devices (
  id uuid primary key,
  device_key text not null unique,
  host text not null default '',
  "user" text not null default '',
  os text not null default '',
  version text not null default '',
  token_hash text not null,
  mood text not null default 'awake',
  reason text not null default '',
  idle_sec integer not null default 0,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists devices_token on devices (token_hash);
create table if not exists mood_history (
  device_id uuid not null references devices(id) on delete cascade,
  at timestamptz not null,
  mood text not null,
  reason text not null default ''
);
create index if not exists mood_history_device on mood_history (device_id, at);
`;

const row = (r) => r && ({
  id: r.id, deviceKey: r.device_key, host: r.host, user: r.user, os: r.os, version: r.version, tokenHash: r.token_hash,
  mood: r.mood, reason: r.reason, idleSec: r.idle_sec, createdAt: +r.created_at, lastSeen: +r.last_seen,
});

export async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await pool.query(SCHEMA);
  return {
    async enroll({ deviceKey, host, user, os, version, tokenHash, now }) {
      const r = await pool.query(
        `insert into devices (id, device_key, host, "user", os, version, token_hash, created_at, last_seen)
         values ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0))
         on conflict (device_key) do update set host = $3, "user" = $4, os = $5, version = $6, token_hash = $7
         returning *`,
        [crypto.randomUUID(), deviceKey, host, user, os, version, tokenHash, now]);
      return row(r.rows[0]);
    },
    async byToken(tokenHash) {
      const r = await pool.query('select * from devices where token_hash = $1', [tokenHash]);
      return row(r.rows[0]) || null;
    },
    async beat(id, { mood, reason, idleSec, version, now }) {
      await pool.query(
        `insert into mood_history (device_id, at, mood, reason)
         select id, to_timestamp($5 / 1000.0), $2, $3 from devices where id = $1 and (mood <> $2 or reason <> $3)`,
        [id, mood, reason, idleSec, now]);
      await pool.query(
        'update devices set mood = $2, reason = $3, idle_sec = $4, version = $5, last_seen = to_timestamp($6 / 1000.0) where id = $1',
        [id, mood, reason, idleSec, version, now]);
    },
    async list() { return (await pool.query('select * from devices order by host')).rows.map(row); },
    async history(id, since) {
      const r = await pool.query('select at, mood, reason from mood_history where device_id = $1 and at >= to_timestamp($2 / 1000.0) order by at', [id, since]);
      return r.rows.map((h) => ({ deviceId: id, at: +h.at, mood: h.mood, reason: h.reason }));
    },
    async remove(id) { return (await pool.query('delete from devices where id = $1', [id])).rowCount > 0; },
    async close() { await pool.end(); },
  };
}
