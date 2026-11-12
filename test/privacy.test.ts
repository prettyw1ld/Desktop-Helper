// Что ИИ видеть нельзя: пароли, менеджеры паролей, окна из запрета организации, всё кроме окна перед человеком.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockReason, maskOutside, parsePrivacy } from '../src/main/ai/privacy';
import { parsePolicy, parseReg, regToRaw } from '../src/main/policy';

test('privacy: no look at the screen while a password is typed or a password manager is in front', () => {
  assert.equal(blockReason({ password: true, proc: 'chrome' }), 'password');
  for (const proc of ['KeePass', 'KeePassXC.exe', '1Password', 'Bitwarden', 'consent', 'CredentialUIBroker']) {
    assert.equal(blockReason({ proc }), 'app', proc);
  }
  assert.equal(blockReason({ proc: 'iBank2' }, ['iBank2.exe']), 'app', 'organisation deny list');
  assert.equal(blockReason({ proc: 'Code' }, ['iBank2']), '');
  assert.equal(blockReason({}), '', 'unknown window: allowed (non-Windows)');
});

test('privacy: policy section is read strictly', () => {
  assert.deepEqual(parsePrivacy(undefined), { screenshots: 'screen', denyApps: [] });
  assert.equal(parsePrivacy({ screenshots: 'window' }).screenshots, 'window');
  assert.equal(parsePrivacy({ screenshots: 'off' }).screenshots, 'off');
  assert.equal(parsePrivacy({ screenshots: 'nonsense' }).screenshots, 'off', 'unknown value: the strictest');
  assert.deepEqual(parsePrivacy({ denyApps: ['1cv8', '', 5, ' iBank2 '] }).denyApps, ['1cv8', 'iBank2']);
  const p = parsePolicy({ ai: { url: 'https://llm.corp.local/v1', model: 'm' }, privacy: { screenshots: 'off', denyApps: ['1cv8'] } });
  assert.deepEqual(p.privacy, { screenshots: 'off', denyApps: ['1cv8'] });
  // испорченный раздел ИИ не отменяет запреты на снимки
  assert.equal(parsePolicy({ ai: 'x', privacy: { screenshots: 'window' } }).privacy.screenshots, 'window');
  const reg = parsePolicy(regToRaw(parseReg('    Screenshots    REG_SZ    window\r\n    DenyApps    REG_SZ    1cv8; iBank2')));
  assert.deepEqual(reg.privacy, { screenshots: 'window', denyApps: ['1cv8', 'iBank2'] });
});

test('privacy: everything outside the kept window is painted black', () => {
  const w = 4;
  const h = 3;
  const img = Buffer.alloc(w * h * 4, 200);
  const out = maskOutside(img, w, h, [{ x: 1, y: 1, w: 2, h: 1 }]);
  const px = (x: number, y: number) => [...out.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
  assert.deepEqual(px(0, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(1, 1), [200, 200, 200, 255], 'inside the window: untouched');
  assert.deepEqual(px(2, 1), [200, 200, 200, 255]);
  assert.deepEqual(px(3, 1), [0, 0, 0, 255]);
  assert.deepEqual(px(1, 2), [0, 0, 0, 255]);
  assert.equal(maskOutside(img, w, h, []).every((v, i) => (i % 4 === 3 ? v === 255 : v === 0)), true, 'nothing known: all black');
});
