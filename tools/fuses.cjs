// После сборки выключаем в самом Electron то, чем злоумышленник мог бы запустить свой код от имени Пушика:
// режим «обычный Node» (ELECTRON_RUN_AS_NODE), NODE_OPTIONS, отладчик из командной строки и загрузку кода не из app.asar.
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(ctx) {
  const name = ctx.packager.appInfo.productFilename;
  const mac = ctx.electronPlatformName === 'darwin';
  const exe = mac
    ? path.join(ctx.appOutDir, `${name}.app`)
    : path.join(ctx.appOutDir, ctx.electronPlatformName === 'win32' ? `${name}.exe` : ctx.packager.executableName);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: mac,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    // проверка целостности app.asar: хеш вшивает electron-builder (на Windows — ресурс Integrity/ElectronAsar в exe)
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: mac || ctx.electronPlatformName === 'win32',
  });
};
