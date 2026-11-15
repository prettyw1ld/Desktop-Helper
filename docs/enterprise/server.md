# Развёртывание серверов Пушика

Два сервера, оба внутри сети компании:

1. **Сервер модели** (E-16) — vLLM с Qwen3-VL на GPU и шлюз LiteLLM перед ним. Сюда Пушик шлёт снимки и вопросы (`ai.url` в политике).
2. **Сервер присутствия** (E-40) — админ-панель, регистрация котов, подписанные настройки. Сюда идут только «жив» и состояние (`presence.url`).

```
Пушик ──HTTPS──▶ LiteLLM (ключ на человека/отдел, лимиты) ──▶ vLLM (отдельная сеть, без доступа снаружи)
Пушик ──HTTPS──▶ nginx ──▶ сервер присутствия ──▶ PostgreSQL
```

## 1. Сервер модели: vLLM + Qwen3-VL-8B, LiteLLM

Пилот: одна GPU 24 ГБ (RTX 4090 / L4 / A10) держит Qwen3-VL-8B-Instruct в bf16 с контекстом 16k. Отдел: 48–96 ГБ и Qwen3-VL-30B-A3B.

### Главное о безопасности

- **vLLM не выставлять в сеть напрямую.** Ключ `--api-key` закрывает только `/v1/*`; `/metrics`, `/tokenize`, служебные маршруты и межузловые порты без проверки. vLLM слушает `127.0.0.1` или отдельную сеть, куда ходит только шлюз ([vLLM security](https://docs.vllm.ai/en/latest/usage/security/)).
- **Шлюз пропускает только `/v1/chat/completions`**, с ключом на человека или отдел, лимитом запросов и токенов, размером тела до 10 МБ, `max_tokens` не больше 2000.
- **Картинки только в самом запросе (base64).** Загрузку по ссылке закрыть: `--allowed-media-domains` пустой, `VLLM_MEDIA_URL_ALLOW_REDIRECTS=0` — иначе модель можно заставить ходить по внутренней сети (SSRF).
- **Не хранить снимки.** В LiteLLM выключить запись содержимого запросов в журналы (`turn_off_message_logging`), оставить метаданные: кто, когда, сколько токенов.
- **Веса — из внутреннего зеркала**, только safetensors, сверка SHA-256; образы контейнеров по digest, не `latest`.
- Ключи LiteLLM (`LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY`) — в хранилище секретов, не в конфиге. Соль после первого запуска не менять.

### Запуск (пример)

```sh
# веса заранее скачаны во внутреннее зеркало /models/Qwen3-VL-8B-Instruct
docker run -d --name vllm --gpus all --network model-net \
  -v /models:/models:ro \
  -e VLLM_MEDIA_URL_ALLOW_REDIRECTS=0 \
  vllm/vllm-openai@sha256:<digest> \
  --model /models/Qwen3-VL-8B-Instruct --served-model-name qwen3-vl \
  --max-model-len 16384 --limit-mm-per-prompt '{"image":2}' \
  --api-key "$VLLM_KEY" --host 0.0.0.0 --port 8000
```

`--limit-mm-per-prompt`: Пушик шлёт до двух картинок (выделение и окно с рамкой для «Объясни это»).

LiteLLM (`config.yaml`):

```yaml
model_list:
  - model_name: qwen3-vl
    litellm_params:
      model: hosted_vllm/qwen3-vl
      api_base: http://vllm:8000/v1
      api_key: os.environ/VLLM_KEY
litellm_settings:
  turn_off_message_logging: true
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
```

Ключи выдаются виртуальные, на отдел или человека, с лимитом (`/key/generate` с `rpm_limit`, `tpm_limit`, `max_budget`). Ключ отдела кладётся в `ai.apiKey` в `policy.json`. Его может прочитать любой пользователь этого ПК, поэтому ключ — на отдел, с лимитом, а не мастер-ключ.

Политика Пушика:

```json
"ai": { "kind": "openai", "url": "https://llm.corp.local/v1", "model": "qwen3-vl", "apiKey": "sk-отдел-ИБ-…" }
```

Проверка: `curl -H "Authorization: Bearer sk-…" https://llm.corp.local/v1/models` отвечает `qwen3-vl`, а `https://llm.corp.local/metrics` — 404 или 403.

## 2. Сервер присутствия: Docker Compose

Файлы в [`server/deploy`](../../server/deploy): `docker-compose.yml` (сервер, PostgreSQL, nginx), `nginx.conf`, `.env.example`.

```sh
cd server/deploy
cp .env.example .env            # пароли и секрет регистрации
mkdir tls && cp /путь/server.crt /путь/server.key tls/   # сертификат от корпоративного УЦ
# в nginx.conf поменять 10.0.0.0/8 на подсеть отдела ИБ: оттуда открывается админ-панель
docker compose up -d
curl -k https://localhost/healthz   # {"ok":true}
```

Что заложено:

- PostgreSQL во внутренней сети Docker, наружу не смотрит; таблицы создаются при первом запуске.
- Сервер работает не от root, файловая система только для чтения, без capabilities.
- nginx: TLS 1.2+, HSTS, тело запроса до 32 КБ, ограничение частоты регистрации (20 в минуту с адреса) и «жив». Админ-панель, список устройств и выкладка настроек — только из подсети ИБ.
- Подписанные настройки ([ADR-0001](adr/0001-signed-remote-config.md)): `CONFIG_PUBLIC_KEY` в `.env`, тогда сервер не примет неподписанный набор.

Резервная копия: `docker compose exec db pg_dump -U pushik pushik > pushik-$(date +%F).sql`.

Чего пока нет: входа админов через Keycloak/AD и ролей (E-35) — сейчас один пароль `admin`. До E-35 держите админ-панель закрытой подсетью.
