// Имя кота: человек может назвать его по-своему, и новое имя видно везде, в нужном падеже.
import './setup';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catNameFor, cleanCatName, declineRu, sound } from '../src/shared/cat-name';
import { I18N, T } from '../src/shared/i18n';
import { fstWords, untar } from '../src/main/ai/vosk-words';

test('the name is cleaned: letters, spaces and hyphens only, at most 20 characters', () => {
  assert.equal(cleanCatName('  Барсик  '), 'Барсик');
  assert.equal(cleanCatName('<b>Мурзик</b>!'), 'bМурзикb');
  assert.equal(cleanCatName('Кот\nБорис'), 'Кот Борис');
  assert.equal(cleanCatName('Кот   Борис'), 'Кот Борис');
  assert.equal(cleanCatName('А'.repeat(40)).length, 20);
  assert.equal(cleanCatName(42), '');
  assert.equal(catNameFor('', 'ru'), 'Пушик');
  assert.equal(catNameFor('', 'en'), 'Pushik');
  assert.equal(catNameFor('  ', 'ru'), 'Пушик');
});

test('Russian cases for typical pet names', () => {
  const cases = (n: string) => (['gen', 'dat', 'ins'] as const).map((c) => declineRu(n, c)).join(' ');
  assert.equal(cases('Пушик'), 'Пушика Пушику Пушиком');
  assert.equal(cases('Пуш'), 'Пуша Пушу Пушем');
  assert.equal(cases('Снежок'), 'Снежка Снежку Снежком');
  assert.equal(cases('Уголёк'), 'Уголька Угольку Угольком');
  assert.equal(cases('Василий'), 'Василия Василию Василием');
  assert.equal(cases('Мурка'), 'Мурки Мурке Муркой');
  assert.equal(cases('Кузя'), 'Кузи Кузе Кузей');
  assert.equal(cases('Масяня'), 'Масяни Масяне Масяней');
  assert.equal(cases('Персико'), 'Персико Персико Персико');
  assert.equal(cases('Tom'), 'Tom Tom Tom');
  assert.equal(cases('Кот Борис'), 'Кота Бориса Коту Борису Котом Борисом');
});

test('texts show the new name everywhere, including the tray', () => {
  I18N.setLang('ru');
  I18N.setCatName('');
  assert.equal(T('tray.title'), 'Пушик');
  assert.equal(T('tray.call'), 'Позвать Пушика');
  I18N.setCatName('Барсик');
  assert.equal(T('tray.title'), 'Барсик');
  assert.equal(T('tray.call'), 'Позвать Барсика');
  assert.equal(T('tray.chat'), 'Чат с Барсиком');
  assert.equal(T('menu.chat'), 'Спросить Барсика');
  assert.equal(T('chat.ph'), 'Напиши Барсику…');
  assert.equal(T('notif.reminder'), 'Барсик напоминает');
  assert.match(T('chat.hello'), /^Мяу! Я Барсик\./);
  assert.match(T('greet.day', { name: '' }), /Я Барсик/);
  I18N.setLang('en');
  assert.equal(T('tray.chat'), 'Chat with Барсик');
  I18N.setCatName('');
  assert.equal(T('tray.chat'), 'Chat with Pushik');
  I18N.setLang('ru');
});

test('vocabulary is read from the model archive (tar with the OpenFst word table)', () => {
  // таблица слов: magic, имя, свободный номер, число слов, записи «длина, слово, номер»
  const parts: Buffer[] = [];
  const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
  const i64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
  const str = (s: string) => { const b = Buffer.from(s); return Buffer.concat([i32(b.length), b]); };
  parts.push(Buffer.from('header junk'), i32(2125658996), str('words.txt'), i64(4), i64(3));
  ['<eps>', 'барсик', 'пушок'].forEach((w, i) => parts.push(str(w), i64(i)));
  const fst = Buffer.concat(parts);
  assert.deepEqual(fstWords(fst), ['<eps>', 'барсик', 'пушок']);

  const entry = (name: string, data: Buffer) => {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write(data.length.toString(8).padStart(11, '0'), 124);
    return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
  };
  const tar = Buffer.concat([entry('m/graph/._Gr.fst', Buffer.from('mac junk')), entry('m/am/final.mdl', Buffer.from('x')),
    entry('m/graph/Gr.fst', fst), Buffer.alloc(1024)]);
  const files = untar(tar, (n) => n.endsWith('Gr.fst'));
  assert.deepEqual([...files.keys()], ['m/graph/Gr.fst']);
  assert.deepEqual(fstWords(files.get('m/graph/Gr.fst')!), ['<eps>', 'барсик', 'пушок']);
  assert.equal(sound('пущу'), 'пушу');
});
