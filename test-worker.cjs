// Тест worker.js: мокаем OAuth GigaChat, chat GigaChat и YandexGPT
const http = require('http');

const mocks = {
  oauth: (req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      if (req.headers.authorization !== 'Basic bW9jaw==' || !req.headers.rquid) {
        res.writeHead(401); return res.end('{}');
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ access_token: 'mock-token-123', expires_in: 1800 }));
    });
  },
  giga: (req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const body = JSON.parse(b || '{}');
      if (req.headers.authorization !== 'Bearer mock-token-123') { res.writeHead(401); return res.end('{}'); }
      if (!body.messages || body.messages.length < 2) { res.writeHead(400); return res.end('{}'); }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ choices: [{ message: { content: '# Иванова Анна\n## Достижения\n- Диплом I степени — Олимпиада «Физтех» (2026)' } }] }));
    });
  },
  yandex: (req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const body = JSON.parse(b || '{}');
      if (req.headers.authorization !== 'Api-Key yandex-key') { res.writeHead(401); return res.end('{}'); }
      if (req.headers['x-folder-id'] !== 'folder1') { res.writeHead(403); return res.end('{}'); }
      if (!body.modelUri || !body.modelUri.includes('gpt://folder1/')) { res.writeHead(400); return res.end('{}'); }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ result: { alternatives: [{ message: { text: '# Резюме (Yandex)\n## Навыки\n- Анализ данных' } }] } }));
    });
  },
};

function serve(handler, port) {
  return new Promise(r => { const s = http.createServer(handler); s.listen(port, '127.0.0.1', () => r(s)); });
}

(async () => {
  const s1 = await serve(mocks.oauth, 9411);
  const s2 = await serve(mocks.giga, 9412);
  const s3 = await serve(mocks.yandex, 9413);

  globalThis.MP_OAUTH_URL = 'http://127.0.0.1:9411/api/v2/oauth';
  globalThis.MP_GIGA_URL = 'http://127.0.0.1:9412/api/v1/chat/completions';
  globalThis.MP_YANDEX_URL = 'http://127.0.0.1:9413/foundationModels/v1/completion';

  const worker = (await import('file:///C:/Users/vovas/OneDrive/Документы/Kimi/Workspaces/МоёПортфолио/max-portfolio/worker.js')).default;
  const env = { GIGACHAT_KEY: 'bW9jaw==' }; // как секреты в Cloudflare

  const post = body => new Request('https://worker.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // 0. GET — статус агентов
  const r0 = await worker.fetch(new Request('https://worker.test/'), env);
  console.log('GET agents:', r0.status, JSON.stringify((await r0.json()).agents));

  // 1. OPTIONS
  const opt = await worker.fetch(new Request('https://worker.test/', { method: 'OPTIONS' }));
  console.log('OPTIONS:', opt.status, opt.headers.get('Access-Control-Allow-Origin'));

  // 2. GigaChat success (ключ из env, в запросе его нет)
  const r1 = await worker.fetch(post({ provider: 'gigachat', system: 'sys', prompt: 'user prompt' }), env);
  const d1 = await r1.json();
  console.log('GigaChat:', r1.status, d1.ok, JSON.stringify(d1.text).slice(0, 60));

  // 3. GigaChat без секрета в env
  const r2 = await worker.fetch(post({ provider: 'gigachat', prompt: 'x' }), {});
  const d2 = await r2.json();
  console.log('GigaChat no secret:', r2.status, d2.ok, d2.error && d2.error.slice(0, 60));

  // 4. Yandex без секретов (в запросе ключ передан — обратная совместимость)
  const r3 = await worker.fetch(post({ provider: 'yandexgpt', apiKey: 'yandex-key', folderId: 'folder1', prompt: 'x' }), {});
  const d3 = await r3.json();
  console.log('YandexGPT body-key:', r3.status, d3.ok, JSON.stringify(d3.text).slice(0, 40));

  // 5. Yandex без ключей вообще
  const r4 = await worker.fetch(post({ provider: 'yandexgpt', prompt: 'x' }), {});
  const d4 = await r4.json();
  console.log('YandexGPT no keys:', r4.status, d4.ok, d4.error && d4.error.slice(0, 60));

  s1.close(); s2.close(); s3.close();
  console.log('DONE');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
