// Ролевые пакеты организации: проверка при загрузке, уроки, подсказка ИИ и пояснения к окнам.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { explainFor, packPrompt, packsDir, parsePack, parsePacks, safeRegex } from '../src/main/packs';
import { packScenario } from '../src/renderer/guide/scenarios';

const sample = fs.readFileSync(path.join(__dirname, '../../docs/enterprise/packs/security.json'), 'utf8');

test('the sample security pack loads cleanly', () => {
  const { packs, problems } = parsePacks([{ name: 'security.json', text: sample }]);
  assert.deepEqual(problems, []);
  const p = packs[0]!;
  assert.equal(p.id, 'security');
  assert.ok(p.lessons.length >= 4);
  assert.ok(p.lessons.every((l) => l.id.startsWith('pack:security:')));
  const vpn = p.lessons.find((l) => l.id === 'pack:security:vpn')!;
  assert.deepEqual(vpn.steps[1]!.find, { scope: 'top', name: '^(Подключить|Connect)$', types: ['Button'] });
  assert.deepEqual(vpn.steps[1]!.wait, { gone: true });
  assert.deepEqual(vpn.steps[0]!.wait, { manual: true });
});

test('pack lessons become scenarios that match the words of the task', () => {
  const p = parsePack(JSON.parse(sample));
  const sc = packScenario(p.lessons.find((l) => l.id === 'pack:security:phishing')!);
  assert.ok(sc.match.test('проверь это письмо'));
  assert.ok(!sc.match.test('сделай погромче'));
  assert.equal(sc.pack, 'Безопасность для сотрудника');
  assert.equal(sc.win, sc.mac);
  assert.ok(sc.goal);
  // урок без слов для поиска запускается только из списка
  const quiet = packScenario({ ...p.lessons[0]!, match: '' });
  assert.ok(!quiet.match.test('проверь письмо'));
});

test('app turns into a search in that program window', () => {
  const p = parsePack({ id: 'mail', title: 'Почта', lessons: [{ id: 'report', title: 'Сообщи о фишинге', steps: [
    { say: 'Нажми «Сообщить»', app: 'outlook', find: { name: 'Сообщить', types: ['Button', 'Bogus'] } },
  ] }] });
  assert.deepEqual(p.lessons[0]!.steps[0]!.find, { scope: 'proc:^outlook$', name: 'Сообщить', types: ['Button'] });
  assert.deepEqual(p.lessons[0]!.steps[0]!.wait, { next: true });
});

test('a broken pack is skipped whole, the rest keep working', () => {
  const good = JSON.stringify({ id: 'a', title: 'A', lessons: [{ id: 'x', title: 'X', goal: 'Open mail' }] });
  const bad = [
    { name: 'json.json', text: '{ nope' },
    { name: 'id.json', text: JSON.stringify({ id: 'Bad Id', title: 'B' }) },
    { name: 'empty.json', text: JSON.stringify({ id: 'b', title: 'B', lessons: [{ id: 'x', title: 'X' }] }) },
    { name: 'open.json', text: JSON.stringify({ id: 'c', title: 'C', lessons: [{ id: 'x', title: 'X', steps: [{ say: 'go', open: 'file:///C:/evil.exe' }] }] }) },
    { name: 'regex.json', text: JSON.stringify({ id: 'd', title: 'D', lessons: [{ id: 'x', title: 'X', goal: 'g', match: '(a+)+$' }] }) },
    { name: 'wait.json', text: JSON.stringify({ id: 'e', title: 'E', lessons: [{ id: 'x', title: 'X', steps: [{ say: 'go', wait: 'gone' }] }] }) },
    { name: 'app.json', text: JSON.stringify({ id: 'f', title: 'F', lessons: [{ id: 'x', title: 'X', steps: [{ say: 'go', app: 'a b', find: { name: 'x' } }] }] }) },
    { name: 'z-dup.json', text: good },
  ];
  const { packs, problems } = parsePacks([{ name: 'a.json', text: good }, ...bad]);
  assert.deepEqual(packs.map((p) => p.id), ['a']);
  assert.equal(problems.length, bad.length);
  assert.match(problems.join('\n'), /not valid JSON/);
  assert.match(problems.join('\n'), /regex too complex/);
  assert.match(problems.join('\n'), /only ms-settings/);
  assert.match(problems.join('\n'), /needs find/);
  assert.match(problems.join('\n'), /repeats/);
});

test('limits keep a pack small', () => {
  assert.throws(() => parsePack({ id: 'a', title: 'A', prompt: 'x'.repeat(2001) }), /prompt longer/);
  assert.throws(() => safeRegex('a'.repeat(201), 'r'), /longer/);
  assert.throws(() => safeRegex('(x)\\1', 'r'), /complex/);
  assert.throws(() => safeRegex('[', 'r'), /bad regex/);
  assert.equal(safeRegex('', 'r'), null);
  const long = parsePack({ id: 'a', title: 'A', lessons: [{ id: 'x', title: 'X', steps: [{ say: 'я'.repeat(500) }] }] });
  assert.equal(long.lessons[0]!.steps[0]!.say.length, 160);
});

test('the AI prompt carries each pack rule under its name', () => {
  const p = parsePack(JSON.parse(sample));
  const text = packPrompt([p, parsePack({ id: 'q', title: 'Тихий' })]);
  assert.match(text, /^Instructions from the organisation/);
  assert.match(text, /\[Безопасность для сотрудника\]\nYou help employees/);
  assert.doesNotMatch(text, /Тихий/);
  assert.equal(packPrompt([]), '');
});

test('explain notes match the window by program or title', () => {
  const packs = [parsePack(JSON.parse(sample))];
  assert.match(explainFor(packs, 'SecHealthUI', 'Безопасность Windows'), /Защитник Windows/);
  assert.match(explainFor(packs, 'avpui', ''), /Касперского/);
  assert.match(explainFor(packs, 'outlook', 'Отправка заблокирована DLP'), /утечек/);
  assert.equal(explainFor(packs, 'notepad', 'Без имени'), '');
});

test('packs live next to the policy file', () => {
  assert.equal(packsDir(path.join('C:', 'ProgramData', 'Pushik', 'policy.json')), path.join('C:', 'ProgramData', 'Pushik', 'packs'));
});
