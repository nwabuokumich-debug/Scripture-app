import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const ROOT = process.cwd();

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function resolvePath(urlPath) {
  const cleanPath = normalize(decodeURIComponent(urlPath).split('?')[0]).replace(/^(\.\.[/\\])+/, '');
  const relativePath = cleanPath === '/' ? '/index.html' : cleanPath;
  return join(ROOT, relativePath);
}

function sendFile(res, filePath) {
  const extension = extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  const method = req.method || 'GET';
  if (!['GET', 'HEAD'].includes(method)) {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const filePath = resolvePath(req.url || '/');
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  if (method === 'HEAD') {
    const extension = extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  sendFile(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`Scripture app available at http://${HOST}:${PORT}`);
});
