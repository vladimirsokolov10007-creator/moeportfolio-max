// ═══════════════════════════════════════════════════════════════════════════
// Прокси для ИИ-функции «Резюме» мини-приложения «МоёПортфолио» (MAX)
//
// Зачем: браузер мини-приложения не может напрямую обратиться к API GigaChat
// или YandexGPT из-за ограничений CORS. Этот Cloudflare Worker принимает
// запрос от приложения, вызывает провайдера ИИ и возвращает ответ.
//
// ВАЖНО: ключи в воркере НЕ хранятся — приложение передаёт их в каждом
// запросе, они живут только на устройстве пользователя.
//
// Развёртывание (бесплатно, ~5 минут, без банковской карты):
//   1. dash.cloudflare.com → зарегистрируйтесь
//   2. Workers & Pages → Create Worker → Deploy
//   3. «Edit code» → удалите весь код → вставьте этот файл → Deploy
//   4. Скопируйте URL вида https://<имя>.workers.dev
//   5. Вставьте его в поле «URL прокси» в настройках ИИ приложения
// ═══════════════════════════════════════════════════════════════════════════

const OAUTH_URL = globalThis.MP_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GIGA_URL = globalThis.MP_GIGA_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
const YANDEX_URL = globalThis.MP_YANDEX_URL || 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

const GIGA_MODEL = globalThis.MP_GIGA_MODEL || 'GigaChat-2';
const YANDEX_MODEL = globalThis.MP_YANDEX_MODEL || 'yandexgpt-lite';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
  });
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
  if (!tokRes.ok) throw await readError(tokRes, 'GigaChat OAuth (проверьте ключ авторизации)');
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
  if (!res.ok) throw await readError(res, 'YandexGPT (проверьте API-ключ и Folder ID)');
  const data = await res.json();
  const text = data.result && data.result.alternatives && data.result.alternatives[0]
    && data.result.alternatives[0].message && data.result.alternatives[0].message.text;
  if (!text) throw new Error('YandexGPT: пустой ответ модели');
  return text;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Метод не поддержован: используйте POST' }, 405);

    let body;
    try { body = await request.json(); } catch (e) {
      return jsonResponse({ ok: false, error: 'Тело запроса — невалидный JSON' }, 400);
    }
    const provider = body.provider;
    const key = body.authKey || body.apiKey || '';
    const folderId = body.folderId || '';
    const system = body.system || 'Ты — помощник.';
    const prompt = body.prompt || '';

    if (!provider || !prompt) return jsonResponse({ ok: false, error: 'Нужны поля provider и prompt' }, 400);

    try {
      let text;
      if (provider === 'gigachat') {
        if (!key) return jsonResponse({ ok: false, error: 'Для GigaChat нужен ключ авторизации (authKey)' }, 400);
        text = await gigachatAsk(key, system, prompt);
      } else if (provider === 'yandexgpt') {
        if (!key || !folderId) return jsonResponse({ ok: false, error: 'Для YandexGPT нужны apiKey и folderId' }, 400);
        text = await yandexAsk(key, folderId, system, prompt);
      } else {
        return jsonResponse({ ok: false, error: 'Неизвестный провайдер: ' + provider }, 400);
      }
      return jsonResponse({ ok: true, text });
    } catch (e) {
      return jsonResponse({ ok: false, error: String((e && e.message) || e) }, 502);
    }
  },
};
