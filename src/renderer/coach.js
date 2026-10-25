/* Ведущий по готовым сценариям (scenarios.js): работает без ИИ и без интернета.
   Кот находит нужную кнопку через системную «доступность», показывает на неё лапкой
   и сам замечает, что шаг сделан (открылось окно, вставили флешку, пропала кнопка). */

const coach = { active: false, sc: null, steps: [], i: -1, ctx: {}, target: null, seen: false, baseTitle: '', poll: null, polling: false, idle: null, warnedAccess: false };

const plat = () => (settings.platform === 'darwin' ? 'mac' : 'win');
const stepSay = (step) => fillText(!coach.ctx.contact && step.sayNoContact ? step.sayNoContact : step.say);
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fillText(s) {
  return String(s || '')
    .replace(/\{contact\}/g, coach.ctx.contact || T('coach.grandson'))
    .replace(/\{drive\}/g, coach.ctx.drive ? `(${coach.ctx.drive}:)` : '')
    .replace(/\{label\}/g, coach.ctx.label || T('coach.usb'))
    .replace(/\s+/g, ' ').trim();
}
function fillQuery(q) {
  if (!q) return null;
  let name = q.name || '';
  if (name.includes('{contact}') && !coach.ctx.contact) return null; // не знаем имени: просто говорим словами
  name = name.replace(/\{contact\}/g, esc(coach.ctx.contact))
    .replace(/\{drive\}/g, esc(coach.ctx.drive || 'Z'))
    .replace(/\{label\}/g, coach.ctx.label ? esc(coach.ctx.label) : 'USB|Съёмный|Removable');
  return { op: 'find', scope: q.scope, name, types: q.types || [], enabled: q.enabled };
}

async function locate(q) {
  if (!q || !settings.locator) return [];
  const res = await api.locate(q);
  if (res.error === 'access' && !coach.warnedAccess) {
    coach.warnedAccess = true;
    say(T('coach.noAccess'), 6000, { guide: true });
  }
  let items = res.items || [];
  if (q.enabled) items = items.filter((it) => it.enabled);
  return items;
}

// Выполнено ли условие шага
async function check(cond, step) {
  if (!cond) return false;
  if (cond.manual) return false;
  if (cond.drive) {
    const res = await api.locate({ op: 'drives' });
    const d = (res.drives || [])[0];
    if (d) { coach.ctx.drive = d.letter; coach.ctx.label = d.label || ''; }
    return !!d;
  }
  if (cond.top || cond.titleChange) {
    const res = await api.locate({ op: 'top' });
    const w = res.win;
    if (!w) return false;
    if (cond.top) return new RegExp(cond.top, 'i').test(w.proc || '');
    return !!coach.baseTitle && w.title !== coach.baseTitle;
  }
  if (cond.find) return (await locate(fillQuery(cond.find))).length > 0;
  if (cond.next) {
    const next = coach.steps[coach.i + 1];
    return !!next?.find && (await locate(fillQuery(next.find))).length > 0;
  }
  if (cond.focus) return (await locate(fillQuery(step.find))).some((it) => it.focused);
  if (cond.gone) return coach.seen && (await locate(fillQuery(step.find))).length === 0;
  return false;
}

function stepActions(step) {
  const acts = [[T('g.done'), () => doneClicked(), true], [T('g.again'), () => showCoachStep(true)]];
  if (step.open) acts.push([T('coach.open'), () => openForMe(step)]);
  acts.push([T('g.stop'), () => endGuide(true)]);
  return acts;
}

