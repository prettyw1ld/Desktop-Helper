// Общее состояние главного процесса: окно кота и значок в трее, плюс маленькие помощники.
const { Notification } = require('electron');
const path = require('path');
const { ASSETS } = require('./paths');

const state = { win: null, tray: null };

const alive = () => state.win && !state.win.isDestroyed();

// Сообщение в окно кота. Если окна ещё (или уже) нет, ничего не делаем.
function send(channel, data) {
  if (alive()) state.win.webContents.send(channel, data);
}

// Показать кота, не забирая фокус у программы, в которой работает человек.
function showInactive() {
  if (alive()) state.win.showInactive();
}

function show() {
  if (alive()) state.win.show();
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: path.join(ASSETS, 'icon.png') }).show();
}

module.exports = { state, alive, send, show, showInactive, notify };
