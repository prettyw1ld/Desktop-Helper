// Админ-панель: коты по подразделениям, карточка с историей за 7 дней и режим «табло» для большого экрана.
// Текст вставляется только через textContent.
const LABEL = { awake: 'Бодрствует', dozing: 'Дремлет', asleep: 'Спит', lost: 'Потерялся', offline: 'Не в сети' };
const SHORT = { awake: 'бодрствует', dozing: 'дремлет', asleep: 'спит', lost: 'потерялся', offline: 'не в сети' };
const REASON = { lock: 'экран заблокирован', suspend: 'компьютер в спящем режиме', quit: 'Пушик выключен', logoff: 'вышел из системы', shutdown: 'компьютер выключен' };
const ORDER = ['awake', 'dozing', 'asleep', 'lost', 'offline'];
const NO_GROUP = 'Без подразделения';
let data = null;
let only = '';
let board = location.hash === '#board';
let timer = 0;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const color = (s) => `var(--${s})`;
const stateText = (d) => {
  const reason = d.status === 'asleep' && REASON[d.reason] ? ` (${REASON[d.reason]})` : '';
  const idle = d.status === 'dozing' ? ` (${Math.round(d.idleSec / 60)} мин без мыши)` : '';
  return `${LABEL[d.status]}${reason}${idle}`;
};

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return `${Math.round(s / 86400)} дн назад`;
}

function renderCounts() {
  const counts = $('counts');
  counts.replaceChildren();
  for (const s of ORDER) {
    const b = el('button', 'count');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!board && only === s));
    const dot = el('span', 'dot');
    dot.style.background = color(s);
    if (board) b.append(el('strong', '', String(data.counts[s])), dot, LABEL[s]);
    else b.append(dot, `${LABEL[s]}: ${data.counts[s]}`);
    b.addEventListener('click', () => { if (board) return; only = only === s ? '' : s; render(); });
    counts.append(b);
  }
}

function tile(d) {
  const card = el('button', 'cat');
  card.type = 'button';
  card.style.borderLeftColor = color(d.status);
  const state = el('span', 'state', board ? LABEL[d.status] : stateText(d));
  state.style.color = color(d.status);
  card.append(el('b', '', d.host || '—'), el('span', 'sub', d.user || ''), state);
  const seen = el('span', 'sub extra', `Был в сети: ${ago(data.now - d.lastSeen)}`);
  card.append(seen);
  card.addEventListener('click', () => { if (!board) void openCard(d.id); });
  return card;
}

function render() {
  if (!data) return;
  document.body.classList.toggle('board', board);
  $('board').textContent = board ? 'Выйти из табло' : 'Табло';
  renderCounts();
  const q = board ? '' : $('q').value.trim().toLowerCase();
  const list = $('list');
  list.replaceChildren();
  const shown = data.devices
    .filter((d) => (board || !only || d.status === only) && (!q || `${d.host} ${d.user} ${d.group}`.toLowerCase().includes(q)))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.host.localeCompare(b.host));
  if (!shown.length) list.append(el('div', 'empty', data.devices.length ? 'Никого не нашлось' : 'Пока ни один Пушик не подключился'));
  // подразделения по алфавиту, «без подразделения» в конце; если подразделений нет совсем — один список без заголовка
  const groups = new Map();
  for (const d of shown) { const g = d.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); }
  const names = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'ru'));
  const titled = names.some((n) => n);
  for (const name of names) {
    const items = groups.get(name);
    const sec = el('section');
    if (titled) {
      const h = el('h2', '', name || NO_GROUP);
      const parts = ORDER.map((s) => [s, items.filter((d) => d.status === s).length]).filter(([, n]) => n).map(([s, n]) => `${SHORT[s]} ${n}`);
      h.append(el('small', '', `всего ${items.length}: ${parts.join(', ')}`));
      sec.append(h);
    }
    const grid = el('div', 'grid');
    for (const d of items) grid.append(tile(d));
    sec.append(grid);
    list.append(sec);
  }
  $('foot').textContent = `Обновлено ${new Date(data.now).toLocaleTimeString('ru-RU')}. Всего устройств: ${data.devices.length}.`;
  $('clock').textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ---------- карточка устройства ----------

/** Отрезки для полосы истории: смены состояния, а в конце — «потерялся» или «не в сети», если кот замолчал. */
function segments(c) {
  const out = [];
  const h = c.history;
  const d = c.device;
  const silent = d.status === 'lost' || d.status === 'offline';
  const end = silent ? Math.max(c.since, d.lastSeen) : c.now;
  for (let i = 0; i < h.length; i++) {
    const from = h[i].at;
    const to = i + 1 < h.length ? h[i + 1].at : end;
    if (to > from) out.push({ from, to, state: h[i].mood });
  }
  if (silent && c.now > end) out.push({ from: end, to: c.now, state: d.status });
  return out;
}

