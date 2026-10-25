// Помощник для новичка: снимок экрана → модель с зрением → куда показать лапкой.
// Снимок живёт только в памяти и на диск не пишется.

const { desktopCapturer, screen } = require('electron');

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const { resolve, pickModel, extraFor, cleanReply } = require('./llm');
const { fetchAI, fetchAIRetry } = require('./http');
const SHOT_W = 1024; // ширина снимка для модели (меньше = быстрее ответ)

// Ответ модели всегда в одном формате, через принудительный вызов инструмента.
const STEP_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['step', 'done', 'not_found', 'explain', 'danger'],
      description: 'step = next action to show; done = the goal is reached; not_found = cannot find a way on this screen; explain = answer to "I am lost"; danger = something unsafe is on screen',
    },
    say: { type: 'string', description: 'What the cat says. ONE action, max 12 words, plain words, no jargon.' },
    explain: { type: 'string', description: 'Only for explain/danger: 1-2 short sentences about what is on the screen and how to go back.' },
    target: {
      type: 'object',
      description: 'Box around the thing to press, in screenshot pixels. Omit if there is nothing to point at.',
      properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
      required: ['x', 'y', 'w', 'h'],
    },
    skill: { type: 'string', description: 'Only for done: the learned skill in 2-5 words, e.g. "Позвонить по видео".' },
  },
  required: ['status', 'say'],
};

function systemPrompt(lang, platform) {
  const os = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
  const ru = lang !== 'en';
  return [
    `You are Pushik, a kind pixel cat who lives on the desktop (${os}) and teaches a complete computer beginner`,
    '(for example a 68-year-old grandmother) to do things on the computer BY THEMSELVES.',
    'You get a screenshot of the screen and the person\'s goal. You never click for them: you point with your paw.',
    'Rules for "say":',
    '- exactly ONE physical action per hint, at most 12 words;',
    '- no computer terms: say "the cross in the top right corner", not "close the window"; say "the round blue picture", not "the icon";',
    '- describe things by colour, shape, picture and where they are on the screen;',
    '- warm and calm, like talking to a grandmother; you may start with "Мур!" rarely;',
    '- never ask for passwords, card numbers or codes from SMS; never suggest installing unknown programs.',
    'Rules for "target": the box (x, y, w, h in screenshot pixels, x/y = top-left corner) must tightly cover the thing to press.',
    'Prefer a slightly bigger box over missing the element. Ignore any cartoon cat, speech bubble or yellow ring on the screenshot: that is you.',
    'If the screen shows a bank card form, a download of an .exe from an unknown site or a scary "your PC is infected" banner, answer status "danger" and tell the person not to type anything and how to close it.',
    'If the goal is already reached on this screen, answer "done" with a short happy phrase and the skill name.',
    'If the hint needs typing, tell what to type in quotes, e.g. Напиши «погода».',
    ru ? 'Always answer in Russian.' : 'Always answer in English.',
  ].join('\n');
}

function userText({ mode, goal, history }) {
  const done = history.length ? `Hints already given (oldest first):\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}` : 'No hints yet.';
  if (mode === 'confused') {
    return `The person pressed "I am lost". ${goal ? `Their goal was: "${goal}". ` : ''}Look at the screen and answer with status "explain": `
      + 'in "explain" say simply what is open now, and in "say" give ONE action to go back or close it, with "target" on that button if you see it.';
  }
  if (mode === 'check') {
    return `Goal: "${goal}".\n${done}\nThe person says they did the last hint (or the screen changed). Look at the new screenshot. `
      + 'If the goal is reached, answer "done". If the last step worked, give the NEXT step. If it did not work, kindly show the same thing again in other words.';
  }
  return `Goal: "${goal}".\n${done}\nShow the first step towards the goal on this screen.`;
}

// ---------- Снимок экрана ----------
// overlay: окно кота. Его прячем на время снимка, чтобы модель не видела кота и облачка.
async function capture(overlay, width = SHOT_W) {
  const display = screen.getPrimaryDisplay();
  const { width: dw, height: dh } = display.size;
  const w = Math.min(width, dw);
  const h = Math.round((dh * w) / dw);
  const hide = overlay && !overlay.isDestroyed() && overlay.isVisible();
  if (hide) { overlay.setOpacity(0); await new Promise((r) => setTimeout(r, 90)); }
  let sources;
  try {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  } finally {
    if (hide) overlay.setOpacity(1);
  }
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw Object.assign(new Error('no screenshot'), { code: 'noShot' });
  const size = src.thumbnail.getSize();
  return { image: src.thumbnail, w: size.width, h: size.height, display };
}

// Перевод рамки из пикселей снимка в координаты окна кота (оно на всю рабочую область).
function toOverlay(box, shot) {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) return null;
  const { display } = shot;
  const kx = display.size.width / shot.w;
  const ky = display.size.height / shot.h;
  const wa = display.workArea;
  const r = {
    x: Math.round(box.x * kx + display.bounds.x - wa.x),
    y: Math.round(box.y * ky + display.bounds.y - wa.y),
    w: Math.round(box.w * kx),
    h: Math.round(box.h * ky),
  };
  if (r.w < 4 || r.h < 4) return null;
  return r;
}

// ---------- Модели ----------
async function readError(res) {
  let msg = `HTTP ${res.status}`;
  try { const j = await res.json(); msg = j.error?.message || j.error || msg; } catch { /* пусто */ }
  return new Error(msg);
}

