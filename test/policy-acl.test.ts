// Кто может менять политику: файл, который мог положить обычный пользователь, не принимается.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { aclProblem, parseAclOutput, unixProblem, type AclEntry } from '../src/main/policy-acl';
import { readPacks } from '../src/main/packs';

const ADM = 'S-1-5-32-544';
const SYS = 'S-1-5-18';
const USERS = 'S-1-5-32-545';
const ME = 'S-1-5-21-1-2-3-1001';
const READ = 0x1200a9;          // ReadAndExecute, Synchronize
const FULL = 0x1f01ff;          // FullControl
const ADD = 0x2 | 0x4 | 0x10 | 0x100; // WD, AD, WEA, WA — как у Users на %ProgramData%

const e = (owner: string, aces: [string, number, boolean?, boolean?][]): AclEntry =>
  ({ path: 'p', owner, aces: aces.map(([sid, rights, allow = true, inheritOnly = false]) => ({ sid, rights, allow, inheritOnly })) });

test('file put by the installer or an elevated admin is trusted', () => {
  assert.equal(aclProblem(e(ADM, [[SYS, FULL], [ADM, FULL], [USERS, READ]])), '');
  assert.equal(aclProblem(e(SYS, [[SYS, FULL], [USERS, READ]])), '');
});

test('file created by a standard user process is not trusted', () => {
  assert.match(aclProblem(e(ME, [[ME, FULL], [USERS, READ]])), /owner .* is not SYSTEM or Administrators/);
  // администратор поменял владельца, но оставил пользователю запись
  assert.match(aclProblem(e(ADM, [[ADM, FULL], [ME, FULL]])), /S-1-5-21-1-2-3-1001 can write/);
  assert.match(aclProblem(e(ADM, [[ADM, FULL], ['S-1-5-11', 0x1301bf]])), /S-1-5-11 can write/); // Authenticated Users: Modify
  assert.match(aclProblem(e(ADM, [[ADM, FULL], ['S-1-1-0', 0x40000000]])), /S-1-1-0 can write/);   // Everyone: GENERIC_WRITE
});

test('folder: creating new files is allowed (their owner is checked), deleting or re-permissioning is not', () => {
  const dir = e(ADM, [[SYS, FULL], [ADM, FULL], [USERS, READ], [USERS, ADD], ['S-1-3-0', 0x10000000, true, true]]);
  assert.equal(aclProblem(dir, true), '');          // папка как в %ProgramData% по умолчанию
  assert.match(aclProblem(dir, false), /can write/); // а у файла такие права — уже нельзя
  assert.match(aclProblem(e(ADM, [[ADM, FULL], [USERS, 0x40]]), true), /can write/);    // DeleteChild
  assert.match(aclProblem(e(ADM, [[ADM, FULL], [USERS, 0x40000]]), true), /can write/); // WRITE_DAC
});

test('deny entries and missing owner', () => {
  assert.equal(aclProblem(e(ADM, [[ADM, FULL], [ME, FULL, false]])), '');
  assert.match(aclProblem(e('', [])), /owner unknown/);
});

test('PowerShell output is parsed into entries', () => {
  const out = [
    'P|C:\\ProgramData\\Pushik|S-1-5-32-544',
    'A|S-1-5-18|2032127|Allow|False',
    'A|S-1-3-0|268435456|Allow|True',
    'A|S-1-5-32-545|278|Allow|False',
    'P|C:\\ProgramData\\Pushik\\policy.json|S-1-5-21-1-2-3-1001',
    'A|S-1-5-21-1-2-3-1001|2032127|Allow|False',
    'P|C:\\ProgramData\\Pushik\\packs|',
  ].join('\r\n');
  const list = parseAclOutput(out);
  assert.equal(list.length, 3);
  assert.equal(list[0]!.aces.length, 3);
  assert.equal(list[0]!.aces[1]!.inheritOnly, true);
  assert.equal(aclProblem(list[0]!, true), '');
  assert.match(aclProblem(list[1]!), /not SYSTEM or Administrators/);
  assert.match(aclProblem(list[2]!, true), /owner unknown/);
});

test('unix: root-owned and not group/world writable', () => {
  assert.equal(unixProblem('/etc/pushik/policy.json', { uid: 0, mode: 0o100644 }), '');
  assert.match(unixProblem('/etc/pushik/policy.json', { uid: 501, mode: 0o100644 }), /not root/);
  assert.match(unixProblem('/etc/pushik', { uid: 0, mode: 0o40777 }), /writable/);
});

test('packs that are not trusted are skipped with a reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'));
  const pack = (id: string) => JSON.stringify({ id, title: id, lessons: [] });
  fs.writeFileSync(path.join(dir, 'good.json'), pack('good'));
  fs.writeFileSync(path.join(dir, 'evil.json'), pack('evil'));
  const set = readPacks(dir, new Map([[path.join(dir, 'evil.json'), 'owner is a user']]));
  assert.deepEqual(set.packs.map((p) => p.id), ['good']);
  assert.match(set.problems.join(), /evil\.json: not trusted/);
  assert.equal(readPacks(dir, new Map([[dir, 'Users can delete']])).packs.length, 0);
});
