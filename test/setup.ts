// Общая подготовка для тестов окна кота: DOM из index.html, тестовые настройки, без звука.
// Импортировать первым: модули окна кота при загрузке ищут свои элементы в разметке.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import fs from 'node:fs';
import path from 'node:path';

GlobalRegistrator.register({ width: 1280, height: 800, url: 'file:///pushik/build/renderer/index.html' });
const html = fs.readFileSync(path.join(process.cwd(), 'src/renderer/index.html'), 'utf8');
document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '');
