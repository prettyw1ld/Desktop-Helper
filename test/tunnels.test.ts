// Туннели во внешние сервисы: что считается туннелем, что нет, что пишется в журнал.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePolicy, regToRaw } from '../src/main/policy';
import { findTunnels, maskCmd, parentChain, parseCim, parsePs, parseTasklist, parseTunnels, suspicious, tunnelOf, type Proc } from '../src/main/system/tunnels';

const t = (name: string, cmd = '') => tunnelOf({ name, cmd });

test('tunnel programs are found by name or by their command line', () => {
  assert.equal(t('cloudflared.exe', 'cloudflared tunnel --url http://localhost:3000'), 'Cloudflare Tunnel');
  assert.equal(t('ngrok.exe', 'ngrok http 3000'), 'ngrok');
  assert.equal(t('frpc.exe'), 'frp');
  assert.equal(t('devtunnel.exe', 'devtunnel host -p 3000'), 'Microsoft Dev Tunnels');
  assert.equal(t('ssh.exe', '"C:\\Windows\\System32\\OpenSSH\\ssh.exe" -R 80:localhost:3000 serveo.net'), 'SSH-туннель во внешний сервис');
  assert.equal(t('ssh.exe', 'ssh -p 443 -R0:localhost:3000 a.pinggy.io'), 'SSH-туннель во внешний сервис');
  assert.equal(t('ssh', 'ssh -fNR 9000:localhost:22 me@vps.example'), 'SSH-туннель');
  assert.equal(t('ssh.exe', 'ssh -D 1080 me@proxy.example'), 'SSH-туннель');
  assert.equal(t('node.exe', '"C:\\Program Files\\nodejs\\node.exe" C:\\npm\\npx-cli.js localtunnel --port 3000'), 'localtunnel');
  assert.equal(t('node.exe', 'node C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\localtunnel\\bin\\lt.js --port 8080'), 'localtunnel');
  assert.equal(t('node.exe', 'node npx-cli.js untun@latest tunnel http://localhost:3000'), 'Cloudflare Tunnel');
  assert.equal(t('code.exe', 'code tunnel --accept-server-license-terms'), 'VS Code Tunnel');
  assert.equal(t('tailscale.exe', 'tailscale funnel 3000'), 'Tailscale Funnel');
  assert.equal(t('python.exe', 'python pagekite.py 80 me.pagekite.me'), 'PageKite');
});

test('ordinary work is not a tunnel', () => {
  assert.equal(t('ssh.exe', 'ssh -o SendEnv=GIT_PROTOCOL git@github.com "git-upload-pack \'me/repo.git\'"'), '');
  assert.equal(t('ssh.exe', 'ssh -L 5432:db.corp:5432 me@bastion.corp'), '');
  assert.equal(t('node.exe', 'node index.mjs'), '');
  assert.equal(t('node.exe', 'node C:\\app\\node_modules\\vite\\bin\\vite.js --port 5173'), '');
  assert.equal(t('Code.exe', '"C:\\Code\\Code.exe" --type=renderer --tunnel'), '');
  assert.equal(t('tailscale.exe', 'tailscale status'), '');
  assert.equal(t('chrome.exe', 'chrome --tunnel'), '');
  assert.ok(suspicious('Code.exe') && suspicious('ssh.exe') && suspicious('cloudflared.exe'));
  assert.ok(!suspicious('chrome.exe') && !suspicious('explorer.exe') && !suspicious('Пушик.exe'));
});

test('tokens and keys never reach the log', () => {
  assert.equal(maskCmd('cloudflared tunnel run --token eyJhIjoiYWJjIiwidCI6IjEyMyJ9'), 'cloudflared tunnel run --token [скрыто]');
  assert.equal(maskCmd('ngrok config add-authtoken 2abcDEFghiJKLmnoPQRstuVWXyz_123456'), 'ngrok config add-authtoken [скрыто]');
  assert.equal(maskCmd('ngrok http 80 --authtoken=abc123secret'), 'ngrok http 80 --authtoken=[скрыто]');
  assert.equal(maskCmd('ssh -R 80:localhost:3000 serveo.net'), 'ssh -R 80:localhost:3000 serveo.net');
  assert.ok(maskCmd('x '.repeat(400)).length <= 300);
  // путь с GUID — не секрет, длинный ключ в пути — секрет
  assert.equal(maskCmd('C:\\Temp\\b226f07b-79ad-4bd0-b602-203e0af6596b\\cloudflared.exe tunnel'), 'C:\\Temp\\b226f07b-79ad-4bd0-b602-203e0af6596b\\cloudflared.exe tunnel');
  assert.equal(maskCmd('cloudflared tunnel run eyJhIjoiYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoifQ'), 'cloudflared tunnel run [скрыто]');
});

