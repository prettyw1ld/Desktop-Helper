// Настройки. Здесь только то, что понятно новичку; ИИ, ключи и голосовые сервисы задаёт команда в team.json.
import { refreshPlatforms } from '../cat/platforms';
import { happy } from '../cat/poses';
import { setCatColor } from '../cat/render';
import { size } from '../cat/cat';
import { api } from '../core/api';
import { $, dom } from '../core/dom';
import { applyI18n, I18N, T } from '../core/i18n';
import { setSettings, settings } from '../core/settings';
import { Sound } from '../core/sound';
import { bubbleShown, placeBubble, say } from '../ui/bubble';
import { refreshIcons } from '../ui/icons';
import { closePanels, registerPanel, relayoutPanel } from '../ui/panels';

const form = () => $<HTMLFormElement>('#settings-form');
const field = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(name: string): T =>
  form().elements.namedItem(name) as T;

const clampScale = (v: unknown): number => Math.min(1.4, Math.max(0.7, Number(v) || 1));

/** Масштаб окон и подсказок 70–140%. */
function applyWindowScale(value: unknown): void {
  const scale = clampScale(value);
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  $('#ui-scale-value').textContent = `${Math.round(scale * 100)}%`;
  requestAnimationFrame(() => {
    relayoutPanel();
    if (bubbleShown()) placeBubble();
  });
}

const setCatSize = (k: number | string) => dom.cat.style.setProperty('--k', String(k));

/** Применить текущие настройки ко всему окну. */
export function applySettings(): void {
  I18N.setLang(settings.lang);
  applyI18n(document);
  refreshIcons();
  applyWindowScale(settings.uiScale);
  setCatSize(size());
  setCatColor(settings.catColor);
  Sound.set(settings.sound, settings.volume);
  refreshPlatforms();
}

const TEXT_FIELDS = ['userName', 'catColor', 'size', 'uiScale'] as const;
const CHECK_FIELDS = ['speak', 'sound', 'autostart'] as const;

async function fillSettings(): Promise<void> {
  setSettings(await api.getSettings());
  for (const k of TEXT_FIELDS) field(k).value = String(settings[k] ?? '');
  field('uiScale').value = String(settings.uiScale || 1);
  for (const k of CHECK_FIELDS) field(k).checked = !!settings[k];
  applyWindowScale(settings.uiScale);
}

export function initSettings(): void {
  registerPanel('settings', {
    show: () => { void fillSettings(); },
    // закрыли без «Сохранить»: возвращаем, как было (размер кота и масштаб показываются сразу при выборе)
    close: () => { setCatSize(settings.size || 1); applyWindowScale(settings.uiScale); },
  });
  field('size').addEventListener('input', () => setCatSize(field('size').value));
  field('uiScale').addEventListener('input', () => applyWindowScale(field('uiScale').value));
  form().addEventListener('submit', async (e) => {
    e.preventDefault();
    setSettings(await api.saveSettings({
      userName: field('userName').value.trim(),
      catColor: field<HTMLSelectElement>('catColor').value as typeof settings.catColor,
      size: Number(field('size').value) || 1,
      uiScale: clampScale(field('uiScale').value),
      speak: field('speak').checked,
      sound: field('sound').checked,
      autostart: field('autostart').checked,
    }));
    applySettings();
    closePanels();
    happy();
    say(T('set.saved'), 2000);
  });
  $('#quit').addEventListener('click', () => api.quit());
  api.on('settings-changed', (s) => { setSettings(s); applySettings(); });
}
