// Открытка за первый успех: рисуем на холсте и сохраняем в PNG.
import type { Skill } from '../../shared/types';
import { api } from '../core/api';
import { el } from '../core/dom';
import { header } from './skill-home';

let postcard: HTMLElement | null = null;

export function closePostcard(): void {
  postcard?.remove();
  postcard = null;
}
export const postcardOpen = (): boolean => !!postcard;

// Текст по словам в несколько строк. Возвращает y под последней строкой.
function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > maxWidth && line) {
      c.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = next;
    }
  }
  c.fillText(line, x, y);
  return y + lineHeight;
}

// Маленький векторный котёнок: без внешних картинок, чтобы PNG можно было сохранить.
function drawKitten(c: CanvasRenderingContext2D): void {
  c.save();
  c.translate(790, 465);
  c.lineWidth = 5;
  c.strokeStyle = '#637784';
  c.fillStyle = '#fffefa';
  c.beginPath(); c.moveTo(35, 60); c.bezierCurveTo(100, 60, 100, -10, 76, -5); c.stroke();
  c.beginPath(); c.ellipse(0, 38, 43, 58, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  c.beginPath();
  c.moveTo(-49, -17); c.lineTo(-45, -65); c.lineTo(-18, -43); c.quadraticCurveTo(0, -51, 21, -43);
  c.lineTo(47, -65); c.lineTo(49, -15); c.quadraticCurveTo(48, 30, 0, 31); c.quadraticCurveTo(-48, 30, -49, -17);
  c.fill(); c.stroke();
  c.fillStyle = '#ffd6dd';
  c.beginPath(); c.moveTo(-39, -51); c.lineTo(-37, -29); c.lineTo(-23, -39); c.fill();
  c.beginPath(); c.moveTo(39, -51); c.lineTo(37, -29); c.lineTo(23, -39); c.fill();
  c.fillStyle = '#344b59';
  for (const x of [-19, 19]) { c.beginPath(); c.ellipse(x, -11, 4, 6, 0, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#d58e9f';
  c.beginPath(); c.moveTo(-5, 0); c.lineTo(5, 0); c.lineTo(0, 6); c.fill();
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, 6); c.quadraticCurveTo(-7, 16, -12, 8); c.moveTo(0, 6); c.quadraticCurveTo(7, 16, 12, 8); c.stroke();
  c.strokeStyle = '#d5eaf8';
  c.lineWidth = 9;
  c.beginPath(); c.moveTo(-26, 34); c.lineTo(26, 34); c.stroke();
  c.fillStyle = '#f2cc55';
  c.beginPath(); c.arc(0, 39, 7, 0, Math.PI * 2); c.fill();
  c.restore();
}

export function drawCard(card: Skill): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 760;
  canvas.setAttribute('aria-label', 'Открытка: первый успех с Пушиком');
  const c = canvas.getContext('2d');
  if (!c) return canvas;
  c.fillStyle = '#fffcf3'; c.fillRect(0, 0, 1000, 760);
  c.fillStyle = '#d5eaf8'; c.beginPath(); c.roundRect(30, 30, 940, 700, 35); c.fill();
  c.fillStyle = '#fffcf3'; c.beginPath(); c.roundRect(55, 55, 890, 650, 28); c.fill();
  c.fillStyle = '#718493'; c.font = '24px Segoe UI'; c.fillText('ПУШИК · МАЛЕНЬКИЕ ШАГИ, БОЛЬШИЕ ОТКРЫТИЯ', 95, 115);
  c.fillStyle = '#24251f'; c.font = 'bold 58px Segoe UI'; c.fillText('У меня получилось!', 95, 210);
  c.font = '30px Segoe UI'; c.fillStyle = '#61717a'; c.fillText('Мой первый успех за компьютером', 95, 265);
  c.font = 'bold 38px Segoe UI'; c.fillStyle = '#24251f';
  const name = card.name.replace(/^Самостоятельно: /, '');
  wrap(c, name.slice(0, 105) + (card.name.length > 105 ? '…' : ''), 95, 355, 650, 52);
  drawKitten(c);
  c.font = '25px Segoe UI'; c.fillStyle = '#64767f';
  c.fillText(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'Europe/Moscow' }).format(new Date(card.at)), 95, 610);
  c.font = '26px Segoe UI'; c.fillText('Мы с Пушиком справились.', 95, 655);
  return canvas;
}

export function showPostcard(card: Skill): void {
  closePostcard();
  const p = el('section', 'success-postcard hit');
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Первый успех');
  header(p, 'Твой первый успех', closePostcard);
  const canvas = drawCard(card);
  const save = el('button', 'home-action', 'Сохранить открытку PNG');
  const status = el('div', 'postcard-status');
  status.setAttribute('role', 'status');
  save.onclick = async () => {
    save.disabled = true;
    try {
      const out = await api.savePostcard(canvas.toDataURL('image/png'));
      status.textContent = out.saved ? 'Открытка сохранена.' : out.error || '';
    } catch {
      status.textContent = 'Не удалось сохранить. Попробуй ещё раз.';
    } finally {
      save.disabled = false;
    }
  };
  p.append(canvas, save, status);
  document.body.append(p);
  postcard = p;
  save.focus();
}
