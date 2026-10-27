// Запуск вместе с компьютером.
// В собранном приложении система запускает сам Пушик.exe. При `npm start` exe — это electron.exe,
// и ему нужно передать путь к проекту, иначе после входа в систему откроется пустое окно Electron.
const { app } = require('electron');

function loginItem() {
  if (app.isPackaged) return {};
  return { path: process.execPath, args: [app.getAppPath()], name: 'Pushik (dev)' };
}

// На macOS при `npm start` система запустила бы голый Electron.app, поэтому там автозапуск
// работает только в собранном приложении. На Linux Electron автозапуск не поддерживает.
function supported() {
  if (process.platform === 'linux') return false;
  if (process.platform === 'darwin' && !app.isPackaged) return false;
  return true;
}

function apply(enabled) {
  if (!supported()) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, ...loginItem() });
  } catch (err) {
    console.error('autostart', err.message);
  }
}

module.exports = { apply, supported };
