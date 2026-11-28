import {DriveBackup} from './drive-backup.mjs';
export {DriveBackup};
import {snapshotResponse,restore,importBatch} from './site-backup.mjs';
import {defaultTools, validateTools} from './site-tools.mjs';
import { DurableObject } from 'cloudflare:workers';
import { tick, socialAdmin } from '../social/engine.mjs';
import { notFound } from './not-found.mjs';
import { contactBotConfigured, submitContact } from './contact.mjs';
import { sanitizeArticleHtml } from './article-html.mjs';
import initialProjects from '../content/projects.json';
import { projectCategories } from '../src/project-categories.mjs';
import admin from '../.build/admin-assets.mjs';
import { articleRoute, originalArticles, renderBlog } from './blog.mjs';
import blogSources from '../public/BLOG-SOURCES.json';
import { renderPreview } from './preview.mjs';
import { projectDetails, projectPath } from '../src/project-details.mjs';
import { renderProject } from './project-page.mjs';
import defaultHeroSlides from '../content/hero.json';
import { originalLegal, renderLegal } from './legal.mjs';
import { currentHomeTexts, originalHomeTexts } from './home-texts.mjs';
import { contactSymbols, defaultSectionLabels, defaultContactTexts, defaultApproachTexts, defaultStudioDetails, studioNumberPatterns, textGroups } from '../src/home-text-fields.mjs';
import { defaultContacts, phoneHref } from '../src/contact-settings.mjs';
import { defaultPalette } from '../src/site-palette.mjs';
import { paletteCss, typographyCss } from './site-palette.mjs';
import { defaultFonts, siteFonts } from '../src/site-fonts.mjs';
import { defaultHeroCaptionPosition, defaultHeroTiming, heroCaptionPositions, heroTransitions, isHeroInterval } from '../src/hero-settings.mjs';
import { defaultProjectCount, defaultArticleCount, maxHomeCount } from '../src/home-display.mjs';
import { articlePath, uniqueArticleSlug } from '../src/article-address.mjs';

const articleRedirects = new Map(blogSources.articles.map(article => [
  decodeURIComponent(new URL(article.source).pathname).replace(/\/$/, ''),
  '/' + article.file,
]));

