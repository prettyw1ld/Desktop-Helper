// Хранилище в памяти: для проверки и маленькой демонстрации. После перезапуска всё забывается.
import crypto from 'node:crypto';

export function memoryStore() {
  const devices = new Map();   // id → устройство
  const history = [];          // смены состояния: { deviceId, at, mood, reason }
  return {
    async enroll({ deviceKey, host, user, os, version, group = '', packs = [], tokenHash, now }) {
      let d = [...devices.values()].find((x) => x.deviceKey === deviceKey);
      if (!d) {
        d = { id: crypto.randomUUID(), deviceKey, createdAt: now, mood: 'awake', reason: '', idleSec: 0, lastSeen: now };
        devices.set(d.id, d);
        history.push({ deviceId: d.id, at: now, mood: 'awake', reason: '' });
      }
      Object.assign(d, { host, user, os, version, group, packs, tokenHash });
      return { ...d };
    },
    async byToken(tokenHash) {
      const d = [...devices.values()].find((x) => x.tokenHash === tokenHash);
      return d ? { ...d } : null;
    },
    async beat(id, { mood, reason, idleSec, version, now, info = null }) {
      const d = devices.get(id);
      if (!d) return;
      if (info) Object.assign(d, { group: info.group, packs: info.packs });
      if (d.mood !== mood || d.reason !== reason) history.push({ deviceId: id, at: now, mood, reason });
      Object.assign(d, { mood, reason, idleSec, version, lastSeen: now });
    },
    async list() { return [...devices.values()].map((d) => ({ ...d })); },
    // смены состояния с момента since и одна до него: с неё начинается полоса истории
    async history(id, since) {
      const mine = history.filter((h) => h.deviceId === id);
      const before = mine.filter((h) => h.at < since).pop();
      return [...(before ? [before] : []), ...mine.filter((h) => h.at >= since)];
    },
    async remove(id) {
      for (let i = history.length - 1; i >= 0; i--) if (history[i].deviceId === id) history.splice(i, 1);
      return devices.delete(id);
    },
    async close() {},
  };
}
