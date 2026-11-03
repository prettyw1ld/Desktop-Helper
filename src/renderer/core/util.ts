export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const now = (): number => performance.now();

/** Таймер, который можно перезапустить: новый запуск отменяет старый. */
export function timer(): { set(fn: () => void, ms: number): void; clear(): void } {
  let id: ReturnType<typeof setTimeout> | undefined;
  return {
    set(fn, ms) { clearTimeout(id); id = setTimeout(fn, ms); },
    clear() { clearTimeout(id); id = undefined; },
  };
}
