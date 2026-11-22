import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { projectCategories } from '../src/project-categories.mjs';

const file = 'content/projects.json';
const readProjects = async () => JSON.parse(await readFile(file, 'utf8'));
let pending = Promise.resolve();

async function body(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Файл або запит завеликий.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function imagePath(value) {
  if (typeof value !== 'string' || !/^assets\/projects\/[\w/-]+\.(jpg|jpeg|png|webp)$/i.test(value)) {
    throw new Error('Виберіть або завантажте зображення проєкту.');
  }
  await access('public/' + value).catch(() => { throw new Error('Зображення не знайдено: ' + value); });
  return value;
}

async function saveProject(input) {
  const projects = await readProjects();
  const index = input.id ? projects.findIndex(project => project.id === input.id) : -1;
  if (input.id && index < 0) throw new Error('Проєкт не знайдено.');
  const revision = projects[index]?.revision ?? 0;
  if (index >= 0 && input.revision !== revision) return null;
  const title = input.title?.trim();
  const label = input.label?.trim();
  if (!title || !label || title.length > 150 || label.length > 100 || !Object.hasOwn(projectCategories, input.category)) {
    throw new Error('Заповніть назву, тип і категорію.');
  }
  const url = input.url?.trim() || '';
  if (url && new URL(url).protocol !== 'https:') throw new Error('Посилання має починатися з https://.');
  if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > 40) {
    throw new Error('Додайте від 1 до 40 фото галереї.');
  }
  const project = {
    id: projects[index]?.id ?? randomUUID(),
    revision: revision + 1,
    number: projects[index]?.number ?? String(Math.max(0, ...projects.map(p => Number(p.number))) + 1).padStart(2, '0'),
    title, label, category: input.category, url,
    cover: await imagePath(input.cover),
    images: await Promise.all(input.images.map(imagePath)),
  };
  if (index < 0) projects.unshift(project);
  else projects[index] = project;
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(projects, null, 2) + '\n');
  await rename(temporary, file);
  return project;
}

export async function projectEditor(request, response, path, origin) {
  const json = (status, value) => response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  }).end(JSON.stringify(value));
  try {
    if (request.method === 'GET' && path === '/__local/projects') return json(200, (await readProjects()).map(project => ({ revision: 0, ...project })));
    if (request.method !== 'POST' || request.headers.origin !== origin) return json(403, { error: 'Доступ лише з локальної адмінпанелі.' });
    if (path === '/__local/projects' && request.headers['content-type'] === 'application/json') {
      const input = JSON.parse(await body(request, 64 * 1024));
      const task = pending.then(() => saveProject(input));
      pending = task.catch(() => {});
      const saved = await task;
      return saved ? json(200, saved) : json(409, { error: 'Версія проєкту застаріла. Скопіюйте потрібні правки й завантажте актуальну версію.' });
    }
    if (path === '/__local/upload') {
      const data = await body(request, 8 * 1024 * 1024);
      const extension = data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpg'
        : data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
        : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
      if (!extension) throw new Error('Підтримуються JPG, PNG і WebP.');
      const directory = 'assets/projects/uploads';
      const image = directory + '/' + randomUUID() + '.' + extension;
      await mkdir('public/' + directory, { recursive: true });
      await writeFile('public/' + image, data);
      return json(201, { image });
    }
    return json(404, { error: 'Запит не знайдено.' });
  } catch (error) {
    return json(400, { error: error.message });
  }
}
