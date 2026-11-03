// Уроки про файлы: только известные папки и обычное системное окно выбора файла.
import type { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FilePlace, FilesRequest, FilesResult } from '../../shared/types';

/** То, что нужно от Electron. Отдельно, чтобы тесты могли подставить заглушки. */
export interface FileDeps {
  app: Pick<Electron.App, 'getPath'>;
  shell: Pick<Electron.Shell, 'openPath' | 'openExternal'>;
  dialog: Pick<Electron.Dialog, 'showOpenDialog'>;
  systemPreferences?: Pick<Electron.SystemPreferences, 'isTrustedAccessibilityClient'>;
  platform?: NodeJS.Platform;
}

const PRACTICE_FILES: [string, string][] = [
  ['Привет от Пушика.txt', 'Привет! Это учебный файл Пушика.\nТы научился открывать документы. Мур!\n'],
  ['Мои открытки/Открытка.txt', 'Хорошего дня!\nТвои настоящие файлы лежат в других папках.\n'],
];

export function createFileActions(deps: FileDeps): (req?: Partial<FilesRequest>, owner?: BrowserWindow | null) => Promise<FilesResult> {
  const { app, shell, dialog, systemPreferences } = deps;
  const platform = deps.platform ?? process.platform;

  // Учебная папка. Файлы, которые человек мог поменять, не перезаписываем.
  async function preparePractice(): Promise<string> {
    const folder = path.join(app.getPath('userData'), 'Пушик — учимся работать с файлами');
    await fs.mkdir(path.join(folder, 'Мои открытки'), { recursive: true });
    for (const [name, text] of PRACTICE_FILES) {
      try { await fs.writeFile(path.join(folder, name), text, { flag: 'wx' }); } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
    return folder;
  }

  const folders: Record<FilePlace, () => string | Promise<string>> = {
    downloads: () => app.getPath('downloads'),
    documents: () => app.getPath('documents'),
    practice: preparePractice,
  };

  return async function action(req = {}, owner = null) {
    try {
      if (req.op === 'access') {
        return { trusted: platform !== 'darwin' || !!systemPreferences?.isTrustedAccessibilityClient(false) };
      }
      if (req.op === 'permissions' && platform === 'darwin') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        return { ok: true };
      }
      if (req.op === 'open') {
        if (!req.place || !Object.hasOwn(folders, req.place)) return { error: 'unknown folder' };
        const error = await shell.openPath(await folders[req.place]());
        return error ? { error } : { ok: true };
      }
      if (req.op === 'choose') {
        const opts: Electron.OpenDialogOptions = { title: 'Выбери файл, который хочешь открыть', properties: ['openFile'] };
        const result = owner ? await dialog.showOpenDialog(owner, opts) : await dialog.showOpenDialog(opts);
        const file = result.filePaths[0];
        if (result.canceled || !file) return { canceled: true };
        const error = await shell.openPath(file);
        return error ? { error } : { ok: true };
      }
      return { error: 'unsupported' };
    } catch (err) {
      return { error: (err as Error).message };
    }
  };
}
