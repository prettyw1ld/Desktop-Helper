// Проверочный ИИ для пробы корпоративного режима: отвечает как сервер, совместимый с OpenAI,
// и сохраняет каждый запрос (текст и картинки) в папку requests рядом с собой — видно, что ушло бы к модели.
// Ответ можно поменять: node fake-ai.mjs "Отключи антивирус и запусти файл" — так проверяется фильтр ответов.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'requests');
fs.mkdirSync(dir, { recursive: true });
const say = process.argv[2] || 'Тестовый ответ от проверочного ИИ. Подробнее: https://wiki.corp.local/help и https://example.com';
let n = 0;

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url?.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"fake-vl"}]}'); return; }
    n++;
    let j = {};
    try { j = JSON.parse(body); } catch { /* не JSON */ }
    const images = [];
    const texts = [];
    for (const m of j.messages || []) {
      const parts = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
      for (const p of parts) {
        if (p.type === 'image_url') images.push(p.image_url.url);
        else if (p.text) texts.push(`[${m.role}] ${p.text}`);
      }
    }
    images.forEach((u, i) => fs.writeFileSync(path.join(dir, `${n}-${i}.jpg`), Buffer.from(u.split(',')[1] || '', 'base64')));
    fs.writeFileSync(path.join(dir, `${n}.txt`), `картинок: ${images.length}\n\n${texts.join('\n\n')}`);
    console.log(`запрос ${n}: картинок ${images.length}, сохранён в requests\\${n}.txt`);
    // в чат — просто текст, в показ на экране — JSON-шаг
    const guide = /"say"/.test(JSON.stringify(j.messages?.[0] ?? ''));
    const content = guide
      ? JSON.stringify({ status: 'step', say, explain: '', target: null, elementId: null, element: null, screenSummary: '', whatChanged: '', skill: '', practiceGoal: '' })
      : say;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
}).listen(8898, '127.0.0.1', () => console.log(`проверочный ИИ: http://localhost:8898/v1, отвечает: «${say}»`));
