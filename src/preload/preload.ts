// Мост между окном кота и главным процессом. Окно видит его как window.pushik.
import { contextBridge, ipcRenderer } from 'electron';
import { PUSHIK_EVENTS, type PushikApi } from '../shared/types';

const api: PushikApi = {
  setIgnoreMouse: (ignore) => ipcRenderer.send('ignore-mouse', ignore),
  getCursor: () => ipcRenderer.invoke('cursor:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  chat: (text) => ipcRenderer.invoke('chat:send', text),
  resetChat: () => ipcRenderer.invoke('chat:reset'),
  addReminder: (minutes, text, kind) => ipcRenderer.invoke('reminders:add', { minutes, text, kind }),
  listReminders: () => ipcRenderer.invoke('reminders:list'),
  cancelReminder: (id) => ipcRenderer.invoke('reminders:cancel', id),
  listCalendar: (days) => ipcRenderer.invoke('calendar:list', days),
  quit: () => ipcRenderer.send('app:quit'),
  hide: () => ipcRenderer.send('app:hide'),
  watchClicks: (on, key = 'trash') => ipcRenderer.send('clicks:watch', on, key),
  setFocusable: (on) => ipcRenderer.send('win:focusable', on),
  simplifyExplanation: (text) => ipcRenderer.invoke('guide:simplify', text),
  guideLook: (req) => ipcRenderer.invoke('guide:look', req),
  guideWatch: (masks, focus) => ipcRenderer.send('guide:watch', masks, focus),
  guideUnwatch: () => ipcRenderer.send('guide:unwatch'),
  transcribe: (audio, mime) => ipcRenderer.invoke('stt:transcribe', { audio, mime }),
  askMic: () => ipcRenderer.invoke('mic:ask'),
  addSkill: (name) => ipcRenderer.invoke('skills:add', name),
  locate: (q) => ipcRenderer.invoke('locate', q),
  openUri: (uri) => ipcRenderer.invoke('open:uri', uri),
  filesAction: (req) => ipcRenderer.invoke('files:action', req),
  openDrive: (letter) => ipcRenderer.invoke('open:drive', letter),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  on: (channel, cb) => {
    if (PUSHIK_EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
};

contextBridge.exposeInMainWorld('pushik', api);
