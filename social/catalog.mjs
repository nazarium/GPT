export const ORIGIN = 'https://archi-create.com.ua';
export const PLATFORMS = ['instagram', 'facebook', 'tiktok'];
export const LIMITS = { instagram: 20, facebook: 10, tiktok: 10 };

export async function fingerprint(project) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(project)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeCatalog(items) {
  if (!Array.isArray(items) || items.length > 500) throw new Error('Invalid catalog');
  const ids = new Set();
  return items.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,100}$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid or duplicate project id');
    ids.add(item.id);
    if (item.hidden || item.trashed || item.published === false) throw new Error('Catalog must contain only visible published projects');
    if (typeof item.title !== 'string' || !item.title.trim() || !Array.isArray(item.images) || !item.images.length || item.images.length > 100) throw new Error('Incomplete project');
    const images = item.images.map(path => {
      const url = new URL(path, ORIGIN + '/');
      if (url.origin !== ORIGIN || url.username || url.password || !/^\/assets\/projects\/[\w/-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname) || url.search || url.hash) throw new Error('Invalid project photo URL');
      return url.href;
    });
    if (new Set(images).size !== images.length) throw new Error('Duplicate photo');
    const slug = item.slug || 'project-' + item.id;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid project slug');
    return { id: item.id, title: item.title, description: item.description || '', label: item.label || '',
      number: item.number || '', url: ORIGIN + '/projects/' + slug + '/', images };
  });
}

export function channels(env) {
  const values = JSON.parse(env.BUFFER_CHANNELS || '[]');
  if (!Array.isArray(values) || values.length > 3) throw new Error('Configure up to three Buffer channels');
  const seen = new Set(), ids = new Set();
  return values.map(c => {
    if (!PLATFORMS.includes(c.platform) || seen.has(c.platform) || ids.has(c.id) || typeof c.id !== 'string' || !c.id || !['automatic','notification'].includes(c.mode)) throw new Error('Invalid Buffer channel mapping');
    if (c.platform === 'tiktok' && c.mode === 'automatic' && env.TIKTOK_PHOTO_AUTO_VERIFIED !== 'true') throw new Error('TikTok automatic photo publishing needs an approved successful test');
    seen.add(c.platform); ids.add(c.id);
    return { platform: c.platform, id: c.id, mode: c.mode };
  });
}

export function selectedImageIndexes(project, selection, platform) {
  if (selection[platform] !== undefined) return selection[platform];
  const limit = platform === 'facebook' || platform === 'tiktok' ? 10 : project.images.length;
  return project.images.slice(0, limit).map((_, index) => index);
}

export function selectImages(project, selection, platform) {
  const indexes = selectedImageIndexes(project, selection, platform);
  if (!Array.isArray(indexes) || !indexes.length || indexes.some(i => !Number.isInteger(i) || i < 0 || i >= project.images.length) || new Set(indexes).size !== indexes.length) throw new Error('Invalid selected photo indexes');
  return indexes.map(i => project.images[i]);
}

export function buildPost(project, channel, selection = {}, media = []) {
  const images = selectImages(project, selection, channel.platform);
  const text = [project.title + (project.number ? ' — ' + project.number : ''), project.description, project.url].filter(Boolean).join('\n\n');
  const issues = [], warnings = [];
  if (images.length > LIMITS[channel.platform]) issues.push(`Gallery has ${images.length} photos; Buffer ${channel.platform} limit is ${LIMITS[channel.platform]}. Explicitly select photos or complete outside Buffer.`);
  const textLength = channel.platform === 'instagram' ? text.length + (text.match(/\n/g)?.length || 0) : text.length;
  if (textLength > { instagram: 2196, facebook: 5000, tiktok: 4000 }[channel.platform]) issues.push('Caption exceeds platform limit; no automatic truncation');
  const checked = images.map(url => media.find(m => m.url === url));
  if (media.length && checked.some(m => !m?.width || !m?.height || !m?.size)) issues.push('Photo dimensions or size could not be verified');
  for (const m of checked.filter(Boolean)) {
    // Conservative threshold: Buffer docs conflict on TikTok 8MB versus 20MB.
    if (m.size > 8 * 1024 * 1024) issues.push('Photo exceeds conservative 8MB limit');
    if (channel.mode === 'automatic' && channel.platform === 'instagram' && (m.width / m.height < .75 || m.width / m.height > 1.91)) issues.push('Instagram photo is outside 3:4–1.91:1; use notification/manual publishing');
  }
  if (channel.platform === 'instagram' && images.length > 1) warnings.push('Instagram crops all photos to the first photo aspect ratio. Review this before marking ready.');
  if (channel.platform === 'tiktok') warnings.push('TikTok photo automation remains unverified for this account; default is notification with manual completion.');
  const metadata = channel.platform === 'instagram' ? { instagram: { type: 'post', shouldShareToFeed: true } }
    : channel.platform === 'facebook' ? { facebook: { type: 'post' } } : { tiktok: { title: project.title } };
  return { projectId: project.id, platform: channel.platform, images, issues: [...new Set(issues)], warnings,
    input: { channelId: channel.id, text, assets: images.map(url => ({ image: { url } })), metadata,
      schedulingType: channel.mode, mode: 'customScheduled', needsApproval: false, saveToDraft: false, aiAssisted: false } };
}

export function archiveSlot(time, hour = 10, days=[2,5], timezone='Europe/Kyiv', minute=0) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Invalid archive hour');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute:'2-digit', hourCycle: 'h23' }).formatToParts(new Date(time)).map(p => [p.type,p.value]));
  return days.includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)) && Number(p.hour) === hour && Number(p.minute) === minute ? `${p.year}-${p.month}-${p.day}` : null;
}