async function showCoachStep(repeat = false) {
  const step = coach.steps[coach.i];
  if (!step || !coach.active) return;
  const text = stepSay(step);
  const top = await api.locate({ op: 'top' });
  if (!repeat) { coach.baseTitle = top.win?.title || ''; coach.seen = false; }
  const items = await locate(fillQuery(step.find));
  if (!coach.active || coach.steps[coach.i] !== step) return;
  coach.target = items[0] || null;
  if (coach.target) coach.seen = true;
  if (!coach.target && step.optional && step.find && !repeat) { nextStep(); return; }
  const sayIt = () => {
    say(text, Infinity, { actions: stepActions(step), guide: true });
    speak(text);
  };
  if (coach.target) { showRing(coach.target); goPoint(coach.target, sayIt); } else { hideRing(); if (cat.state === 'perch') startFall(); sayIt(); }
  if (repeat) Sound.meow(1.1);
  startPoll();
}

function startPoll() {
  clearInterval(coach.poll);
  clearTimeout(coach.idle);
  coach.poll = setInterval(async () => {
    if (coach.polling || !coach.active) return;
    coach.polling = true;
    try {
      const step = coach.steps[coach.i];
      if (!step) return;
      if (await check(step.wait, step)) { stepDone(); return; }
      // кнопки не было видно, а теперь появилась: показываем
      if (step.find && !coach.target) {
        const items = await locate(fillQuery(step.find));
        if (items[0] && coach.active && coach.steps[coach.i] === step) {
          coach.target = items[0];
          coach.seen = true;
          showRing(coach.target);
          goPoint(coach.target, () => say(stepSay(step), Infinity, { actions: stepActions(step), guide: true }));
        }
      }
    } finally { coach.polling = false; }
  }, 1200);
  coach.idle = setTimeout(() => {
    if (!coach.active) return;
    say(T('g.idle'), 3000, { guide: true });
    speak(T('g.idle'));
    setTimeout(() => coach.active && showCoachStep(true), 3000);
  }, 50_000);
}

function stepDone() {
  clearInterval(coach.poll);
  hideRing();
  happy(700);
  Sound.meow(1.25);
  setTimeout(nextStep, 500);
}

async function nextStep() {
  if (!coach.active) return;
  coach.i++;
  // шаги, которые уже сделаны (флешка уже вставлена, WhatsApp уже открыт), пропускаем
  while (coach.i < coach.steps.length && await check(coach.steps[coach.i].skipIf, coach.steps[coach.i])) coach.i++;
  if (!coach.active) return;
  if (coach.i >= coach.steps.length) { finishScenario(); return; }
  showCoachStep();
}

async function doneClicked() {
  const step = coach.steps[coach.i];
  if (!step) return;
  say(pick(I18N.list('g.checking')), Infinity, { guide: true });
  if (await check(step.wait, step) || await check({ next: true }, step) || step.wait?.manual) { stepDone(); return; }
  say(T('coach.notYet'), Infinity, { actions: stepActions(step), guide: true });
  speak(T('coach.notYet'));
  if (coach.target) goPoint(coach.target);
}

async function openForMe(step) {
  say(T('coach.opening'), 2500, { guide: true });
  if (step.open === 'drive') await api.openDrive(coach.ctx.drive);
  else await api.openUri(step.open);
  clearInterval(coach.poll);
  hideRing();
  // после «открой за меня» следующий осмысленный шаг: тот, где открытое окно уже нужно
  const after = { 'ms-settings:easeofaccess-display': 'Slider', drive: null };
  const want = after[step.open];
  setTimeout(() => {
    if (!coach.active) return;
    if (want) {
      const j = coach.steps.findIndex((s) => s.find?.types?.includes(want));
      if (j > coach.i) coach.i = j - 1;
    } else if (step.open === 'drive') {
      const j = coach.steps.findIndex((s, k) => k > coach.i && s.optional);
      if (j > coach.i) coach.i = j - 1;
    }
    nextStep();
  }, 2500);
}

async function finishScenario() {
  const sc = coach.sc;
  stopCoach();
  guide.active = false;
  hideRing();
  const text = sc.done || pick(I18N.list('g.success'));
  say(`${text}\n${T('g.skillSaved')}`, 8000, { guide: true });
  speak(text);
  celebrate();
  settings.skills = await api.addSkill(sc.skill[I18N.lang] || sc.skill.ru);
  setTimeout(() => { if (cat.state === 'perch') startFall(); }, 2500);
}

