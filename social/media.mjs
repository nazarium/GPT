export function dimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, count) => String.fromCharCode(...bytes.subarray(at, at + count));
  if (bytes.length >= 24 && ascii(1, 3) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20), format: 'png' };
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16), format: 'webp' };
    if (kind === 'VP8 ') return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383, format: 'webp' };
    if (kind === 'VP8L') {
      const n = view.getUint32(21, true);
      return { width: 1 + (n & 16383), height: 1 + ((n >>> 14) & 16383), format: 'webp' };
    }
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = view.getUint16(offset);
      if (length < 2) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5), format: 'jpg' };
      }
      offset += length;
    }
  }
  throw new Error('Cannot verify image dimensions');
}

// Retain at most 64 KiB for dimensions. If storage omits the total size,
// count the full stream without buffering it, stopping above the 8 MiB cap.
export async function inspectImage(url, fetcher = fetch) {
  const options={redirect:'manual',signal:AbortSignal.timeout(15_000)};
  let response=await fetcher(url,{...options,headers:{Range:'bytes=0-65535'}});
  const total=r=>Number(r.headers.get('Content-Range')?.split('/')[1]
    ?? (r.status===200?r.headers.get('Content-Length'):0));
  let size=total(response);
  if(response.status===206&&!(Number.isFinite(size)&&size>0)) {
    await response.body?.cancel();
    response=await fetcher(url,{...options,signal:AbortSignal.timeout(15_000)});
    size=total(response);
    if(response.status===206&&!(Number.isFinite(size)&&size>0)) {
      await response.body?.cancel();throw new Error('Partial photo response has no total size');
    }
  }
  if(!response.ok||!/^image\/(jpeg|png|webp)(;|$)/i.test(response.headers.get('Content-Type')??'')||!response.body) {
    await response.body?.cancel();throw new Error('Photo URL does not serve an accessible image');
  }
  const knownSize=Number.isFinite(size)&&size>0;
  const reader=response.body.getReader(),parts=[];
  let length=0,totalRead=0;
  try {
    while(!knownSize||length<65536) {
      const {done,value}=await reader.read();if(done)break;
      totalRead+=value.length;
      if(length<65536) {
        const part=value.subarray(0,65536-length);
        parts.push(part);length+=part.length;
      }
      if(!knownSize&&totalRead>8*1024*1024)break;
    }
  }finally{await reader.cancel();}
  if(!knownSize)size=totalRead;
  const bytes=new Uint8Array(length);let at=0;
  for(const part of parts){bytes.set(part,at);at+=part.length;}
  return {url,...dimensions(bytes),size};
}

export async function inspectGallery(project, fetcher = fetch) {
  const result = [];
  for (const url of project.images) result.push(await inspectImage(url, fetcher));
  return result;
}

// Routed Workers cannot reliably self-fetch their public Route. Read the same
// originals through the existing bindings; Buffer still receives public URLs.
export function siteImageFetcher(env,fallback=fetch) {
  if(!env.ASSETS)return fallback;
  return async (url,init)=>{
    const parsed=new URL(url);
    if(parsed.origin!=='https://archi-create.com.ua'||parsed.search||parsed.hash||
      !/^\/assets\/projects\/[\w/-]+\.(?:jpe?g|png|webp)$/i.test(parsed.pathname))
      throw new Error('Invalid original photo URL');
    const request=new Request(url,init);
    if(/^\/assets\/projects\/cloud\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(parsed.pathname)) {
      if(!env.PORTFOLIO)throw new Error('Original photo storage is not configured');
      return env.PORTFOLIO.get(env.PORTFOLIO.idFromName('archi-create')).fetch(request);
    }
    return env.ASSETS.fetch(request);
  };
}
