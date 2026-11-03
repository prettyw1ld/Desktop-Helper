// На macOS собираем маленький нативный помощник «доступности» (src/native/locator.swift).
// На Windows он не нужен, и компилятор Swift там не требуется.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.platform === 'darwin') {
  const root = path.join(import.meta.dirname, '..');
  const source = path.join(root, 'src/native/locator.swift');
  const target = path.join(root, 'assets/mac', `locator-${process.arch}`);
  if (!fs.existsSync(target) || fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const cache = path.join(os.tmpdir(), 'pushik-swift-cache');
    execFileSync('/usr/bin/xcrun', ['swiftc', source, '-O', '-module-cache-path', cache, '-o', target], { stdio: 'inherit' });
  }
}
