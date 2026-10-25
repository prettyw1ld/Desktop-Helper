/* Ведущий по готовым сценариям (scenarios.js): работает без ИИ и без интернета.
   Кот находит нужную кнопку через системную «доступность», показывает на неё лапкой
   и сам замечает, что шаг сделан (открылось окно, вставили флешку, пропала кнопка). */

const coach = { active: false, sc: null, steps: [], i: -1, ctx: {}, target: null, seen: false, baseTitle: '', poll: null, polling: false, run: 0, idle: null, warnedAccess: false };

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
  return { op: 'find', scope: q.scope, name, types: q.types || [], enabled: q.enabled, firstWindow: q.firstWindow };
}

async function locate(q) {
  if (!q || !settings.locator) return [];
  const res = await api.locate(q);
  coach.locateError = res.error || '';
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
  if (cond.filePlace) {
    // Пока Mac: для Windows нужны окно Проводника и проверка текущей папки.
    // См. docs/guide-porting.md; окно Пушика не должно мешать распознаванию перехода.
    const result = await api.locate({ op: 'window', scope: 'proc:^Finder$', firstWindow: true });
    if (result.error) { coach.fileError = result.error; return false; }
    if (cond.foreground) {
      const front = await api.locate({ op: 'top' });
      if (front.win?.proc !== 'Finder') return false;
    }
    const titles = { practice: 'Пушик — учимся работать с файлами', postcards: 'Мои открытки', downloads: 'Загрузки|Downloads' };
    return result.win?.proc === 'Finder' && new RegExp(`^(${titles[cond.filePlace]})$`, 'i').test(result.win.title);
  }
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

function coachStepActions(step) {
  const acts = [[coach.sc.fileLesson && step.wait?.manual ? (step.find?.types?.includes('Edit') ? 'Нашёл файл' : T('files.next')) : T('g.done'), () => doneClicked(), true], [T(coach.sc.fileLesson ? 'files.again' : 'g.again'), () => showCoachStep(true)]];
  if (coach.sc.fileLesson) acts.push([T('files.help'), () => {
    clearInterval(coach.poll);
    clearTimeout(coach.idle);
    hideRing();
    say(stepSay(step), Infinity, { guide: true, explain: coach.fileError === 'automation' ? T('files.automation') : step.hint, actions: [[T('files.again'), () => showCoachStep(true), true], [T('files.menu'), () => { endGuide(false); showPanel('files'); }]] });
  }]);
  if (step.openFolder) acts.push(['Открыть папку', async () => {
    const result = await api.filesAction({ op: 'open', place: step.openFolder });
    if (!coach.active) return;
    if (result.error) say(T('files.error'), Infinity, { guide: true, actions: coachStepActions(step) });
    else showCoachStep(true);
  }]);
  if (step.open) acts.push([T('coach.open'), () => openForMe(step)]);
  acts.push([T('g.stop'), () => endGuide(true)]);
  return acts;
}

function coachExplanation(step, missing = false) {
  if (!coach.sc.fileLesson) return '';
  const error = coach.locateError;
  const prefix = error === 'access' ? T('files.access')
    : error === 'automation' ? T('files.automation')
    : error && error !== 'no_window' ? T('files.readError')
    : missing ? T('files.missing') : '';
  return [prefix, step.hint].filter(Boolean).join(' ');
}
function coachText(step) {
  return coach.sc.fileLesson ? `${T('files.progress', { n: coach.i + 1, total: coach.steps.length })}\n${stepSay(step)}` : stepSay(step);
}
async function showCoachStep(repeat = false) {
  const run = coach.run;
  const step = coach.steps[coach.i];
  if (!step || !coach.active) return;
  if (coach.advancing) return;
  if (cat.state === 'drag') return;
  coach.keepPosition = false;
  const text = coachText(step);
  const top = step.wait?.titleChange ? await api.locate({ op: 'top' }) : {};
  if (!coach.active || coach.steps[coach.i] !== step || coach.run !== run) return;
  if (!repeat) { coach.baseTitle = top.win?.title || ''; coach.seen = false; coach.misses = 0; }
  const items = await locate(fillQuery(step.find));
  if (!coach.active || coach.steps[coach.i] !== step || coach.run !== run) return;
  coach.target = items[0] || null;
  if (cat.state === 'drag') return;
  if (coach.target) coach.seen = true;
  if (!coach.target && step.optional && step.find && !repeat) { nextStep(); return; }
  const sayIt = () => {
    say(text, Infinity, { actions: coachStepActions(step), guide: true, explain: coachExplanation(step, repeat && !coach.target && !!step.find) });
    speak(stepSay(step));
  };
  if (coach.target) { showRing(coach.target); goPoint(coach.target, () => { if (coach.active && coach.run === run && coach.steps[coach.i] === step) sayIt(); }); } else { hideRing(); if (cat.state === 'perch') startFall(); sayIt(); }
  if (repeat) Sound.meow(1.1);
  startPoll();
}

function startPoll() {
  clearInterval(coach.poll);
  clearTimeout(coach.idle);
  coach.poll = setInterval(async () => {
    if (coach.polling || !coach.active || cat.state === 'drag') return;
    coach.polling = true;
    const run = coach.run;
    try {
      const step = coach.steps[coach.i];
      if (!step) return;
      const complete = !step.wait?.manual && await check(step.wait, step);
      if (!coach.active || coach.steps[coach.i] !== step || coach.run !== run) return;
      if (cat.state === 'drag') return;
      if (complete) { stepDone(); return; }
      if (step.find) {
        const items = await locate(fillQuery(step.find));
        if (!coach.active || coach.steps[coach.i] !== step || coach.run !== run || coach.advancing || cat.state === 'drag') return;
        const previous = coach.target;
        coach.target = items[0] || null;
        if (coach.target) {
          coach.seen = true;
          coach.misses = 0;
          showRing(coach.target);
          if (!previous) {
            const displayHint = () => {
              if (coach.active && coach.run === run && coach.steps[coach.i] === step) say(coachText(step), Infinity, { actions: coachStepActions(step), guide: true, explain: coachExplanation(step) });
            };
            if (coach.keepPosition) displayHint(); else goPoint(coach.target, displayHint);
          }
        } else {
          hideRing();
          coach.misses = (coach.misses || 0) + 1;
          // Allow Finder to finish opening/navigating before declaring a missing control.
          if (coach.sc.fileLesson && coach.misses === 3) say(coachText(step), Infinity, { actions: coachStepActions(step), guide: true, explain: coachExplanation(step, true) });
        }
      }
    } finally { coach.polling = false; }
  }, 1200);
  coach.idle = setTimeout(() => {
    if (!coach.active || cat.state === 'drag') return;
    say(T('g.idle'), 3000, { guide: true });
    speak(T('g.idle'));
    setTimeout(() => coach.active && showCoachStep(true), 3000);
  }, 50_000);
}

function stepDone() {
  if (!coach.active || coach.advancing || cat.state === 'drag') return;
  coach.advancing = true;
  clearInterval(coach.poll);
  hideRing();
  happy(700);
  Sound.meow(1.25);
  clearTimeout(coach.advance);
  coach.advance = setTimeout(nextStep, 500);
}

async function nextStep() {
  if (!coach.active) return;
  const run = coach.run;
  coach.advancing = false;
  coach.i++;
  coach.target = null;
  coach.keepPosition = false;
  // шаги, которые уже сделаны (флешка уже вставлена, WhatsApp уже открыт), пропускаем
  while (coach.active && coach.run === run && coach.i < coach.steps.length && await check(coach.steps[coach.i].skipIf, coach.steps[coach.i])) coach.i++;
  if (!coach.active || coach.run !== run) return;
  if (coach.i >= coach.steps.length) { finishScenario(); return; }
  showCoachStep();
}

async function doneClicked() {
  const run = coach.run;
  const step = coach.steps[coach.i];
  if (!step || coach.advancing || cat.state === 'drag') return;
  say(pick(I18N.list('g.checking')), Infinity, { guide: true });
  const complete = step.wait?.manual || step.allowConfirm || await check(step.wait, step) || (!coach.sc.fileLesson && await check({ next: true }, step));
  if (!coach.active || coach.steps[coach.i] !== step || coach.run !== run) return;
  if (complete) { stepDone(); return; }
  say(T('coach.notYet'), Infinity, { actions: coachStepActions(step), guide: true });
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

// После переноса сохраняем шаг и выбранное место. Это общая логика для обеих ОС.
// Новый прыжок нужен только для следующего шага или явного повтора подсказки.
function resumeCoachAfterDrag() {
  if (!coach.active || coach.advancing) return;
  const step = coach.steps[coach.i];
  if (!step) return;
  coach.keepPosition = true;
  say(coachText(step), Infinity, { guide: true, actions: coachStepActions(step), explain: coachExplanation(step) });
  if (coach.target) showRing(coach.target);
  startPoll();
}

function stopCoach() {
  coach.active = false;
  coach.run++;
  clearTimeout(coach.advance);
  clearInterval(coach.poll);
  clearTimeout(coach.idle);
}

function runScenario(sc) {
  closePanels();
  endTrainer();
  if (guide.active) endGuide(false);
  stopCoach();
  coach.advancing = false;
  coach.fileError = '';
  coach.locateError = '';
  coach.misses = 0;
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
  if (/помо[гщ].*(файл|проводник|finder)|help with files/i.test(text)) { showPanel('files'); return; }
  const m = Scenarios.match(text);
  if (m?.fileLesson) { startFileLesson(m.id); return; }
  if (m?.id === 'lost') { imLost(); return; }
  if (m?.id === 'photos' && /посмотреть фото с флешки|look at photos from a usb stick/i.test(text)) { showPanel('files'); return; }
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

// File menu: prepare a real Finder window before starting the existing coach.
let fileLaunch = 0;
async function startFileLesson(id) {
  const launch = ++fileLaunch;
  showPanel('files');
  const status = document.querySelector('#files-status');
  if (settings.platform !== 'darwin') { status.textContent = T('files.unsupported'); return; }
  const access = await api.filesAction({ op: 'access' });
  if (launch !== fileLaunch || openPanel !== 'files') return;
  if (!access.trusted) {
    status.textContent = T('files.access');
    for (const [label, fn] of [[T('files.permissions'), () => api.filesAction({ op: 'permissions' })], [T('files.retry'), () => startFileLesson(id)]]) {
      const b = document.createElement('button'); b.className = 'big'; b.textContent = label;
      b.addEventListener('click', fn); status.appendChild(b);
    }
    return;
  }
  status.textContent = T('files.opening');
  const sc = Scenarios.list.find((s) => s.id === id);
  const result = await api.filesAction({ op: 'open', place: sc.place });
  if (launch !== fileLaunch || openPanel !== 'files') return;
  if (result.error) { status.textContent = T('files.error'); return; }
  // Finder may still be creating its window. Polling will find the controls when ready.
  runScenario(sc);
}
document.querySelector('#files-back').addEventListener('click', () => { fileLaunch++; showPanel('help'); });
document.querySelectorAll('[data-files]').forEach((button) => button.addEventListener('click', async () => {
  const task = button.dataset.files;
  if (task === 'learn' || task === 'downloads') { await startFileLesson(`files-${task}`); return; }
  if (task === 'photos') { fileLaunch++; runScenario(Scenarios.list.find((s) => s.id === 'photos')); return; }
  const status = document.querySelector('#files-status');
  button.disabled = true;
  status.textContent = 'Выбери документ и нажми «Открыть».';
  try {
    const result = await api.filesAction({ op: 'choose' });
    status.textContent = result.error ? T('files.error') : result.canceled ? 'Можно выбрать другой файл, когда будешь готов.' : 'Файл открыт в своей программе.';
  } finally { button.disabled = false; }
}));