const procs: Proc[] = [
  { pid: 10, ppid: 1, name: 'opencode.exe', cmd: 'opencode' },
  { pid: 11, ppid: 10, name: 'bash.exe', cmd: 'bash -c "cloudflared tunnel --url http://localhost:3000"' },
  { pid: 12, ppid: 11, name: 'cloudflared.exe', cmd: 'cloudflared tunnel --url http://localhost:3000' },
  { pid: 13, ppid: 10, name: 'ngrok.exe', cmd: 'ngrok http 8080 --domain=tunnel.corp.example' },
  { pid: 14, ppid: 1, name: 'node.exe', cmd: 'node server.js' },
];

test('a found tunnel names the program that started it and respects the allow list', () => {
  assert.deepEqual(parentChain(procs, 12), ['bash', 'opencode']);
  const rules = parseTunnels({ action: 'stop', allow: ['tunnel\\.corp\\.example', '(bad'] });
  assert.equal(rules.action, 'stop');
  assert.equal(rules.allow.length, 1);
  const found = findTunnels(procs, new Set([12, 13, 14]), rules, 999);
  assert.deepEqual(found.map((f) => [f.pid, f.app, f.chain]), [[12, 'Cloudflare Tunnel', ['bash', 'opencode']]]);
  // старые процессы (не новые) повторно не сообщаем, свой процесс — никогда
  assert.equal(findTunnels(procs, new Set([11]), rules, 999).length, 0);
  assert.equal(findTunnels(procs, new Set([12]), rules, 12).length, 0);
});

test('policy: tunnels default to a warning, can stop or be switched off', () => {
  assert.deepEqual(parseTunnels(undefined), { action: 'warn', allow: [] });
  assert.equal(parseTunnels({ action: 'off' }).action, 'off');
  assert.equal(parseTunnels({ action: 'explode' }).action, 'warn');
  assert.equal(parsePolicy({ org: 'A' }).tunnels!.action, 'warn');
  assert.equal(parsePolicy({ org: 'A', tunnels: { action: 'stop' } }).tunnels!.action, 'stop');
  assert.deepEqual(regToRaw({ Tunnels: 'stop', TunnelsAllow: 'corp\\.example\\0vpn' })!.tunnels, { action: 'stop', allow: ['corp\\.example', 'vpn'] });
});

test('process lists from tasklist, PowerShell and ps', () => {
  assert.deepEqual(parseTasklist('"cloudflared.exe","4242","Console","1","20 000 K"\r\n"ssh.exe","7","Console","1","5 K"'), [{ name: 'cloudflared.exe', pid: 4242 }, { name: 'ssh.exe', pid: 7 }]);
  assert.deepEqual(parseCim('{"ProcessId":5,"ParentProcessId":1,"Name":"ngrok.exe","CommandLine":"ngrok http 3000"}'), [{ pid: 5, ppid: 1, name: 'ngrok.exe', cmd: 'ngrok http 3000' }]);
  assert.deepEqual(parseCim('[{"ProcessId":4,"ParentProcessId":0,"Name":"System","CommandLine":null}]'), [{ pid: 4, ppid: 0, name: 'System', cmd: '' }]);
  assert.deepEqual(parseCim('not json'), []);
  assert.deepEqual(parsePs('  501   1 /usr/local/bin/cloudflared tunnel --url http://localhost:3000\n'), [{ pid: 501, ppid: 1, name: '/usr/local/bin/cloudflared', cmd: '/usr/local/bin/cloudflared tunnel --url http://localhost:3000' }]);
  assert.equal(tunnelOf(parsePs('  9 1 /usr/bin/ssh -R 80:localhost:8080 nokey@localhost.run')[0]!), 'SSH-туннель во внешний сервис');
});
