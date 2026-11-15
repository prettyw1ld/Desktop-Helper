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
alter table devices add column if not exists grp text not null default '';
alter table devices add column if not exists packs text not null default '';
create index if not exists devices_token on devices (token_hash);
create table if not exists mood_history (
  device_id uuid not null references devices(id) on delete cascade,
  at timestamptz not null,
  mood text not null,
  reason text not null default ''
);
create index if not exists mood_history_device on mood_history (device_id, at);
alter table devices add column if not exists applied text not null default '';
create table if not exists configs (
  scope text primary key,
  version integer not null,
  payload text not null,
  sig text not null,
  at timestamptz not null default now()
);
`;

const row = (r) => r && ({
  id: r.id, deviceKey: r.device_key, host: r.host, user: r.user, os: r.os, version: r.version, tokenHash: r.token_hash,
  group: r.grp, packs: r.packs ? r.packs.split(',') : [], applied: r.applied ? JSON.parse(r.applied) : null,
  mood: r.mood, reason: r.reason, idleSec: r.idle_sec, createdAt: +r.created_at, lastSeen: +r.last_seen,
});

export async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await pool.query(SCHEMA);
  return {
    async enroll({ deviceKey, host, user, os, version, group = '', packs = [], tokenHash, now }) {
      const r = await pool.query(
        `insert into devices (id, device_key, host, "user", os, version, token_hash, created_at, last_seen, grp, packs)
         values ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0), $9, $10)
         on conflict (device_key) do update set host = $3, "user" = $4, os = $5, version = $6, token_hash = $7, grp = $9, packs = $10
         returning *, (xmax = 0) as fresh`,
        [crypto.randomUUID(), deviceKey, host, user, os, version, tokenHash, now, group, packs.join(',')]);
      // новое устройство: с этой записи начинается его история
      if (r.rows[0].fresh) await pool.query("insert into mood_history (device_id, at, mood) values ($1, to_timestamp($2 / 1000.0), 'awake')", [r.rows[0].id, now]);
      return row(r.rows[0]);
    },
    async byToken(tokenHash) {
      const r = await pool.query('select * from devices where token_hash = $1', [tokenHash]);
      return row(r.rows[0]) || null;
    },
    async beat(id, { mood, reason, idleSec, version, now, info = null, applied = null }) {
      if (applied) await pool.query('update devices set applied = $2 where id = $1', [id, JSON.stringify(applied)]);
      if (info) await pool.query('update devices set grp = $2, packs = $3 where id = $1', [id, info.group, info.packs.join(',')]);
      await pool.query(
        `insert into mood_history (device_id, at, mood, reason)
         select id, to_timestamp($4 / 1000.0), $2, $3 from devices where id = $1 and (mood <> $2 or reason <> $3)`,
        [id, mood, reason, now]);
      await pool.query(
        'update devices set mood = $2, reason = $3, idle_sec = $4, version = $5, last_seen = to_timestamp($6 / 1000.0) where id = $1',
        [id, mood, reason, idleSec, version, now]);
    },
    async list() { return (await pool.query('select * from devices order by host')).rows.map(row); },
    async history(id, since) {
      // смены состояния с момента since и одна до него: с неё начинается полоса истории
      const r = await pool.query(
        `(select at, mood, reason from mood_history where device_id = $1 and at < to_timestamp($2 / 1000.0) order by at desc limit 1)
         union all
         (select at, mood, reason from mood_history where device_id = $1 and at >= to_timestamp($2 / 1000.0))
         order by at`, [id, since]);
      return r.rows.map((h) => ({ deviceId: id, at: +h.at, mood: h.mood, reason: h.reason }));
    },
    async remove(id) { return (await pool.query('delete from devices where id = $1', [id])).rowCount > 0; },
    // версия набора только растёт: старый подписанный набор нельзя выложить снова
    async putConfig({ scope, version, payload, sig, now }) {
      const r = await pool.query(
        `insert into configs (scope, version, payload, sig, at) values ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
         on conflict (scope) do update set version = $2, payload = $3, sig = $4, at = to_timestamp($5 / 1000.0) where configs.version < $2`,
        [scope, version, payload, sig, now]);
      return r.rowCount > 0;
    },
    async configs() {
      return (await pool.query('select * from configs order by scope')).rows.map((c) => ({ scope: c.scope, version: c.version, payload: c.payload, sig: c.sig, at: +c.at }));
    },
    async close() { await pool.end(); },
  };
}
