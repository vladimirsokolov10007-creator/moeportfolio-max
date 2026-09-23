// Минимальный статический сервер для предпросмотра мини-приложения.
// Поддерживает проброс аргументов --host / --port (и -h / -p).
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function argVal(names, dflt) {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i])) return args[i + 1];
    const eq = args[i].split('=');
    if (names.includes(eq[0]) && eq.length > 1) return eq[1];
  }
  return dflt;
}
const host = argVal(['--host', '-h'], 'localhost');
const port = parseInt(argVal(['--port', '-p'], '7100'), 10);
const root = __dirname;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, host, () => {
  console.log(`МоёПортфолио: http://${host}:${port}/`);
});
