// Без сертификата Apple electron-builder оставляет Mac-приложение неподписанным,
// и на Mac с чипом M такое приложение macOS называет «повреждённым».
// Подписываем его «на месте» (ad-hoc): тогда достаточно один раз разрешить запуск в настройках.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
