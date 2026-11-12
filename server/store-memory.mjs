// Хранилище в памяти: для проверки и маленькой демонстрации. После перезапуска всё забывается.
import crypto from 'node:crypto';

export function memoryStore() {
  const devices = new Map();   // id → устройство
  const history = [];          // смены состояния: { deviceId, at, mood, reason }
  return {
    async enroll({ deviceKey, host, user, os, version, tokenHash, now }) {
      let d = [...devices.values()].find((x) => x.deviceKey === deviceKey);
      if (!d) {
        d = { id: crypto.randomUUID(), deviceKey, createdAt: now, mood: 'awake', reason: '', idleSec: 0, lastSeen: now };
        devices.set(d.id, d);
      }
      Object.assign(d, { host, user, os, version, tokenHash });
      return { ...d };
    },
    async byToken(tokenHash) {
      const d = [...devices.values()].find((x) => x.tokenHash === tokenHash);
      return d ? { ...d } : null;
    },
    async beat(id, { mood, reason, idleSec, version, now }) {
      const d = devices.get(id);
      if (!d) return;
      if (d.mood !== mood || d.reason !== reason) history.push({ deviceId: id, at: now, mood, reason });
      Object.assign(d, { mood, reason, idleSec, version, lastSeen: now });
    },
    async list() { return [...devices.values()].map((d) => ({ ...d })); },
    async history(id, since) { return history.filter((h) => h.deviceId === id && h.at >= since); },
    async remove(id) { return devices.delete(id); },
    async close() {},
  };
}