const marker = '<meta name="archi-cloud-admin">';
const photoPath = /^assets\/projects\/[\w/-]+\.(jpe?g|png|webp)$/i;
const uploadPath = /^\/assets\/projects\/cloud\/[a-f0-9-]{36}\.(jpg|png|webp)$/;
const heroUploadPath = /^\/assets\/hero\/cloud\/[a-f0-9-]{36}\.(jpg|png|webp)$/;
const adminRoutes = {
  "/api/admin/home/tools": ["GET", "POST"],
  "/api/admin/home/backup": ["GET", "POST"],
  "/api/admin/home": [
    "GET",
    "POST"
  ],
  "/api/admin/home/order": [
    "GET",
    "POST"
  ],
  "/api/admin/home/social": [
    "GET",
    "POST"
  ],
  "/api/admin/home/texts": [
    "GET",
    "POST"
  ],
  "/api/admin/home/contacts": [
    "GET",
    "POST"
  ],
  "/api/admin/projects": [
    "GET",
    "POST"
  ],
  "/api/admin/articles": [
    "GET",
    "POST"
  ],
  "/api/admin/projects/order": [
    "GET",
    "POST"
  ],
  "/api/admin/home/upload": [
    "POST"
  ],
  "/api/admin/upload": [
    "POST"
  ],
  "/api/admin/projects/state": [
    "POST"
  ],
  "/api/admin/articles/state": [
    "POST"
  ]
};
const adminLegalPath = /^\/api\/admin\/legal\/(terms|privacy-policy)$/;
const json = (value, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const fail = (error, status = 400) => json({ error }, status);

async function allowed(request, secret) {
  if (!secret || secret.length < 24) return false;
  const supplied = request.headers.get('Authorization') || '';
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [actual, expected] = await Promise.all([digest(supplied), digest('Basic ' + btoa('admin:' + secret))]);
  return actual.reduce((difference, byte, index) => difference | (byte ^ expected[index]), 0) === 0;
}

async function limitedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error('Файл або запит завеликий.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function imageFormat(bytes) {
  const matches = (signature, offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
  if (matches([255, 216, 255])) return ['jpg', 'image/jpeg'];
  if (matches([137, 80, 78, 71, 13, 10, 26, 10])) return ['png', 'image/png'];
  if (matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8)) return ['webp', 'image/webp'];
  throw new Error('Підтримуються JPG, PNG і WebP.');
}

export class PortfolioStore extends DurableObject {
  contentEpoch = 0;
  activeMutations = 0;
  exportBackup() {
    if (!this.env.BACKUP_SIGNING_KEY) throw Error('Окремий ключ підпису резервних копій не налаштований.');
    const epoch = this.contentEpoch;
    const check = () => {
      if (this.activeMutations || this.contentEpoch !== epoch) throw Error('Дані змінено під час експорту. Повторіть завантаження.');
    };
    return snapshotResponse(this.ctx.storage, this.env.BACKUP_SIGNING_KEY, tx => this.backupSeeds(tx), task => this.ctx.waitUntil(task), check);
  }

  async backupSeeds(storage){
    const seeds=[
      ...(await this.catalog(storage)).map(v=>['project:'+v.id,v]),
      ...(await this.articles(storage)).map(v=>['article:'+v.id,v]),
      ['home-hero',await this.home(storage)],['home-order',await this.homeOrder(storage)],
      ['home-social',await this.homeSocial(storage)],['home-texts',await this.homeTexts(storage)],
      ['home-contacts',await this.homeContacts(storage)],['site-tools',await this.tools(storage)],
      ['legal:terms',await this.legal('terms',storage)],['legal:privacy-policy',await this.legal('privacy-policy',storage)],
    ];
    return seeds;
  }
  async tools(storage=this.ctx.storage){return {...defaultTools(),...await storage.get('site-tools')};}

  async legal(id, storage = this.ctx.storage) {
    return await storage.get('legal:' + id) ?? originalLegal(id);
  }

  async saveLegal(id, input) {
    const bodyHtml = await sanitizeArticleHtml(input?.bodyHtml, false, 'https://archi-create.com.ua/');
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.legal(id, transaction);
      if (current.revision !== input.revision) return null;
      const saved = { revision: current.revision + 1, bodyHtml };
      await transaction.put('legal:' + id, saved);
      return saved;
    });
  }

  async home(storage = this.ctx.storage) {
    return { revision: 0, slides: defaultHeroSlides, ...defaultHeroTiming, ...await storage.get('home-hero') };
  }

  async homeOrder(storage = this.ctx.storage) {
    return { revision: 0, projects: 'ordered', articles: 'ordered',
      projectCount: defaultProjectCount, articleCount: defaultArticleCount, ...await storage.get('home-order') };
  }

  async homeSocial(storage = this.ctx.storage) {
    return await storage.get('home-social') ?? {
      revision: 0, title: 'Archi-Create — архітектура відчуттів',
      description: 'Archi-Create — архітектурна студія. Архітектура, інтер’єри та простори для життя.',
      image: 'assets/logo-original.png',
    };
  }

  async homeTexts(storage = this.ctx.storage) {
    const saved = await storage.get('home-texts');
    return saved ? { ...saved, texts: currentHomeTexts(saved.texts) } : { revision: 0, texts: originalHomeTexts() };
  }

  async homeContacts(storage = this.ctx.storage) {
    return { revision: 0, ...defaultContacts, ...await storage.get('home-contacts') };
  }

  async sitePalette(storage = this.ctx.storage) {
    return await storage.get('site-palette') ?? { revision: 0, colors: defaultPalette };
  }

  async siteTypography(storage = this.ctx.storage) {
    return await storage.get('site-typography') ?? { revision: 0, fonts: defaultFonts };
  }

  async saveSiteTypography(input) {
    const { heading, body } = input?.fonts ?? {};
    if (![heading, body].every(font => typeof font === 'string' && Object.hasOwn(siteFonts, font))) {
      throw new Error('Виберіть шрифти зі списку.');
    }
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.siteTypography(transaction);
      if (current.revision !== input.revision) return null;
      const saved = { revision: current.revision + 1, fonts: { heading, body } };
      await transaction.put('site-typography', saved);
      return saved;
    });
  }

  async saveSitePalette(input) {
    const colors = {};
    for (const key of Object.keys(defaultPalette)) {
      const value = input?.colors?.[key];
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error('Вкажіть усі кольори у форматі #RRGGBB.');
      }
      colors[key] = value.toLowerCase();
    }
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.sitePalette(transaction);
      if (current.revision !== input.revision) return null;
      const saved = { revision: current.revision + 1, colors };
      await transaction.put('site-palette', saved);
      return saved;
    });
  }

  async saveHomeContacts(input) {
    const phone = typeof input?.phone === 'string' ? input.phone.trim() : '';
    if (phone.length > 32 || !/^\+[0-9 ().-]+$/.test(phone) || !/^tel:\+[1-9]\d{6,14}$/.test(phoneHref(phone))) {
      throw new Error('Вкажіть телефон у міжнародному форматі, наприклад +380 98 437 41 97.');
    }
    const telegramAddress = typeof input?.telegram === 'string' ? input.telegram.trim() : '';
    const telegram = /^(?:(?:https?:\/\/)?t\.me\/|@)?([a-z0-9_]{1,32})\/?$/i.exec(telegramAddress)?.[1];
    if (!telegram) throw new Error('Вкажіть ім’я користувача Telegram або посилання t.me.');
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.homeContacts(transaction);
      if (current.revision !== input.revision) return null;
      const email = input.email === undefined ? current.email : typeof input.email === 'string' ? input.email.trim() : '';
      if (email.length > 254 || !/^[a-z0-9_+%'-]+(?:\.[a-z0-9_+%'-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(email)) {
        throw new Error('Вкажіть коректну адресу електронної пошти.');
      }
      const address = input.address === undefined ? current.address : typeof input.address === 'string' ? input.address.trim() : '';
      if (!address || address.length > 200) throw new Error('Вкажіть адресу (до 200 символів).');
      const partnerBot = input.partnerBot === undefined ? current.partnerBot : typeof input.partnerBot === 'string' ? input.partnerBot.trim() : '';
      if (!/^https:\/\/t\.me\/[a-z0-9_]{5,32}(?:\?start=[a-z0-9_-]{1,64})?$/i.test(partnerBot)) {
        throw new Error('Вкажіть посилання https://t.me/ім’я_бота, за потреби з ?start=параметр.');
      }
      const saved = { revision: current.revision + 1, phone, telegram, email, address, partnerBot };
      await transaction.put('home-contacts', saved);
      return saved;
    });
  }

  async saveHomeTexts(input) {
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.homeTexts(transaction);
      if (current.revision !== input?.revision) return null;
      const texts = {};
      for (const { fields } of textGroups) {
        for (const [key, label, limit, , required = true] of fields) {
          const pattern = studioNumberPatterns[key];
          const value = input.texts?.[key] ?? (pattern || Object.hasOwn(defaultSectionLabels, key) || Object.hasOwn(defaultApproachTexts, key) || Object.hasOwn(defaultContactTexts, key) ? current.texts[key] : undefined);
          if (typeof value !== 'string' || (required && !value.trim()) || value.length > limit) {
            throw new Error('Заповніть поле «' + label + '» (до ' + limit + ' символів).');
          }
          if (pattern && !new RegExp('^(?:' + pattern + ')$').test(value.trim())) {
            throw new Error('Вкажіть коректне число в полі «' + label + '».');
          }
          texts[key] = value.trim();
        }
      }
      const photo = input.texts?.studioPhoto ?? current.texts.studioPhoto;
      if (photo !== defaultStudioDetails.studioPhoto && !(typeof photo === 'string'
        && heroUploadPath.test('/' + photo) && await transaction.get('photo:/' + photo))) {
        throw new Error('Фото студії не знайдено. Завантажте його ще раз.');
      }
      const symbol = input.texts?.contactSymbol ?? current.texts.contactSymbol;
      if (!contactSymbols.includes(symbol)) throw new Error('Виберіть символ зі списку.');
      texts.contactSymbol = symbol;
      texts.studioPhoto = photo;
      const saved = { revision: current.revision + 1, texts };
      await transaction.put('home-texts', saved);
      return saved;
    });
  }

  async saveHomeSocial(input) {
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    const image = input?.image;
    if (!title || title.length > 100 || !description || description.length > 200) {
      throw new Error('Вкажіть назву до 100 символів та опис до 200 символів.');
    }
    if (image !== 'assets/logo-original.png' && !(typeof image === 'string'
      && heroUploadPath.test('/' + image) && await this.ctx.storage.get('photo:/' + image))) {
      throw new Error('Зображення для поширення не знайдено.');
    }
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.homeSocial(transaction);
      if (current.revision !== input.revision) return null;
      const saved = { revision: current.revision + 1, title, description, image };
      await transaction.put('home-social', saved);
      return saved;
    });
  }

  async saveHomeOrder(input) {
    if (!['ordered', 'random'].includes(input?.projects) || !['ordered', 'random'].includes(input?.articles)) {
      throw new Error('Виберіть порядок показу для проєктів і статей.');
    }
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.homeOrder(transaction);
      if (current.revision !== input.revision) return null;
      const projectCount = input.projectCount === undefined ? current.projectCount : input.projectCount;
      const articleCount = input.articleCount === undefined ? current.articleCount : input.articleCount;
      if (![projectCount, articleCount].every(count => Number.isInteger(count) && count >= 1 && count <= maxHomeCount)) {
        throw new Error('Вкажіть цілу кількість від 1 до ' + maxHomeCount + ' для кожного блоку.');
      }
      const saved = { revision: current.revision + 1, projects: input.projects, articles: input.articles, projectCount, articleCount };
      await transaction.put('home-order', saved);
      return saved;
    });
  }

  async saveHome(input) {
    if (!Array.isArray(input?.slides) || !input.slides.length || input.slides.length > 8) {
      throw new Error('Додайте від 1 до 8 фото шапки.');
    }
    const slides = input.slides.map(slide => {
      const title = typeof slide?.title === 'string' ? slide.title.trim() : '';
      const accent = typeof slide?.accent === 'string' ? slide.accent.trim() : '';
      const image = slide?.image;
      const captionPosition = slide?.captionPosition ?? defaultHeroCaptionPosition;
      if (!title || title.length > 100 || title.split(/\r?\n/).length > 2 || accent.length > 40 || /[\r\n]/.test(accent)) {
        throw new Error('Вкажіть заголовок до 100 символів у двох рядках та акцент до 40 символів.');
      }
      if (typeof image !== 'string' || (!defaultHeroSlides.some(item => item.image === image) && !heroUploadPath.test('/' + image))) {
        throw new Error('Виберіть фото для шапки.');
      }
      if (typeof captionPosition !== 'string' || !Object.hasOwn(heroCaptionPositions, captionPosition)) {
        throw new Error('Виберіть кут для розміщення тексту.');
      }
      return { image, title, accent, captionPosition };
    });
    const uploads = [...new Set(slides.map(slide => slide.image).filter(image => heroUploadPath.test('/' + image)))];
    if (uploads.length) {
      const files = await this.ctx.storage.get(uploads.map(image => 'photo:/' + image));
      if (uploads.some(image => !files.has('photo:/' + image))) throw new Error('Фото шапки не знайдено.');
    }
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.home(transaction);
      if (current.revision !== input.revision) return null;
      const transition = input.transition === undefined ? current.transition : input.transition;
      const intervalSeconds = input.intervalSeconds === undefined ? current.intervalSeconds : input.intervalSeconds;
      if (typeof transition !== 'string' || !Object.hasOwn(heroTransitions, transition)) throw new Error('Виберіть ефект переходу зі списку.');
      if (!isHeroInterval(intervalSeconds)) throw new Error('Вкажіть час від 2 до 60 секунд із кроком 0,5.');
      const saved = { revision: current.revision + 1, slides, transition, intervalSeconds };
      await transaction.put('home-hero', saved);
      return saved;
    });
  }

  async orderProjects(items, storage = this.ctx.storage) {
    const order = await storage.get('portfolio-order');
    const positions = new Map((order?.ids ?? []).map((id, index) => [id, index]));
    return [...items].sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size));
  }

  async projectOrder(storage = this.ctx.storage) {
    const items = await this.withDrafts('project', await this.catalog(storage), storage);
    const order = await storage.get('portfolio-order');
    return { revision: order?.revision ?? 0, items: items.filter(item => !item.trashed) };
  }

  async saveProjectOrder(input) {
    if (!Array.isArray(input?.ids) || input.ids.some(id => typeof id !== 'string')
        || new Set(input.ids).size !== input.ids.length) throw new Error('Некоректний порядок проєктів.');
    return this.ctx.storage.transaction(async transaction => {
      const current = await this.projectOrder(transaction);
      const ids = new Set(current.items.map(item => item.id));
      if (input.revision !== current.revision || input.ids.length !== ids.size || input.ids.some(id => !ids.has(id))) return null;
      const previous = await transaction.get('portfolio-order');
      const archived = (previous?.ids ?? []).filter(id => !ids.has(id));
      const order = { revision: current.revision + 1, ids: [...input.ids, ...archived] };
      await transaction.put('portfolio-order', order);
      return { revision: order.revision, items: await this.orderProjects(current.items, transaction) };
    });
  }

  async withDrafts(kind, published, storage = this.ctx.storage) {
    const drafts = await storage.list({ prefix: 'draft:' + kind + ':' });
    const items = new Map(published.map(item => [item.id, { ...item, published: true, hasDraft: false }]));
    for (const draft of drafts.values()) {
      const existing = items.get(draft.id);
      items.set(draft.id, { ...existing, ...draft, published: !!existing, hasDraft: true });
    }
    const states = await storage.list({ prefix: 'state:' + kind + ':' });
    const result = [...items.values()].map(item => {
      const state = states.get('state:' + kind + ':' + item.id) ?? {};
      return { ...item, hidden: !!state.hidden, trashed: !!state.trashed,
        revision: Math.max(item.revision ?? 0, state.revision ?? 0) };
    });
    return kind === 'project' ? this.orderProjects(result, storage) : result;
  }

  async visible(kind, items) {
    const states = await this.ctx.storage.list({ prefix: 'state:' + kind + ':' });
    return items.filter(item => {
      const state = states.get('state:' + kind + ':' + item.id);
      return !state?.hidden && !state?.trashed;
    });
  }

  async changeState(kind, input) {
    return this.ctx.storage.transaction(async transaction => {
      const published = kind === 'article' ? await this.articles(transaction) : await this.catalog(transaction);
      const items = await this.withDrafts(kind, published, transaction);
      const item = items.find(item => item.id === input.id);
      if (!item) throw new Error('Матеріал не знайдено.');
      if (input.revision !== item.revision) return null;
      const { action } = input;
      if (item.trashed && action !== 'restore') throw new Error('Спочатку відновіть матеріал із кошика.');
      if (action === 'restore' && !item.trashed) throw new Error('Матеріал уже відновлено.');
      if (action === 'show' && !item.published) throw new Error('Спочатку опублікуйте чернетку.');
      const state = { revision: item.revision + 1,
        hidden: action !== 'show', trashed: action === 'trash' };
      await transaction.put('state:' + kind + ':' + item.id, state);
      return { ...item, ...state };
    });
  }

  async articles(storage = this.ctx.storage) {
    const changes = await storage.list({ prefix: 'article:' });
    const articles = new Map(originalArticles.map(article => [article.id, article]));
    for (const change of changes.values()) articles.set(change.id, { ...articles.get(change.id), ...change, changed: true });
    return [...articles.values()].map(article => ({ revision: 0, ...article })).sort((a, b) => b.date.localeCompare(a.date));
  }

  async migrateArticleSlugs() {
    if (await this.ctx.storage.get('article-slugs-v1')) return;
    await this.ctx.storage.transaction(async transaction => {
      if (await transaction.get('article-slugs-v1')) return;
      const articles = await this.articles(transaction);
      const drafts = await transaction.list({ prefix: 'draft:article:' });
      const routes = await transaction.list({ prefix: 'article-route:' });
      const occupied = new Set([
        ...articles.map(article => article.id),
        ...articles.map(article => article.slug).filter(Boolean),
        ...[...drafts.values()].map(article => article.slug).filter(Boolean),
        ...[...routes.keys()].map(key => key.slice('article-route:'.length)),
      ]);
      const published = new Map();
      for (const article of [...articles].sort((a, b) => a.id.localeCompare(b.id))) {
        if (article.slug) { published.set(article.id, article); continue; }
        const slug = uniqueArticleSlug(article.title, occupied);
        occupied.add(slug);
        const key = 'article:' + article.id;
        const existing = await transaction.get(key) ?? {};
        const state = await transaction.get('state:article:' + article.id);
        const revision = Math.max(article.revision ?? 0, state?.revision ?? 0) + 1;
        await transaction.put(key, { ...existing, id: article.id, slug, slugAutomatic: true, revision });
        await transaction.put('article-route:' + slug, article.id);
        published.set(article.id, { ...article, slug, slugAutomatic: true });
      }
      for (const [key, draft] of drafts) {
        if (draft.slug) continue;
        const article = published.get(draft.id);
        const slug = article?.slug || uniqueArticleSlug(draft.title, occupied);
        occupied.add(slug);
        const state = await transaction.get('state:article:' + draft.id);
        await transaction.put(key, { ...draft, slug, slugAutomatic: article?.slugAutomatic ?? true,
          revision: Math.max(draft.revision ?? 0, state?.revision ?? 0) + 1 });
      }
      await transaction.put('article-slugs-v1', true);
    });
  }

  async saveArticle(input) {
    const slugInput = typeof input?.slug === 'string' ? input.slug.trim().toLowerCase() : undefined;
    if (slugInput && (slugInput.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugInput))) {
      throw new Error('Адреса має містити латинські літери, цифри та дефіси, до 100 символів.');
    }
    if (!['draft', 'publish'].includes(input?.action)) throw new Error('Оновіть адмінпанель і виберіть «Зберегти чернетку» або «Опублікувати».');
    const publishing = input.action === 'publish';
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    const excerpt = typeof input?.excerpt === 'string' ? input.excerpt.trim() : '';
    const date = typeof input?.date === 'string' ? input.date : '';
    const cover = typeof input?.cover === 'string' ? input.cover : '';
    const text = typeof input?.text === 'string' ? input.text.trim() : undefined;
    const bodyHtml = input?.bodyHtml === undefined ? undefined : await sanitizeArticleHtml(input.bodyHtml, !publishing);
    const parsed = new Date(date);
    if ((publishing && !title) || title.length > 180 || excerpt.length > 450 || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error('Вкажіть назву, дату та анонс до 450 символів.');
    }
    if (text !== undefined && (!text || text.length > 20000)) throw new Error('Текст має містити від 1 до 20 000 символів.');
    if (cover && !originalArticles.some(article => article.cover === cover)
        && !(uploadPath.test('/' + cover) && await this.ctx.storage.get('photo:/' + cover))) {
      throw new Error('Обкладинку не знайдено.');
    }
    return this.ctx.storage.transaction(async transaction => {
      const original = originalArticles.find(article => article.id === input.id);
      const published = input.id ? await transaction.get('article:' + input.id) : undefined;
      const pending = input.id ? await transaction.get('draft:article:' + input.id) : undefined;
      const stored = pending ?? published;
      const state = input.id ? await transaction.get('state:article:' + input.id) : undefined;
      if (input.id && !original && !stored) throw new Error('Статтю не знайдено.');
      const revision = Math.max(stored?.revision ?? 0, state?.revision ?? 0);
      if (input.id && input.revision !== revision) return null;
      if (state?.trashed) throw new Error('Спочатку відновіть статтю із кошика.');
      const articleText = text ?? stored?.text;
      const articleHtml = bodyHtml ?? stored?.bodyHtml;
      if (bodyHtml === undefined && text !== undefined && (stored?.bodyHtml || original?.legacyBody)) {
        throw new Error('Оновіть адмінпанель, щоб редагувати статтю зі збереженням оформлення. Спочатку скопіюйте свої правки.');
      }
      if (publishing && !original && !articleText && !articleHtml) throw new Error('Додайте текст статті.');
      const id = input.id || 'article-' + crypto.randomUUID();
      const articles = await this.withDrafts('article', await this.articles(transaction), transaction);
      const automatic = input.slugAutomatic === true || !slugInput && !stored?.slug;
      const routes = await transaction.list({ prefix: 'article-route:' });
      const occupied = new Set([
        ...articles.filter(item => item.id !== id).flatMap(item => [item.id, item.slug].filter(Boolean)),
        ...[...routes].filter(([, owner]) => owner !== id).map(([key]) => key.slice('article-route:'.length)),
      ]);
      const slug = automatic ? uniqueArticleSlug(title, occupied) : slugInput || stored?.slug || original?.slug || '';
      const owner = slug ? await transaction.get('article-route:' + slug) : undefined;
      if (slug && (owner && owner !== id || articles.some(item => item.id !== id && (item.slug === slug || item.id === slug)))) {
        throw new Error('Цю адресу вже займає інша стаття. Виберіть іншу.');
      }
      const article = { id, slug, slugAutomatic: automatic, revision: revision + 1, title, excerpt, date, cover,
        ...(articleHtml === undefined ? (articleText === undefined ? {} : { text: articleText }) : { bodyHtml: articleHtml }) };
      await transaction.put((publishing ? 'article:' : 'draft:article:') + id, article);
      if (publishing) await transaction.delete('draft:article:' + id);
      if (publishing && slug) await transaction.put('article-route:' + slug, id);
      if (publishing && published?.slug) await transaction.put('article-route:' + published.slug, id);
      if (publishing) await transaction.put('state:article:' + id, { hidden: false, trashed: false, revision: article.revision });
      return { ...original, ...article, hidden: publishing ? false : !!state?.hidden, trashed: false,
        published: publishing || !!original || !!published, hasDraft: !publishing };
    });
  }

  async catalog(storage = this.ctx.storage) {
    const changes = await storage.list({ prefix: 'project:' });
    const existing = initialProjects.map(project => changes.get('project:' + project.id) ?? project);
    const originalIds = new Set(initialProjects.map(project => project.id));
    const added = [...changes.values()].filter(project => !originalIds.has(project.id));
    return this.orderProjects([...added.sort((a, b) => Number(b.number) - Number(a.number)), ...existing]
      .map(project => projectDetails({ revision: 0, ...project })), storage);
  }

  async save(input) {
    if (!['draft', 'publish'].includes(input?.action)) throw new Error('Оновіть адмінпанель і виберіть «Зберегти чернетку» або «Опублікувати».');
    const publishing = input.action === 'publish';
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    const label = typeof input?.label === 'string' ? input.label.trim() : '';
    const slugInput = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : undefined;
    if (slugInput && (slugInput.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugInput))) {
      throw new Error('Адреса має містити латинські літери, цифри та дефіси, до 100 символів.');
    }
    const descriptionInput = typeof input.description === 'string' ? input.description.trim() : undefined;
    if (descriptionInput?.length > 450) throw new Error('Опис має містити до 450 символів.');
    if ((publishing && (!title || !label)) || title.length > 150 || label.length > 100 || !Object.hasOwn((await this.tools()).categories, input.category)) {
      throw new Error('Заповніть назву, тип і категорію.');
    }
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (url && (url.length > 2048 || URL.parse(url)?.protocol !== 'https:')) throw new Error('Вкажіть коректне HTTPS-посилання.');
    if (!Array.isArray(input.images) || (publishing && !input.images.length) || input.images.length > 40) {
      throw new Error('Додайте від 1 до 40 фото галереї.');
    }
    const originals = new Set(initialProjects.flatMap(project => [project.cover, ...project.images]));
    const cover = input.cover || input.images[0] || '';
    const images = [...new Set([...(cover ? [cover] : []), ...input.images])];
    const uploaded = images.filter(path => typeof path === 'string' && uploadPath.test('/' + path));
    const stored = uploaded.length ? await this.ctx.storage.get(uploaded.map(path => 'photo:/' + path)) : new Map();
    if (images.some(path => typeof path !== 'string' || !photoPath.test(path) || (!originals.has(path) && !stored.has('photo:/' + path)))) {
      throw new Error('Одне із зображень не знайдено.');
    }
    return this.ctx.storage.transaction(async transaction => {
      const publishedCatalog = await this.catalog(transaction);
      const catalog = await this.withDrafts('project', publishedCatalog, transaction);
      const existing = catalog.find(project => project.id === input.id);
      if (input.id && !existing) throw new Error('Проєкт не знайдено.');
      if (existing && input.revision !== existing.revision) return null;
      if (existing?.trashed) throw new Error('Спочатку відновіть проєкт із кошика.');
      const id = existing?.id ?? crypto.randomUUID();
      const slug = slugInput || existing?.slug || 'project-' + id;
      if (publishing) {
        const owner = await transaction.get('project-route:' + slug);
        if ((owner && owner !== id) || publishedCatalog.some(project => project.slug === slug && project.id !== id)) {
          throw new Error('Ця адреса вже використовується іншим проєктом або його перенаправленням. Виберіть іншу.');
        }
        const previous = publishedCatalog.find(project => project.id === id);
        if (previous) await transaction.put('project-route:' + previous.slug, id);
        await transaction.put('project-route:' + slug, id);
      }
      const number = existing?.number ?? String(Math.max(0, ...catalog.map(project => Number(project.number))) + 1).padStart(2, '0');
      const revision = (existing?.revision ?? 0) + 1;
      const project = { id, number, revision, title, label, category: input.category, url, cover, images: input.images,
        slug, description: descriptionInput ?? existing?.description ?? '' };
      await transaction.put((publishing ? 'project:' : 'draft:project:') + id, project);
      if (publishing) await transaction.delete('draft:project:' + id);
      if (publishing) await transaction.put('state:project:' + id, { hidden: false, trashed: false, revision });
      return { ...project, hidden: publishing ? false : !!existing?.hidden, trashed: false,
        published: publishing || !!existing?.published, hasDraft: !publishing };
    });
  }

  async fetch(request) {
    const mutating = request.method === 'POST';
    if (mutating) { this.contentEpoch++; this.activeMutations++; }
    try { return await this.handleRequest(request); }
    finally { if (mutating) { this.contentEpoch++; this.activeMutations--; } }
  }

  async handleRequest(request) {
    const { pathname, searchParams } = new URL(request.url);
    await this.migrateArticleSlugs();
    if(pathname==='/internal/backup-export') return this.exportBackup();
    if(pathname==='/api/admin/home/backup'){
      try{
        if(request.method==='GET')return this.exportBackup();
        if(request.method==='POST'){
          if (searchParams.has('restore')) {
            const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 8 * 1024 * 1024)));
            return json(await importBatch(this.ctx.storage, this.env.BACKUP_SIGNING_KEY, searchParams.get('restore'), input, this.env.LEGACY_BACKUP_SIGNING_KEY ?? this.env.ADMIN_PASSWORD));
          }
          const input=JSON.parse(new TextDecoder().decode(await limitedBody(request,20*1024*1024)));
          if(input.confirm!=='RESTORE')return fail('Підтвердьте відновлення.');
          return json(await restore(this.ctx.storage,this.env.BACKUP_SIGNING_KEY,input.backup,this.env.LEGACY_BACKUP_SIGNING_KEY ?? this.env.ADMIN_PASSWORD));
        }
      }catch(error){return fail(error.message);}
    }
    if(pathname==='/api/admin/home/tools'){
      if(request.method==='GET')return json(await this.tools());
      if(request.method==='POST'){
        try {
          const input=JSON.parse(new TextDecoder().decode(await limitedBody(request,16384)));
          const saved=await this.ctx.storage.transaction(async tx=>{
            const value=validateTools(input,await this.tools(tx));
            if(value)await tx.put('site-tools',value);return value;
          });return saved?json(saved):fail('Версія застаріла. Оновіть сторінку.',409);
        }catch(error){return fail(error.message);}
      }
    }
    const legalId = /^\/(?:api\/admin|internal)\/legal\/(terms|privacy-policy)$/.exec(pathname)?.[1];
    if (request.method === 'GET' && legalId) return json(await this.legal(legalId));
    if (request.method === 'GET' && pathname === '/api/admin/home') return json(await this.home());
    if (request.method === 'GET' && pathname === '/api/admin/home/order') return json(await this.homeOrder());
    if (request.method === 'GET' && pathname === '/api/admin/home/social') return json(await this.homeSocial());
    if (request.method === 'GET' && pathname === '/api/admin/home/texts') return json(await this.homeTexts());
    if (request.method === 'GET' && pathname === '/api/admin/home/contacts') return json(await this.homeContacts());
    if (request.method === 'GET' && pathname === '/api/admin/home/palette') return json(await this.sitePalette());
    if (request.method === 'GET' && pathname === '/api/admin/home/typography') return json(await this.siteTypography());
    if (request.method === 'GET' && pathname === '/site-palette.css') {
      const [{ colors }, { fonts }] = await Promise.all([this.sitePalette(), this.siteTypography()]);
      return new Response(paletteCss(colors) + typographyCss(fonts), { headers: {
        'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (request.method === 'GET' && pathname === '/internal/home') {
      const [hero, order, social, copy, { phone, telegram, email, address, partnerBot }] = await Promise.all([
        this.home(), this.homeOrder(), this.homeSocial(), this.homeTexts(), this.homeContacts(),
      ]);
      return json({ slides: hero.slides, timing: { transition: hero.transition, intervalSeconds: hero.intervalSeconds },
        tools: await this.tools(), order, social, copy, contacts: { phone, telegram, email, address, partnerBot } });
    }
    if (request.method === 'GET' && pathname === '/internal/project-route') {
      const slug = searchParams.get('slug');
      const visible = await this.visible('project', await this.catalog());
      const id = await this.ctx.storage.get('project-route:' + slug);
      return json(visible.find(project => project.slug === slug || project.id === id) ?? null);
    }
    if (request.method === 'GET' && pathname === '/internal/article-route') {
      const slug = searchParams.get('slug');
      const visible = await this.visible('article', await this.articles());
      const id = await this.ctx.storage.get('article-route:' + slug);
      return json(visible.find(article => article.slug === slug || article.id === slug || article.id === id) ?? null);
    }
    if (request.method === 'GET' && pathname === '/api/admin/projects/order') return json(await this.projectOrder());
    if (request.method === 'GET' && pathname === '/api/admin/articles') return json(await this.withDrafts('article', await this.articles()));
    if (request.method === 'GET' && pathname === '/api/admin/articles/links') {
      const articles = await this.visible('article', await this.articles());
      const routes = await this.ctx.storage.list({ prefix: 'article-route:' });
      return json(articles.map(article => ({
        id: article.id, title: article.title, excerpt: article.excerpt || '', slug: article.slug,
        paths: [
          '/blog/' + article.id + '.html',
          ...[...routes].filter(([, owner]) => owner === article.id).flatMap(([key]) => {
            const slug = key.slice('article-route:'.length);
            return ['/blog/' + slug + '/', '/blog/' + slug + '.html'];
          }),
          ...[...articleRedirects].filter(([, target]) => target === '/blog/' + article.id + '.html').map(([path]) => path),
        ],
      })));
    }
    if (request.method === 'GET' && pathname === '/internal/articles') return json(await this.visible('article', await this.articles()));
    if (request.method === 'GET' && pathname === '/api/admin/projects') return json(await this.withDrafts('project', await this.catalog()));
    if (request.method === 'GET' && (uploadPath.test(pathname) || heroUploadPath.test(pathname))) {
      const key = 'photo:' + pathname;
      const photo = await this.ctx.storage.get(key);
      if (!photo) return new Response('Not found', { status: 404 });
      const chunks = await this.ctx.storage.list({ prefix: key + ':' });
      return new Response(new Blob([...chunks.values()]), { headers: {
        'Content-Type': photo.type, 'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (request.method === 'GET') return json(await this.visible('project', await this.catalog()));
    try {
      if (legalId) {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 128 * 1024)));
        const saved = await this.saveLegal(legalId, input);
        return saved ? json(saved) : fail('Текст уже змінено в іншій вкладці. Скопіюйте свої правки та завантажте актуальну версію.', 409);
      }
      if (pathname === '/api/admin/home') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 16384)));
        const saved = await this.saveHome(input);
        return saved ? json(saved) : fail('Шапку вже змінено в іншій вкладці. Скопіюйте свої правки та завантажте актуальну версію.', 409);
      }
      if (pathname === '/api/admin/home/order') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 1024)));
        const saved = await this.saveHomeOrder(input);
        return saved ? json(saved) : fail('Порядок показу вже змінено в іншій вкладці. Завантажте актуальні налаштування.', 409);
      }
      if (pathname === '/api/admin/home/social') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 4096)));
        const saved = await this.saveHomeSocial(input);
        return saved ? json(saved) : fail('Картку вже змінено в іншій вкладці. Завантажте актуальні налаштування.', 409);
      }
      if (pathname === '/api/admin/home/texts') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 16384)));
        const saved = await this.saveHomeTexts(input);
        return saved ? json(saved) : fail('Тексти вже змінено в іншій вкладці. Завантажте актуальні налаштування.', 409);
      }
      if (pathname === '/api/admin/home/contacts') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 1024)));
        const saved = await this.saveHomeContacts(input);
        return saved ? json(saved) : fail('Контакти вже змінено в іншій вкладці. Завантажте актуальні контакти.', 409);
      }
      if (pathname === '/api/admin/home/palette') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 1024)));
        const saved = await this.saveSitePalette(input);
        return saved ? json(saved) : fail('Палітру вже змінено в іншій вкладці. Завантажте актуальні кольори.', 409);
      }
      if (pathname === '/api/admin/home/typography') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 1024)));
        const saved = await this.saveSiteTypography(input);
        return saved ? json(saved) : fail('Шрифти вже змінено в іншій вкладці. Завантажте актуальні налаштування.', 409);
      }
      if (pathname === '/api/admin/projects/order') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 65536)));
        const saved = await this.saveProjectOrder(input);
        return saved ? json(saved) : fail('Порядок або склад проєктів уже змінився. Завантажте актуальний список і повторіть перестановку.', 409);
      }
      if (pathname === '/api/admin/articles/state' || pathname === '/api/admin/projects/state') {
        const input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 4096)));
        if (!['hide', 'show', 'trash', 'restore'].includes(input?.action)) throw new Error('Невідома дія.');
        const kind = pathname.includes('/articles/') ? 'article' : 'project';
        const saved = await this.changeState(kind, input);
        return saved ? json(saved) : fail('Матеріал уже змінився. Завантажте актуальну версію перед повторною дією.', 409);
      }
      if (pathname === '/api/admin/articles') {
        const saved = await this.saveArticle(JSON.parse(new TextDecoder().decode(await limitedBody(request, 128 * 1024))));
        return saved ? json(saved) : fail('Версія статті застаріла. Ваші правки залишаються у формі. Скопіюйте потрібні зміни перед завантаженням актуальної версії.', 409);
      }
      if (pathname === '/api/admin/projects') {
        const saved = await this.save(JSON.parse(new TextDecoder().decode(await limitedBody(request, 65536))));
        return saved ? json(saved) : fail('Проєкт уже змінився або вкладку відкрито до оновлення адмінпанелі. Скопіюйте потрібні правки й завантажте актуальну версію.', 409);
      }
      const bytes = await limitedBody(request, 8 * 1024 * 1024);
      const [extension, type] = imageFormat(bytes);
      const folder = pathname === '/api/admin/home/upload' ? 'assets/hero/cloud/' : 'assets/projects/cloud/';
      const image = folder + crypto.randomUUID() + '.' + extension;
      const key = 'photo:/' + image;
      const entries = { [key]: { type } };
      const chunkSize = 96 * 1024;
      for (let start = 0, index = 0; start < bytes.length; start += chunkSize, index++) {
        entries[key + ':' + String(index).padStart(3, '0')] = bytes.slice(start, start + chunkSize);
      }
      await this.ctx.storage.put(entries);
      return json({ image }, 201);
    } catch (error) {
      return fail(error instanceof SyntaxError ? 'Некоректний запит.' : error.message);
    }
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const store = env.PORTFOLIO.get(env.PORTFOLIO.idFromName('archi-create'));
    const date = new Date(controller.scheduledTime);
    if (date.getUTCDate() === 1 && date.getUTCHours() === 0 && date.getUTCMinutes() === 0) {
      ctx.waitUntil(env.DRIVE_BACKUP.get(env.DRIVE_BACKUP.idFromName('archi-create')).fetch('https://internal/tick', {method: 'POST'}).then(async response => {
        if (!response.ok) console.error(JSON.stringify({event: 'drive_backup_schedule_failed', status: response.status}));
      }));
    }
    ctx.waitUntil(tick(env, async () => {
      const response = await store.fetch('https://archi-create.com.ua/api/projects');
      if (!response.ok) throw new Error('Project catalog unavailable');
      return response.json();
    }, Date.now(), fetch, controller.scheduledTime).then(result => console.log(JSON.stringify({ event: 'social_tick', ...result }))));
  },
  async fetch(request, env, ctx) {
    const response = await this.handle(request, env, ctx);
    let output=response;
    if(request.method==='GET'&&!new URL(request.url).pathname.startsWith('/admin')&&response.headers.get('Content-Type')?.includes('text/html')){
      const store=env.PORTFOLIO.get(env.PORTFOLIO.idFromName('archi-create'));
      const settings=await (await store.fetch('https://internal/api/admin/home/tools')).json();
      if(settings.analyticsToken) output=new HTMLRewriter().on('head',{element(el){el.append(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({token:settings.analyticsToken})}'></script>`,{html:true});}}).transform(response);
    }
    const secured = new Response(request.method === 'HEAD' ? null : output.body, output);
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('X-Frame-Options', 'SAMEORIGIN');
    secured.headers.set('Content-Security-Policy', "script-src 'self' https://static.cloudflareinsights.com; frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
    return secured;
  },
  async handle(request, env, ctx) {
    if (request.method === 'HEAD') {
      const response = await this.handle(new Request(request, { method: 'GET' }), env, ctx);
      return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    const url = new URL(request.url);
    if (url.pathname === '/api/backup/google/callback') {
      return env.DRIVE_BACKUP.get(env.DRIVE_BACKUP.idFromName('archi-create')).fetch(new Request('https://internal/callback' + url.search));
    }
    let path = url.pathname;
    let decodedPath = path;
    try { decodedPath = decodeURIComponent(path); }
    catch { /* Malformed URL encoding cannot match an imported article address. */ }
    path = decodedPath;
    const articleTarget = articleRedirects.get(decodedPath.replace(/\/$/, ''));
    if (articleTarget) return Response.redirect('https://archi-create.com.ua' + articleTarget + url.search, 301);
    const legacyPages = {
      '/blog-black/': '/blog.html',
      '/index.html/': '/',
      '/home-black/terms/': '/terms.html',
      '/terms/': '/terms.html',
      '/privacy_policy/': '/privacy-policy.html',
    };
    const legacyTarget = legacyPages[path.endsWith('/') ? path : path + '/'];
    if (legacyTarget) return Response.redirect('https://archi-create.com.ua' + legacyTarget + url.search, 301);
    const alias = ['www.archi-create.com.ua', 'archi-create.nazarium.workers.dev'].includes(url.hostname);
    if (alias || (url.hostname === 'archi-create.com.ua' && url.protocol === 'http:')) {
      url.hostname = 'archi-create.com.ua';
      url.protocol = 'https:';
      return Response.redirect(url.href, 308);
    }
    if (path === '/api/contact') return submitContact(request, env, limitedBody);
    const store = () => env.PORTFOLIO.get(env.PORTFOLIO.idFromName('archi-create'));
    if (path === '/site-palette.css' && request.method === 'GET') return store().fetch(new URL('/site-palette.css', url));
    const projectMatch = /^\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path);
    if (projectMatch && request.method === 'GET') {
      const lookup = new URL('/internal/project-route', url);
      lookup.searchParams.set('slug', projectMatch[1]);
      const project = await (await store().fetch(lookup)).json();
      if (!project) return notFound(request);
      if (url.pathname !== projectPath(project)) return new Response(null, { status: 301, headers: {
        Location: new URL(projectPath(project) + url.search, url).href, 'Cache-Control': 'no-store',
      } });
      return renderProject(request, env, project);
    }
    if (path === '/sitemap.xml' && request.method === 'GET') {
      const articles = await (await store().fetch(new URL('/internal/articles', url))).json();
      const projects = await (await store().fetch(new URL('/api/projects', url))).json();
      const paths = ['/', '/blog.html', '/terms.html', '/privacy-policy.html',
        ...articles.map(articlePath), ...projects.map(projectPath)];
      const entries = [...new Set(paths)].map(path =>
        '  <url><loc>https://archi-create.com.ua' + path + '</loc></url>');
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + entries.join('\n') + '\n</urlset>\n';
      return new Response(xml, { headers: {
        'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store',
      } });
    }
    if (path === '/robots.txt' && request.method === 'GET') {
      const robots = 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n'
        + '\nSitemap: https://archi-create.com.ua/sitemap.xml\n';
      return new Response(robots, { headers: {
        'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      } });
    }
    if (path === '/admin' || path === '/admin/' || path === '/admin/preview' || path === '/admin.js' || path === '/admin.css' || path.startsWith('/api/admin/')) {
      if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 24) return fail('Вхід адміністратора ще не налаштовано.', 503);
      if (!await allowed(request, env.ADMIN_PASSWORD)) return new Response('Вхід до Archi-Create', {
        status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Archi-Create"', 'Cache-Control': 'no-store' },
      });
      if (path === '/admin/preview') {
        if (request.method !== 'GET') return fail('Запит відхилено.', 405);
        const kind = url.searchParams.get('kind');
        if (!['articles', 'projects'].includes(kind)) return notFound(request);
        const items = await (await store().fetch(new URL('/api/admin/' + kind, url))).json();
        const item = items.find(item => item.id === url.searchParams.get('id'));
        if (!item) return notFound(request);
        return renderPreview(request, env, kind, item);
      }
      if (path.startsWith('/api/admin/home/drive-backup/')) {
        if (request.method !== 'GET' && (request.method !== 'POST' || request.headers.get('Origin') !== url.origin)) return fail('Запит відхилено.', 403);
        if (!['status','connect','disconnect','settings','start'].includes(path.split('/').at(-1))) return fail('Запит не знайдено.', 404);
        return env.DRIVE_BACKUP.get(env.DRIVE_BACKUP.idFromName('archi-create')).fetch(request);
      }
      if (path.startsWith('/api/admin/social/')) {
        if (request.method !== 'GET' && (request.method !== 'POST' || request.headers.get('Origin') !== url.origin)) return fail('Запит відхилено.', 403);
        return socialAdmin(request, env, async () => {
          const response = await store().fetch(new URL('/api/projects', url));
          if (!response.ok) throw new Error('Project catalog unavailable');
          return response.json();
        }, ctx);
      }
      if (path.startsWith('/api/admin/')) {
        if (path === '/api/admin/articles/links' && request.method === 'GET') return store().fetch(request);
        if (path === '/api/admin/home/palette' || path === '/api/admin/home/typography') {
          if (request.method === 'GET' || (request.method === 'POST' && request.headers.get('Origin') === url.origin)) {
            return store().fetch(request);
          }
          return fail('Запит відхилено.', 403);
        }
        if (request.method === 'GET' && (adminLegalPath.test(path) || adminRoutes[path]?.includes('GET'))) return store().fetch(request);
        if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return fail('Запит відхилено.', 403);
        if (!adminLegalPath.test(path) && !adminRoutes[path]?.includes('POST')) return fail('Запит не знайдено.', 404);
        return store().fetch(request);
      }
      const [body, type] = path === '/admin.js' ? [admin.script, 'text/javascript']
        : path === '/admin.css' ? [admin.style, 'text/css'] : [admin.html.replace('<head>', '<head>' + marker), 'text/html'];
      return new Response(body, { headers: { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    if (request.method === 'GET' && (path === '/api/projects' || uploadPath.test(path) || heroUploadPath.test(path))) return store().fetch(request);
    const match = articleRoute.exec(path);
    if (request.method === 'GET' && (path === '/' || path === '/index.html' || path === '/blog.html' || match)) {
      const articles = await (await store().fetch(new URL('/internal/articles', url))).json();
      let article = null;
      if (match) {
        const lookup = new URL('/internal/article-route', url);
        lookup.searchParams.set('slug', match[1]);
        article = await (await store().fetch(lookup)).json();
        if (article && url.pathname !== articlePath(article)) return new Response(null, { status: 301, headers: {
          Location: new URL(articlePath(article) + url.search, url).href, 'Cache-Control': 'no-store',
        } });
      }
      if (match && !article) return notFound(request);
      const template = match ? '/blog/' + originalArticles[0].id + '.html' : path === '/' ? '/index.html' : path;
      const response = await env.ASSETS.fetch(new Request(new URL(template, url)));
      if (!response.ok) return response;
      const rewriter = new HTMLRewriter();
      if (!match && path !== '/blog.html') rewriter.on('head', { element(head) { head.append(marker, { html: true }); } });
      if (match || path === '/blog.html') {
        const rendered = renderBlog(response, rewriter, path, articles, article);
        return rendered;
      }
      const [projects, home] = await Promise.all(['/api/projects', '/internal/home'].map(async endpoint =>
        (await store().fetch(new URL(endpoint, url))).json()));
      return renderBlog(response, rewriter, path, articles, article, projects, { ...home, contactBot: contactBotConfigured(env) });
    }
    const legalId = /^\/(terms|privacy-policy)\.html$/.exec(path)?.[1];
    if (legalId && request.method === 'GET') {
      const document = await (await store().fetch(new URL('/internal/legal/' + legalId, url))).json();
      if (!document.revision) return env.ASSETS.fetch(request);
      const template = await env.ASSETS.fetch(new URL('/' + legalId + '.html', url));
      return template.ok ? renderLegal(template, legalId, document) : template;
    }
    const assetRequest = path === '/' ? new Request(new URL('/index.html', url), request) : request;
    const response = await env.ASSETS.fetch(assetRequest);
    if (response.status === 404 && request.method === 'GET'
        && !path.startsWith('/api/') && !path.startsWith('/assets/')
        && (!/\.[^/]+$/.test(path) || /\.html?$/i.test(path) || request.headers.get('Accept')?.includes('text/html'))) {
      return notFound(request);
    }
    if (response.ok && (path === '/' || path === '/index.html')) {
      return new HTMLRewriter().on('head', { element(head) { head.append(marker, { html: true }); } }).transform(response);
    }
    return response;
  },
};
