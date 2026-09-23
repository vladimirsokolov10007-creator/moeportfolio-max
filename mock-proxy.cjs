// Мок-прокси, имитирующий ответ worker.js для теста приложения
const http = require('http');
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = JSON.parse(b || '{}');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      text: '# Иванова Анна Сергеевна\n## Цель\nJunior-разработчик\n\n## Достижения и награды\n### Дипломы\n- **Диплом I степени** — Олимпиада «Физтех», 2026 г.: Победа в региональном этапе\n### Сертификаты\n- **Сертификат повышения квалификации** — Школа аналитиков, 2025 г.\n\n## Ключевые навыки\n- Аналитическое мышление\n- Работа в команде\n- Быстрое обучение\n\n## О себе\nАктивно участвую в олимпиадах и профессиональных программах, стремлюсь применять знания на практике.'
    }));
  });
}).listen(7410, '127.0.0.1', () => console.log('mock proxy on 7410'));