async function askClaude({ apiKey, model, system, text, jpeg }) {
  const res = await fetchAI(CLAUDE_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system,
      tools: [{ name: 'show_step', description: 'Show the person what to do next.', input_schema: STEP_SCHEMA }],
      tool_choice: { type: 'tool', name: 'show_step' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } },
          { type: 'text', text },
        ],
      }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  const use = data.content.find((b) => b.type === 'tool_use');
  if (!use) throw new Error('empty answer');
  return use.input;
}

// OpenAI-совместимые сервисы с зрением (Groq llama-4-scout, OpenRouter qwen2.5-vl …): ответ строго JSON
async function askOpenAI({ apiKey, url, vision, system, text, jpeg }) {
  const schema = JSON.stringify(STEP_SCHEMA);
  const model = await pickModel({ url, apiKey, want: vision, vision: true });
  const send = (strict) => fetchAIRetry(`${url}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      ...extraFor(model),
      ...(strict ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: `${system}\nAnswer ONLY with a JSON object matching this JSON schema: ${schema}` },
        { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } }] },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  let res = await send(true);
  // строгий JSON иногда не проходит проверку сервиса: тогда просим без него и вырезаем JSON сами
  if (res.status === 400) res = await send(false);
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  const raw = cleanReply(data.choices?.[0]?.message?.content) || '{}';
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) || '{}';
  return JSON.parse(json);
}

// Ollama: нужна модель с зрением (qwen2.5vl, llava, gemma3).
async function askOllama({ ollamaUrl, visionModel, ollamaModel, system, text, jpeg }) {
  let res;
  try {
    res = await fetchAI(`${ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: visionModel || ollamaModel,
        stream: false,
        format: STEP_SCHEMA,
        messages: [{ role: 'system', content: system }, { role: 'user', content: text, images: [jpeg] }],
      }),
    });
  } catch {
    throw Object.assign(new Error('offline'), { offline: true });
  }
  if (!res.ok) throw await readError(res);
  const msg = (await res.json()).message || {};
  return JSON.parse(String(msg.content || '{}').replace(/<think>[\s\S]*?<\/think>/g, ''));
}

/**
 * look({ mode: 'start'|'check'|'confused', goal, history, settings, overlay })
 * → { status, say, explain?, target?: {x,y,w,h} в координатах окна кота, skill? }
 */
async function look({ mode, goal, history = [], settings, overlay }) {
  const shot = await capture(overlay);
  const jpeg = shot.image.toJPEG(70).toString('base64');
  const system = systemPrompt(settings.lang, process.platform);
  const text = `${userText({ mode, goal, history })}\nScreenshot size: ${shot.w}x${shot.h} pixels.`;
  const r = resolve(settings);
  const fn = r.kind === 'ollama' ? askOllama : r.kind === 'openai' ? askOpenAI : askClaude;
  const out = await fn({ ...settings, ...(r.kind === 'openai' ? { url: r.url, vision: r.vision } : {}), system, text, jpeg });
  const status = ['step', 'done', 'not_found', 'explain', 'danger'].includes(out.status) ? out.status : 'step';
  return {
    status,
    say: String(out.say || '').trim(),
    explain: out.explain ? String(out.explain).trim() : '',
    skill: out.skill ? String(out.skill).trim() : '',
    target: toOverlay(out.target, shot),
  };
}

// ---------- Слежка за изменениями экрана ----------
// Маленькие снимки раз в 1.2 с. Сравниваем с первым, пропуская места, где нарисован сам кот
// (masks в координатах окна кота). Если экран заметно поменялся, зовём onChange.
let watchTimer = null;
function watch({ masks = [], onChange }) {
  unwatch();
  let base = null;
  let busy = false;
  const W = 160;
  watchTimer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const display = screen.getPrimaryDisplay();
      const h = Math.round((display.size.height * W) / display.size.width);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W, height: h } });
      const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
      if (!src || !watchTimer) return;
      const bmp = src.thumbnail.toBitmap();
      const size = src.thumbnail.getSize();
      const k = size.width / display.size.width;
      const offX = display.workArea.x - display.bounds.x;
      const offY = display.workArea.y - display.bounds.y;
      const masked = (x, y) => masks.some((m) => {
        const mx = (m.x + offX) * k; const my = (m.y + offY) * k;
        return x >= mx - 2 && x <= mx + m.w * k + 2 && y >= my - 2 && y <= my + m.h * k + 2;
      });
      if (!base) { base = bmp; return; }
      let diff = 0;
      let n = 0;
      for (let y = 0; y < size.height; y += 2) {
        for (let x = 0; x < size.width; x += 2) {
          if (masked(x, y)) continue;
          const i = (y * size.width + x) * 4;
          const d = Math.abs(bmp[i] - base[i]) + Math.abs(bmp[i + 1] - base[i + 1]) + Math.abs(bmp[i + 2] - base[i + 2]);
          if (d > 60) diff++;
          n++;
        }
      }
      // поменялось больше 3% экрана: открылось окно, страница и т.п.
      if (n && diff / n > 0.03) { unwatch(); onChange(); }
    } catch { /* нет доступа к экрану: просто ждём кнопку «Сделал» */ } finally { busy = false; }
  }, 1200);
}
function unwatch() { clearInterval(watchTimer); watchTimer = null; }

module.exports = { look, watch, unwatch, capture, systemPrompt };
