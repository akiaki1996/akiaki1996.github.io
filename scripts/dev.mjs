import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

buildSite();

for (const dir of ['content', 'src']) {
  const target = path.join(ROOT, dir);
  if (fs.existsSync(target)) {
    fs.watch(target, { recursive: true }, () => {
      try {
        buildSite();
        console.log(`[rebuild] ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        console.error('[rebuild error]', err.message);
      }
    });
  }
}

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(PUBLIC_DIR, reqPath);
  if (reqPath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    const notFound = path.join(PUBLIC_DIR, '404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(notFound).pipe(res);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Preview server running at http://127.0.0.1:${PORT}/`);
});