async function openCard(id) {
  const r = await fetch(`api/devices/${id}`, { cache: 'no-store' });
  if (!r.ok) return;
  const c = await r.json();
  const d = c.device;
  $('card-title').textContent = d.host || '—';
  $('card-user').textContent = d.user || '';
  const facts = $('card-facts');
  facts.replaceChildren();
  const fact = (k, v, tone) => { const dd = el('dd', '', v); if (tone) { dd.style.color = color(tone); dd.style.fontWeight = '600'; } facts.append(el('dt', '', k), dd); };
  fact('Сейчас', stateText(d), d.status);
  fact('Был в сети', `${ago(c.now - d.lastSeen)} (${new Date(d.lastSeen).toLocaleString('ru-RU')})`);
  fact('Подразделение', d.group || '—');
  fact('Пакеты', d.packs.length ? d.packs.join(', ') : '—');
  const cfg = Object.entries(d.config || {});
  fact('Настройки с сервера', cfg.length ? cfg.map(([scope, v]) => `${scope} v${v}`).join(', ') : 'нет');
  fact('Версия Пушика', d.version || '?');
  fact('Система', d.os || '?');
  fact('Подключён с', new Date(d.createdAt).toLocaleDateString('ru-RU'));

  const bar = $('card-bar');
  bar.replaceChildren();
  const span = c.now - c.since;
  let at = c.since;
  const total = {};
  for (const s of segments(c)) {
    if (s.from > at) { const gap = el('i'); gap.style.width = `${((s.from - at) / span) * 100}%`; bar.append(gap); }
    const part = el('i');
    part.style.width = `${((s.to - s.from) / span) * 100}%`;
    part.style.background = color(s.state);
    part.title = `${LABEL[s.state]}: ${new Date(s.from).toLocaleString('ru-RU')} — ${new Date(s.to).toLocaleString('ru-RU')}`;
    bar.append(part);
    total[s.state] = (total[s.state] || 0) + (s.to - s.from);
    at = s.to;
  }
  const hours = (ms) => (ms >= 3600_000 ? `${Math.round(ms / 3600_000)} ч` : `${Math.max(1, Math.round(ms / 60_000))} мин`);
  bar.setAttribute('aria-label', ORDER.filter((s) => total[s]).map((s) => `${LABEL[s]} ${hours(total[s])}`).join(', ') || 'нет данных');
  const days = $('card-days');
  days.replaceChildren(el('span', '', new Date(c.since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })),
    el('span', '', ORDER.filter((s) => total[s]).map((s) => `${LABEL[s].toLowerCase()} ${hours(total[s])}`).join(' · ') || 'нет данных'),
    el('span', '', 'сейчас'));

  const log = $('card-log');
  log.replaceChildren();
  for (const h of [...c.history].reverse().slice(0, 100)) {
    const li = el('li');
    const t = el('time', '', new Date(h.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    const what = el('span', '', `${LABEL[h.mood]}${REASON[h.reason] ? ` (${REASON[h.reason]})` : ''}`);
    what.style.color = color(h.mood);
    li.append(t, what);
    log.append(li);
  }
  if (!c.history.length) log.append(el('li', 'sub', 'За 7 дней состояние не менялось'));

  $('card-forget').onclick = async () => {
    if (!confirm(`Забыть ${d.host}? Пушик на нём зарегистрируется заново при следующем запуске.`)) return;
    await fetch(`api/devices/${d.id}`, { method: 'DELETE' });
    $('card').close();
    void load();
  };
  $('card').showModal();
}

// ---------- загрузка и табло ----------

async function load() {
  try {
    const r = await fetch('api/devices', { cache: 'no-store' });
    if (r.ok) { data = await r.json(); render(); }
  } catch { /* сеть моргнула — попробуем ещё раз */ }
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(load, board ? 5_000 : 15_000); // табло обновляется чаще
}

function setBoard(on) {
  board = on;
  history.replaceState(null, '', on ? '#board' : location.pathname);
  if (on) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) void document.exitFullscreen();
  schedule();
  render();
}

$('q').addEventListener('input', render);
$('board').addEventListener('click', () => setBoard(!board));
$('card-close').addEventListener('click', () => $('card').close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && board && !$('card').open) setBoard(false); });
void load();
schedule();
