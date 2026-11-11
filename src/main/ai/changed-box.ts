// Что появилось на экране после нажатия: сравниваем два маленьких снимка (до и после)
// и находим прямоугольник, где экран поменялся — открывшееся меню, список или окно.
// Работает в любой программе: не зависит от того, что она сообщает системе о своих кнопках.

export interface Box { x: number; y: number; w: number; h: number }

const CELL = 8;        // сторона клетки в пикселях маленького снимка
const PIXEL_DIFF = 30; // насколько должен отличаться пиксель (сумма по трём цветам)
const CELL_SHARE = 0.06; // доля изменившихся пикселей, чтобы клетка считалась изменившейся
const MIN_CELLS = 4;

/**
 * a, b — снимки BGRA одного размера w×h. near — точка нажатия (в пикселях снимка), если известна:
 * из нескольких изменившихся мест берём то, что рядом с ней. Ответ в пикселях снимка или null, если почти ничего не изменилось.
 */
export function changedBox(a: Buffer, b: Buffer, w: number, h: number, near?: { x: number; y: number } | null): Box | null {
  if (a.length !== b.length || a.length < w * h * 4 || w < CELL * 2 || h < CELL * 2) return null;
  const cw = Math.ceil(w / CELL);
  const ch = Math.ceil(h / CELL);
  const changed = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let diff = 0;
      let n = 0;
      const y1 = Math.min(h, (cy + 1) * CELL);
      const x1 = Math.min(w, (cx + 1) * CELL);
      for (let y = cy * CELL; y < y1; y++) {
        for (let x = cx * CELL; x < x1; x++) {
          const i = (y * w + x) * 4;
          const d = Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
          if (d > PIXEL_DIFF) diff++;
          n++;
        }
      }
      if (n && diff / n >= CELL_SHARE) changed[cy * cw + cx] = 1;
    }
  }
  // соседние изменившиеся клетки (через одну пустую тоже) собираем в пятна
  const seen = new Uint8Array(cw * ch);
  type Blob = { n: number; x0: number; y0: number; x1: number; y1: number };
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || seen[start]) continue;
    const blob: Blob = { n: 0, x0: cw, y0: ch, x1: -1, y1: -1 };
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cw;
      const cy = (c - cx) / cw;
      blob.n++;
      if (cx < blob.x0) blob.x0 = cx;
      if (cy < blob.y0) blob.y0 = cy;
      if (cx > blob.x1) blob.x1 = cx;
      if (cy > blob.y1) blob.y1 = cy;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const k = ny * cw + nx;
          if (!changed[k] || seen[k]) continue;
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (blob.n >= MIN_CELLS) blobs.push(blob);
  }
  if (!blobs.length) return null;
  const bySize = (p: Blob, q: Blob) => q.n - p.n;
  let pick = blobs.slice().sort(bySize)[0]!;
  if (near) {
    const nx = near.x / CELL;
    const ny = near.y / CELL;
    const close = blobs.filter((p) => nx >= p.x0 - 4 && nx <= p.x1 + 5 && ny >= p.y0 - 4 && ny <= p.y1 + 5).sort(bySize)[0];
    if (close) pick = close;
  }
  const x = pick.x0 * CELL;
  const y = pick.y0 * CELL;
  return { x, y, w: Math.min(w, (pick.x1 + 1) * CELL) - x, h: Math.min(h, (pick.y1 + 1) * CELL) - y };
}
