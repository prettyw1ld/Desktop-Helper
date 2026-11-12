// Админ-панель: список котов, обновляется раз в 15 секунд. Текст вставляется только через textContent.
const LABEL = { awake: 'Бодрствует', dozing: 'Дремлет', asleep: 'Спит', lost: 'Потерялся', offline: 'Не в сети' };
const REASON = { lock: 'экран заблокирован', suspend: 'компьютер в спящем режиме', quit: 'Пушик выключен', logoff: 'вышел из системы', shutdown: 'компьютер выключен' };
const ORDER = ['awake', 'dozing', 'asleep', 'lost', 'offline'];
let data = null;
let only = '';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const color = (s) => `var(--${s})`;

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return `${Math.round(s / 86400)} дн назад`;
}

function render() {
  if (!data) return;
  const counts = document.getElementById('counts');
  counts.replaceChildren();
  for (const s of ORDER) {
    const b = el('button', 'count');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(only === s));
    const dot = el('span', 'dot');
    dot.style.background = color(s);
    b.append(dot, `${LABEL[s]}: ${data.counts[s]}`);
    b.addEventListener('click', () => { only = only === s ? '' : s; render(); });
    counts.append(b);
  }
  const q = document.getElementById('q').value.trim().toLowerCase();
  const list = document.getElementById('list');
  list.replaceChildren();
  const shown = data.devices
    .filter((d) => (!only || d.status === only) && (!q || `${d.host} ${d.user}`.toLowerCase().includes(q)))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.host.localeCompare(b.host));
  if (!shown.length) list.append(el('div', 'empty', data.devices.length ? 'Никого не нашлось' : 'Пока ни один Пушик не подключился'));
  for (const d of shown) {
    const card = el('article', 'cat');
    card.style.borderLeft = `8px solid ${color(d.status)}`;
    const reason = d.status === 'asleep' && REASON[d.reason] ? ` (${REASON[d.reason]})` : '';
    const idle = d.status === 'dozing' ? ` (${Math.round(d.idleSec / 60)} мин без мыши)` : '';
    const state = el('span', 'state', `${LABEL[d.status]}${reason}${idle}`);
    state.style.color = color(d.status);
    const forget = el('button', '', 'Забыть устройство');
    forget.type = 'button';
    forget.addEventListener('click', async () => {
      if (!confirm(`Забыть ${d.host}? Пушик на нём зарегистрируется заново при следующем запуске.`)) return;
      await fetch(`api/devices/${d.id}`, { method: 'DELETE' });
      void load();
    });
    card.append(el('b', '', d.host || '—'), el('span', 'sub', d.user || ''), state,
      el('span', 'sub', `Был в сети: ${ago(data.now - d.lastSeen)}`), el('span', 'sub', `Версия ${d.version || '?'} · ${d.os || ''}`), forget);
    list.append(card);
  }
  document.getElementById('foot').textContent = `Обновлено ${new Date(data.now).toLocaleTimeString('ru-RU')}. Всего устройств: ${data.devices.length}.`;
}

async function load() {
  try {
    const r = await fetch('api/devices', { cache: 'no-store' });
    if (r.ok) { data = await r.json(); render(); }
  } catch { /* сеть моргнула — попробуем через 15 с */ }
}

document.getElementById('q').addEventListener('input', render);
void load();
setInterval(load, 15_000);