function stopCoach() {
  coach.active = false;
  clearInterval(coach.poll);
  clearTimeout(coach.idle);
}

function runScenario(sc) {
  closePanels();
  endTrainer();
  if (guide.active) endGuide(false);
  stopCoach();
  coach.sc = sc;
  coach.steps = sc[plat()] || sc.win;
  coach.i = -1;
  coach.ctx = { contact: String(settings.contact || '').trim() };
  coach.active = true;
  guide.active = true;      // для остального кода кот сейчас занят человеком
  guide.kind = 'script';
  guide.goal = '';
  if (!settings.locator) say(T('coach.noLocator'), 3500, { guide: true });
  nextStep();
}

// Кнопка-задача или фраза человека → готовый сценарий, иначе ИИ (если есть), иначе подсказка.
function routeGoal(text) {
  const m = Scenarios.match(text);
  if (m?.id === 'lost') { imLost(); return; }
  if (m) { runScenario(m); return; }
  if (settings.aiReady) { startGuide(goalOf(text)); return; }
  showPanel('help');
  micState(T('coach.unknown'));
  speak(T('coach.unknown'));
}

// «Я запутался» без ИИ: какое окно открыто и где у него крестик.
const APP_NAMES = {
  chrome: 'браузер Google Chrome, это интернет', msedge: 'браузер Edge, это интернет', firefox: 'браузер Firefox, это интернет',
  browser: 'Яндекс Браузер, это интернет', opera: 'браузер Opera, это интернет', safari: 'браузер Safari, это интернет',
  explorer: 'Проводник, здесь папки и файлы', finder: 'Finder, здесь папки и файлы', whatsapp: 'WhatsApp',
  telegram: 'Telegram', winword: 'Word, здесь пишут тексты', excel: 'Excel, здесь таблицы',
  systemsettings: 'Параметры компьютера', applicationframehost: 'программа Windows', 'system settings': 'Настройки компьютера',
  photos: 'Фотографии', microsoft: 'программа Microsoft', notepad: 'Блокнот', preview: 'Просмотр картинок',
};
async function lostOffline() {
  const wasCoach = coach.active;
  clearInterval(coach.poll);
  catEl.classList.add('thinking');
  const res = settings.locator ? await api.locate({ op: 'top' }) : {};
  catEl.classList.remove('thinking');
  const w = res.win;
  const back = () => {
    hideBubble();
    hideRing();
    if (wasCoach && coach.active) showCoachStep(true);
    else { guide.active = false; if (cat.state === 'perch') startFall(); }
  };
  const acts = [[T('g.ok'), back, true], [T('g.stop'), () => endGuide(true)]];
  if (!w) {
    say(T('lost.desktop'), Infinity, { actions: acts, guide: true });
    speak(T('lost.desktop'));
    return;
  }
  const key = String(w.proc || '').toLowerCase();
  const name = APP_NAMES[key] || Object.entries(APP_NAMES).find(([k]) => key.includes(k))?.[1] || `«${w.title || w.proc}»`;
  const text = T('lost.window', { name });
  const tip = w.close ? T('lost.close') : T('lost.noClose');
  const show = () => { say(text, Infinity, { actions: acts, guide: true, explain: tip }); speak(`${text} ${tip}`); };
  if (w.close) { showRing(w.close); goPoint(w.close, show); } else show();
}

// imLost из app.js: без ИИ отвечаем сами
const imLostAI = imLost;
imLost = function imLostAny() {
  if (settings.aiReady) { imLostAI(); return; }
  closePanels();
  endTrainer();
  guide.active = true;
  if (!coach.active) guide.kind = 'lost';
  lostOffline();
};

// endGuide из app.js: заодно останавливаем сценарий
const endGuideAI = endGuide;
endGuide = function endGuideAll(sayBye) {
  stopCoach();
  endGuideAI(sayBye);
};
