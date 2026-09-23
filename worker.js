// ═══════════════════════════════════════════════════════════════════════════
// Прокси для ИИ-функции «Резюме» мини-приложения «МоёПортфолио» (MAX)
//
// Зачем: браузер мини-приложения не может напрямую обратиться к API GigaChat
// или YandexGPT из-за ограничений CORS. Этот Cloudflare Worker принимает
// запрос от приложения, вызывает провайдера ИИ и возвращает ответ.
//
// Ключи хранятся в СЕКРЕТАХ воркера (Variables and Secrets) — не в коде
// и не в приложении. Приложению достаточно выбрать агента.
//
// РАЗВЁРТЫВАНИЕ (бесплатно, ~5 минут, без банковской карты):
//   1. dash.cloudflare.com → зарегистрируйтесь
//   2. Workers & Pages → Create Worker → Deploy
//   3. «Edit code» → удалите весь код → вставьте этот файл → Deploy
//   4. Settings → Variables and Secrets → добавьте секреты (см. ниже)
//   5. Скопируйте URL вида https://<имя>.workers.dev и вставьте его
//      в поле «URL прокси» в приложении
//
// СЕКРЕТЫ (какие добавить — зависит от выбранного агента):
//   GIGACHAT_KEY      — Authorization Key GigaChat (developers.sber.ru,
//                       проект → GigaChat API → «Данные авторизации»)
//   YANDEX_API_KEY    — API-ключ сервисного аккаунта (cloud.yandex.ru)
//   YANDEX_FOLDER_ID  — идентификатор каталога (cloud.yandex.ru)
//
// ПРОВЕРКА: откройте https://<имя>.workers.dev в браузере — воркер
// вернёт JSON со списком настроенных агентов.
// ═══════════════════════════════════════════════════════════════════════════

const OAUTH_URL = globalThis.MP_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GIGA_URL = globalThis.MP_GIGA_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
const YANDEX_URL = globalThis.MP_YANDEX_URL || 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

const GIGA_MODEL = globalThis.MP_GIGA_MODEL || 'GigaChat-2';
const YANDEX_MODEL = globalThis.MP_YANDEX_MODEL || 'yandexgpt-lite';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

function agents(env) {
  return {
    gigachat: !!(env.GIGACHAT_KEY || ''),
    yandexgpt: !!(env.YANDEX_API_KEY && env.YANDEX_FOLDER_ID),
  };
}

async function readError(res, prefix) {
  let detail = '';
  try { detail = (await res.text()).slice(0, 300); } catch (e) {}
  return new Error(prefix + ': HTTP ' + res.status + (detail ? ' — ' + detail : ''));
}

async function gigachatAsk(key, system, prompt) {
  // 1. OAuth: меняем ключ авторизации на access_token (живёт 30 минут)
  const tokRes = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'RqUID': crypto.randomUUID(),
      'Authorization': 'Basic ' + key,
    },
    body: 'scope=GIGACHAT_API_PERS',
  });
  if (!tokRes.ok) throw await readError(tokRes, 'GigaChat OAuth (проверьте ключ GIGACHAT_KEY)');
  const tokData = await tokRes.json();
  if (!tokData.access_token) throw new Error('GigaChat OAuth: в ответе нет access_token');

  // 2. Запрос к модели
  const res = await fetch(GIGA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + tokData.access_token,
    },
    body: JSON.stringify({
      model: GIGA_MODEL,
      temperature: 0.4,
      max_tokens: 2500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw await readError(res, 'GigaChat');
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('GigaChat: пустой ответ модели');
  return text;
}

async function yandexAsk(key, folderId, system, prompt) {
  const res = await fetch(YANDEX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Api-Key ' + key,
      'x-folder-id': folderId,
    },
    body: JSON.stringify({
      modelUri: 'gpt://' + folderId + '/' + YANDEX_MODEL,
      completionOptions: { stream: false, temperature: 0.4, maxTokens: 2500 },
      messages: [
        { role: 'system', text: system },
        { role: 'user', text: prompt },
      ],
    }),
  });
  if (!res.ok) throw await readError(res, 'YandexGPT (проверьте YANDEX_API_KEY и YANDEX_FOLDER_ID)');
  const data = await res.json();
  const text = data.result && data.result.alternatives && data.result.alternatives[0]
    && data.result.alternatives[0].message && data.result.alternatives[0].message.text;
  if (!text) throw new Error('YandexGPT: пустой ответ модели');
  return text;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    // GET — статус: какие агенты настроены
    if (request.method === 'GET') {
      return jsonResponse({ ok: true, agents: agents(env || {}) });
    }
    if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Метод не поддержован' }, 405);

    let body;
    try { body = await request.json(); } catch (e) {
      return jsonResponse({ ok: false, error: 'Тело запроса — невалидный JSON' }, 400);
    }
    const provider = body.provider;
    const system = body.system || 'Ты — помощник.';
    const prompt = body.prompt || '';
    if (!provider || !prompt) return jsonResponse({ ok: false, error: 'Нужны поля provider и prompt' }, 400);

    // Ключ: сначала секрет воркера, затем (для совместимости) ключ из запроса
    const gigaKey = (env && env.GIGACHAT_KEY) || body.authKey || '';
    const yaKey = (env && env.YANDEX_API_KEY) || body.apiKey || '';
    const yaFolder = (env && env.YANDEX_FOLDER_ID) || body.folderId || '';

    try {
      let text;
      if (provider === 'gigachat') {
        if (!gigaKey) return jsonResponse({ ok: false, error: 'GigaChat не настроен: добавьте секрет GIGACHAT_KEY в настройки воркера' }, 400);
        text = await gigachatAsk(gigaKey, system, prompt);
      } else if (provider === 'yandexgpt') {
        if (!yaKey || !yaFolder) return jsonResponse({ ok: false, error: 'YandexGPT не настроен: добавьте секреты YANDEX_API_KEY и YANDEX_FOLDER_ID в настройки воркера' }, 400);
        text = await yandexAsk(yaKey, yaFolder, system, prompt);
      } else {
        return jsonResponse({ ok: false, error: 'Неизвестный провайдер: ' + provider }, 400);
      }
      return jsonResponse({ ok: true, text });
    } catch (e) {
      return jsonResponse({ ok: false, error: String((e && e.message) || e) }, 502);
    }
  },
};
