// Показ на экране вместо текста: разбор ответов модели. Без electron, чтобы легко проверять в тестах.

// Метка в ответе чата: «не отвечай текстом, а покажи на экране».
export const SHOW_MARK = '[SHOW]';

/** «[SHOW] цель» в ответе модели → цель для показа на экране, иначе ''. */
export function showGoal(reply: string): string {
  const m = /\[\s*(?:SHOW|ПОКАЖУ|ПОКАЗАТЬ)\s*\]\s*[:\-–]?\s*(.+)/i.exec(reply);
  return m ? m[1]!.split('\n')[0]!.replace(/[«»"]/g, '').trim().slice(0, 300) : '';
}
