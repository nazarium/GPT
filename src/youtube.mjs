export function youtubeEmbedUrl(address) {
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
      const parts = url.pathname.split('/');
      id = url.pathname === '/watch' ? url.searchParams.get('v')
        : ['embed', 'shorts', 'live'].includes(parts[1]) ? parts[2] : null;
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? 'https://www.youtube-nocookie.com/embed/' + id : null;
  } catch { return null; }
}
