// The audio CDN does not consistently allow browser requests from localhost.
// Relay only signed files on this exact official host; never forward OAuth headers.
export function validMedia(url: unknown, range: unknown = ''): url is string {
  if (typeof url !== 'string' || url.length > 8192 || typeof range !== 'string') return false;
  if (range && !/^bytes=\d{1,12}-\d{0,12}$/.test(range)) return false;
  if (range) {const [a,b] = range.slice(6).split('-'); if (b && Number(b) < Number(a)) return false;}
  try {
    const u = new URL(url);
    return u.origin === 'https://cdnt-stream.dzcdn.net' && !u.username && !u.password && !u.hash
      && /^\/media\/[A-Za-z0-9/_-]+\.mp3$/.test(u.pathname)
      && u.searchParams.getAll('hdnea').length === 1 && Boolean(u.searchParams.get('hdnea'))
      && [...u.searchParams.keys()].every(k => k === 'hdnea');
  } catch {return false;}
}
export async function fetchMedia(url: string, range = '') {
  if (!validMedia(url, range)) throw new Error('invalid_media');
  const r = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(30_000), headers: range ? {Range: range} : {}});
  if (![200,206].includes(r.status) || !r.body) throw new Error('media_failed');
  const type = r.headers.get('content-type')?.split(';')[0] || '';
  if (!['audio/mpeg','audio/mp3','application/octet-stream'].includes(type)) throw new Error('media_failed');
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of r.body) {size += chunk.length; if (size > 32*1024*1024) throw new Error('media_too_large'); chunks.push(chunk);}
  const headers: Record<string,string> = {'content-type': type};
  const contentRange = r.headers.get('content-range');
  if (contentRange && /^bytes \d+-\d+\/\d+$/.test(contentRange)) headers['content-range'] = contentRange;
  return {status: r.status, body: Buffer.concat(chunks), headers};
}
