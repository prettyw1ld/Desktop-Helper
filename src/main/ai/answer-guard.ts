// Проверка ответа ИИ перед показом: опасные команды и советы не показываем, ссылки в организации —
// только на разрешённые адреса. Без Electron, чтобы проверять тестами.

export type DangerReason = 'command' | 'protection' | 'secrets';

// Команды, которыми обычно ставят вредоносное, стирают данные или ломают защиту
const COMMAND = new RegExp([
  String.raw`\b(?:iex|invoke-expression)\b`,
  String.raw`\|\s*(?:iex|sh|bash|zsh)\b`,
  String.raw`\bpowershell(?:\.exe)?\b[^\n]{0,60}\s-(?:e|ec|enc|encodedcommand)\s`,
  String.raw`\bcertutil\b[^\n]{0,40}-urlcache`,
  String.raw`\bmshta(?:\.exe)?\s`,
  String.raw`\bregsvr32\b[^\n]{0,40}/i:`,
  String.raw`\brm\s+-[a-z]*r[a-z]*f`,
  String.raw`\bformat\s+[a-z]:`,
  String.raw`\bdel\s+/[sfq]`,
  String.raw`\bvssadmin\b[^\n]{0,30}delete`,
  String.raw`\bbcdedit\b`,
  String.raw`\bcipher\s+/w`,
  String.raw`\breg\s+delete\b`,
  String.raw`\bset-mppreference\b[^\n]{0,60}-disable`,
  String.raw`\bnet\s+(?:user|localgroup)\b[^\n]{0,60}/add`,
].join('|'), 'i');

// Совет отключить защиту компьютера
const PROTECTION = /(?:отключ|выключ|останов|удали)\S*\s+(?:\S+\s+){0,3}(?:антивирус|защитник|брандмауэр|касперск|dlp|контроль учётных записей|uac|defender|firewall)|\b(?:disable|turn off|uninstall)\s+(?:\S+\s+){0,3}(?:antivirus|defender|firewall|uac|kaspersky|dlp)\b/i;

// Совет сообщить кому-то пароль или код: так работают мошенники
const SECRETS = /(?:сообщи|скажи|продиктуй|отправь|перешли|назови|покажи)\S*\s+(?:\S+\s+){0,4}(?:парол|код\S* из (?:смс|sms)|код подтвержд|cvv|cvc|пин-?код|сид-фраз|seed)|\b(?:tell|send|share|read out|give)\s+(?:\S+\s+){0,4}(?:password|sms code|verification code|cvv|cvc|pin|seed phrase)\b/i;

export function dangerOf(text: string): DangerReason | '' {
  if (COMMAND.test(text)) return 'command';
  if (PROTECTION.test(text)) return 'protection';
  if (SECRETS.test(text)) return 'secrets';
  return '';
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'«»)\]]+/gi;

/** Разрешён ли адрес: точное имя или его поддомен. */
export function hostAllowed(url: string, allow: readonly string[]): boolean {
  let host = '';
  try { host = new URL(/^www\./i.test(url) ? `https://${url}` : url).hostname.toLowerCase(); } catch { return false; }
  return allow.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Правила ответа: allowHosts = null — ссылки не проверяются (дома), [] — ссылок нет совсем. */
export interface AnswerRules { allowHosts: string[] | null }
export const OPEN_ANSWERS: AnswerRules = { allowHosts: null };

export interface Guarded { text: string; danger: DangerReason | ''; removedLinks: number }

/** Ответ ИИ к показу: опасный заменяем отказом, лишние ссылки убираем. */
export function guardAnswer(text: string, rules: AnswerRules, refusal: string, linkStub: string): Guarded {
  const danger = dangerOf(text);
  if (danger) return { text: refusal, danger, removedLinks: 0 };
  let removedLinks = 0;
  const allow = rules.allowHosts;
  const out = allow === null ? text : text.replace(URL_RE, (m) => {
    // точка или запятая после ссылки — это конец фразы, а не часть адреса
    const tail = /[.,;:!?]+$/.exec(m)?.[0] ?? '';
    const u = m.slice(0, m.length - tail.length);
    if (hostAllowed(u, allow)) return m;
    removedLinks++;
    return linkStub + tail;
  });
  return { text: out, danger: '', removedLinks };
}

/** Раздел answers из политики: список разрешённых адресов (имена хостов). В организации по умолчанию ссылок нет. */
export function parseAnswers(raw: unknown): AnswerRules {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const list = Array.isArray(o.allowHosts) ? o.allowHosts : [];
  const allowHosts = list
    .filter((h): h is string => typeof h === 'string')
    .map((h) => h.trim().toLowerCase().replace(/^\*\./, ''))
    .filter((h) => /^[a-z0-9.-]{1,253}$/.test(h) && h.includes('.'))
    .slice(0, 100);
  return { allowHosts };
}
