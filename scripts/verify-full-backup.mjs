import {createHmac, createHash, timingSafeEqual} from 'node:crypto';
import {readFile, stat, mkdir, copyFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function verifyFullBackup(directory, secret) {
  if (!secret) throw Error('Задайте BACKUP_SIGNING_KEY у середовищі процесу.');
  const root = resolve(directory);
  const envelope = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const expected = createHmac('sha256', secret).update(envelope.payload).digest();
  const signature = Buffer.from(envelope.signature ?? '', 'hex');
  if (signature.length !== expected.length || !timingSafeEqual(expected, signature)) throw Error('Підпис manifest.json некоректний.');
  const manifest = JSON.parse(envelope.payload);
  if (manifest.format !== 'archi-create-full-v1' || !Array.isArray(manifest.files)) throw Error('Непідтримувана копія.');
  const files = [];
  const paths = new Set();
  for (const entry of manifest.files) {
    if (!entry.path || paths.has(entry.path) || !/^(content\.json|social\.sql|static\/.+)$/.test(entry.path)) throw Error('Некоректний шлях у копії.');
    paths.add(entry.path);
    const source = resolve(root, entry.name);
    const destination = resolve(root, 'restored', entry.path);
    for (const path of [source, destination]) {
      const rel = relative(root, path);
      if (rel === '..' || rel.startsWith('..' + sep) || resolve(path) === root) throw Error('Шлях виходить за межі копії.');
    }
    if ((await stat(source)).size !== entry.size) throw Error('Не збігається розмір ' + entry.path);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(source)) hash.update(chunk);
    if (hash.digest('hex') !== entry.sha256) throw Error('Пошкоджено ' + entry.path);
    files.push({source, destination});
  }
  if (!paths.has('content.json') || !paths.has('social.sql') || !manifest.files.some(file => file.path.startsWith('static/'))) throw Error('Копія неповна.');
  return {manifest, files};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const {manifest, files} = await verifyFullBackup(process.argv[2] ?? '.', process.env.BACKUP_SIGNING_KEY);
  for (const {source, destination} of files) {
    await mkdir(resolve(destination, '..'), {recursive: true});
    await copyFile(source, destination);
  }
  console.log('Перевірено й підготовлено ' + files.length + ' файлів. Git-коміт ' + manifest.commit + '.');
  if (manifest.workingTreeDirty) console.log('Збірка містила незакомічені зміни. Звірте код із відповідною робочою копією.');
}
