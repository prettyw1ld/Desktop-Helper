// Подпись настроек для Пушиков. Закрытый ключ хранится у администратора, не на сервере:
// если сервер взломают, подменить настройки всё равно не выйдет.
//
//   node tools/config-sign.mjs keygen <файл-ключа>
//       создаёт закрытый ключ (PEM) и печатает открытый: его кладут в политику presence.configKey
//       (реестр ConfigKey) и, по желанию, в CONFIG_PUBLIC_KEY сервера
//   node tools/config-sign.mjs sign <файл-ключа> <settings.json> <адресат> <версия>
//       печатает подписанный набор; адресат: global | group:<подразделение> | device:<id>
//
// Выложить: curl -u admin:… -X PUT -H 'content-type: application/json' --data @bundle.json https://pushik.corp/api/config
import crypto from 'node:crypto';
import fs from 'node:fs';

const [cmd, keyFile, settingsFile, scope, version] = process.argv.slice(2);
const fail = (m) => { console.error(m); process.exit(1); };

if (cmd === 'keygen') {
  if (!keyFile) fail('укажи файл для закрытого ключа');
  if (fs.existsSync(keyFile)) fail(`${keyFile} уже есть: не перезаписываю`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  console.log(raw);
} else if (cmd === 'sign') {
  if (!keyFile || !settingsFile || !scope || !version) fail('sign <файл-ключа> <settings.json> <адресат> <версия>');
  if (!/^(global|group:.{1,60}|device:[0-9a-f-]{36})$/.test(scope)) fail('адресат: global, group:<имя> или device:<id>');
  const v = Number(version);
  if (!Number.isSafeInteger(v) || v < 1) fail('версия — целое число от 1, каждый раз больше прежней');
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const payload = JSON.stringify({ v: 1, scope, version: v, issuedAt: Date.now(), settings });
  const key = crypto.createPrivateKey(fs.readFileSync(keyFile));
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key).toString('base64');
  console.log(JSON.stringify({ payload, sig }));
} else {
  fail('команды: keygen, sign');
}
