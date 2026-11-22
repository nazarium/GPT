import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { projectEditor } from './project-editor.mjs';

const root = resolve('dist');
const admin = process.argv.includes('--admin');
const port = admin ? 4174 : 4173;
const origin = 'http://127.0.0.1:' + port;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };

createServer(async (request, response) => {
  try {
    if (admin && request.headers.host !== '127.0.0.1:' + port) return response.writeHead(403).end();
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (admin && path.startsWith('/__local/')) return await projectEditor(request, response, path, origin);
    if (admin && ['/admin', '/admin/', '/admin.js', '/admin.css'].includes(path)) {
      const name = path.endsWith('.js') ? 'admin.js' : path.endsWith('.css') ? 'admin.css' : 'admin.html';
      const content = await readFile('.build/' + name);
      return response.writeHead(200, { 'Content-Type': types[extname(name)], 'Cache-Control': 'no-store' }).end(content);
    }
    if (path === '/') path = '/index.html';
    else if (!extname(path)) path += '.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) {
      response.writeHead(404).end('Not found');
      return;
    }
    let content = admin && /^\/assets\/projects\/uploads\/[\w-]+\.(jpg|png|webp)$/.test(path)
      ? await readFile('public' + path)
      : await readFile(file);
    if (admin && path === '/index.html') content = content.toString().replace('</head>', '<meta name="archi-local-admin"></head>');
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log('Local: ' + origin + (admin ? '/admin' : '/')));
