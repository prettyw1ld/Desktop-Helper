# Политика организации (корпоративный режим)

Если на компьютере есть политика, Пушик работает в корпоративном режиме:

- ИИ обращается только к серверу из политики; запросы на любой другой адрес блокируются в самом приложении;
- облачные сервисы (Groq, Claude, DeepSeek, Qwen) и их ключи не используются, `team.json` не читается;
- раздел «Помощник с ИИ» в настройках скрыт, пользователь модель и ключ не меняет;
- голос распознаётся только на самом компьютере (Vosk);
- испорченная политика выключает ИИ целиком, а не возвращает облако.

Без политики Пушик работает как раньше.

## Файл

| Система | Путь |
|---|---|
| Windows | `%ProgramData%\Pushik\policy.json` |
| macOS | `/Library/Application Support/Pushik/policy.json` |

Писать в эти папки может только администратор.

```json
{
  "org": "Отдел ИБ",
  "ai": {
    "kind": "openai",
    "url": "https://llm.corp.local/v1",
    "model": "qwen3-vl-8b",
    "visionModel": "qwen3-vl-8b"
  },
  "features": { "chat": true, "guide": true, "inspect": true }
}
```

| Поле | Что значит |
|---|---|
| `org` | Название, которое видно в настройках |
| `ai` | Сервер модели. `null` — ИИ выключен, работают только уроки |
| `ai.kind` | `openai` — vLLM, LiteLLM и любой OpenAI-совместимый сервер; `ollama` — Ollama |
| `ai.url` | Только `https`. `http` разрешён для `localhost` или с `"allowHttp": true` |
| `ai.model`, `ai.visionModel` | Модель для текста и для снимков экрана (если одна — `visionModel` можно не писать) |
| `ai.apiKey` | Ключ сервера, если он нужен. Файл читают все пользователи компьютера, поэтому лучше сервер без ключа во внутренней сети; токен на устройство — задача E-06 |
| `features.chat` | Чат с котом |
| `features.guide` | Показ по шагам («Сказать задачу», «Покажи, как») |
| `features.inspect` | «Объясни, что это» |

## Групповая политика (Windows)

Ключ `HKLM\Software\Policies\Pushik`. Значения из реестра главнее файла.

| Значение | Тип | Пример |
|---|---|---|
| `Org` | REG_SZ | `Отдел ИБ` |
| `AiUrl` | REG_SZ | `https://llm.corp.local/v1` |
| `AiModel` | REG_SZ | `qwen3-vl-8b` |
| `AiVisionModel` | REG_SZ | `qwen3-vl-8b` |
| `AiKind` | REG_SZ | `openai` или `ollama` |
| `AiAllowHttp` | REG_DWORD | `1` |
| `AiOff` | REG_DWORD | `1` — ИИ выключен |
| `Chat`, `Guide`, `Inspect` | REG_DWORD | `0` — выключить |
