// Чат Пуша: Claude (Messages API) или локальная Ollama.
// Оба варианта умеют вызывать инструменты: напоминания, фокус, календарь.

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

const TOOLS = [
  {
    name: 'set_reminder',
    description: 'Set a reminder for the user in the given number of minutes.',
    schema: {
      type: 'object',
      properties: {
        minutes: { type: 'number', description: 'In how many minutes to remind' },
        text: { type: 'string', description: 'Reminder text' },
      },
      required: ['minutes', 'text'],
    },
  },
  {
    name: 'list_reminders',
    description: 'List active reminders and focus sessions.',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_reminder',
    description: 'Cancel a reminder by id (get ids from list_reminders).',
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'start_focus',
    description: 'Start a focus (pomodoro) session for the given number of minutes.',
    schema: { type: 'object', properties: { minutes: { type: 'number' } }, required: ['minutes'] },
  },
  {
    name: 'get_calendar_events',
    description: "Get the user's Google Calendar events for the next N days (default 1 = today).",
    schema: { type: 'object', properties: { days: { type: 'number' } } },
  },
];

function systemPrompt({ userName, lang }) {
  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  const now = new Date().toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });
  const ru = [
    'Ты Пушик, добрый пиксельный кот.',
    'Ты живёшь на рабочем столе пользователя и помогаешь ему: отвечаешь на вопросы,',
    'помогаешь с текстами и задачами, ставишь напоминания и фокус-сессии, смотришь его календарь через инструменты.',
    'Отвечай коротко и дружелюбно, по-русски, если пользователь не пишет на другом языке.',
    'Иногда можно вставить «мяу» или «мур», но без перебора. Ответ показывается в маленьком окошке,',
    'поэтому избегай длинных простыней текста и сложной разметки.',
    userName ? `Пользователя зовут ${userName}.` : '',
    `Сейчас: ${now}.`,
  ];
  const en = [
    'You are Pushik, a kind pixel cat.',
    "You live on the user's desktop and help them: answer questions, help with texts and tasks,",
    'set reminders and focus sessions, and check their calendar using tools.',
    'Answer briefly and kindly, in English unless the user writes in another language.',
    'You may add a "meow" or "purr" now and then, but not too often. Replies are shown in a small window,',
    'so avoid long walls of text and complex formatting.',
    userName ? `The user's name is ${userName}.` : '',
    `Now: ${now}.`,
  ];
  return (lang === 'en' ? en : ru).filter(Boolean).join(' ');
}

async function runTool(tools, name, input) {
  try {
    return tools[name] ? String(await tools[name](input || {})) : 'Unknown tool';
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

async function readError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    msg = j.error?.message || j.error || msg;
  } catch { /* пусто */ }
  return new Error(msg);
}

// ---------- Claude ----------
async function askClaude({ apiKey, model, history, text, tools, system }) {
  const messages = [...history, { role: 'user', content: text }];
  const actions = [];
  const defs = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));

  for (let step = 0; step < 6; step++) {
    const res = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1024, system, tools: defs, messages }),
    });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    messages.push({ role: 'assistant', content: data.content });

    const uses = data.content.filter((b) => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || uses.length === 0) {
      return { reply: data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), actions };
    }
    const results = [];
    for (const u of uses) {
      actions.push(u.name);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: await runTool(tools, u.name, u.input) });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('too many steps');
}

// ---------- Groq: text and existing local tools ----------
async function askGroq(opts) {
  const { completion } = require('./groq');
  const messages=[{role:'system',content:opts.system},...opts.history,{role:'user',content:opts.text}];
  const defs=TOOLS.filter(t=>typeof opts.tools?.[t.name]==='function').map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.schema}}));
  const actions=[];
  for(let i=0;i<6;i++){
    const msg=await completion(opts,messages,defs.length?{tools:defs}:{});
    messages.push(msg);
    if(!msg.tool_calls?.length)return {reply:String(msg.content||'').trim(),actions};
    for(const call of msg.tool_calls){
      let input={};try{input=JSON.parse(call.function.arguments||'{}');}catch{}
      actions.push(call.function.name);
      messages.push({role:'tool',tool_call_id:call.id,content:await runTool(opts.tools,call.function.name,input)});
    }
  }
  throw new Error('Слишком много шагов ответа Groq.');
}

// ---------- Ollama ----------
async function askOllama({ ollamaUrl, ollamaModel, history, text, tools, system }) {
  const base = ollamaUrl.replace(/\/+$/, '');
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: text }];
  const actions = [];
  let defs = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));

  for (let step = 0; step < 6; step++) {
    let res;
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: ollamaModel, messages, tools: defs.length ? defs : undefined, stream: false }),
      });
    } catch {
      const e = new Error('offline');
      e.offline = true;
      throw e;
    }
    if (!res.ok) {
      const err = await readError(res);
      // модель без поддержки инструментов: просто болтаем без них
      if (defs.length && /does not support tools/i.test(err.message)) { defs = []; continue; }
      throw err;
    }
    const msg = (await res.json()).message || {};
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { reply: String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), actions };
    }
    for (const c of calls) {
      const name = c.function?.name;
      let args = c.function?.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      actions.push(name);
      messages.push({ role: 'tool', tool_name: name, content: await runTool(tools, name, args) });
    }
  }
  throw new Error('too many steps');
}

// Список скачанных моделей Ollama (для подсказки в настройках). null = не отвечает.
async function ollamaModels(url) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return ((await res.json()).models || []).map((m) => m.name);
  } catch {
    return null;
  }
}

/**
 * history: только текстовые реплики [{role, content: string}], чтобы её было легко обрезать.
 * Вызовы инструментов живут внутри одного запроса.
 */
async function ask(opts) {
  const system = systemPrompt(opts);
  const fn = opts.provider === 'groq' ? askGroq : opts.provider === 'ollama' ? askOllama : askClaude;
  const { reply, actions } = await fn({ ...opts, system });
  const text = reply || (opts.lang === 'en' ? 'Purr!' : 'Мур!');
  return {
    reply: text,
    actions,
    history: [...opts.history, { role: 'user', content: opts.text }, { role: 'assistant', content: text }],
  };
}

module.exports = { ask, ollamaModels, systemPrompt };
