import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const ORIGIN = 'http://localhost:3000';
const TOKEN_URL = 'https://oauth.deezer.com/token';
const PIPE_URL = 'https://pipe.deezer.com/api';
const COOKIE = 'unaite_sample';
const TTL = 12 * 60 * 60 * 1000;
type Json = Record<string, any>;
type Reply = {status: number; data: Json};
type Transport = (url: string, body: Json, token?: string) => Promise<Reply>;
type Session = {
  csrf: string; deadline: number; valid: boolean; generation: number;
  pending?: {state: string; verifier: string; expires: number};
  tokens?: {access: string; refresh?: string; expires: number};
  refreshing?: Promise<void>;
};
type Options = {clientId: string; appId?: string; root?: string; now?: () => number; transport?: Transport};
const random = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
class HttpError extends Error {status: number; constructor(status: number, code: string) {super(code); this.status = status;}}

// Fixed destinations only. Redirects cannot forward bearer tokens to another host.
export const requestUpstream: Transport = async (url, body, token) => {
  if (![TOKEN_URL, PIPE_URL].includes(url)) throw new Error('invalid_upstream');
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: JSON.stringify(body),
  });
  let size = 0; const chunks: Uint8Array[] = [];
  if (!response.body) throw new Error('empty_upstream');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('upstream_too_large');
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString());
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_upstream');
  return {status: response.status, data};
};

export function createApp(options: Options) {
  const sessions = new Map<string, Session>();
  const now = options.now || Date.now;
  const upstream = options.transport || requestUpstream;
  const root = options.root || fileURLToPath(new URL('../', import.meta.url));
  const sdk = join(root, 'node_modules/@deezer/sdk-player/build/umd/index.js');
  const configured = Boolean(options.clientId && !options.clientId.startsWith('YOUR_'));
  const assets: Record<string, [string, string]> = {
    '/': ['public/index.html', 'text/html; charset=utf-8'],
    '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'],
    '/sdk-player.js': ['node_modules/@deezer/sdk-player/build/umd/index.js', 'text/javascript; charset=utf-8'],
  };
  function accept(session: Session, reply: Reply) {
    const d = reply.data;
    if (reply.status !== 200 || typeof d.access_token !== 'string' || !d.access_token || !Number.isFinite(Number(d.expires_in)) || Number(d.expires_in) <= 0) {
      delete session.tokens; throw new HttpError(401, 'login_required');
    }
    session.tokens = {access: d.access_token, refresh: d.refresh_token || session.tokens?.refresh, expires: now() + Number(d.expires_in) * 1000};
  }
  async function access(session: Session, force = false) {
    if (!session.valid || session.deadline < now() || !session.tokens) throw new HttpError(401, 'login_required');
    if (force || session.tokens.expires <= now() + 30_000) {
      if (!session.refreshing) {
        const generation = session.generation;
        session.refreshing = (async () => {
          try {
            if (!session.tokens?.refresh) throw new Error('missing_refresh');
            const result = await upstream(TOKEN_URL, {grant_type: 'refresh_token', client_id: options.clientId, refresh_token: session.tokens.refresh});
            if (!session.valid || session.generation !== generation || session.deadline < now()) throw new Error('stale_session');
            accept(session, result);
          } catch {if (session.generation === generation) delete session.tokens; throw new HttpError(401, 'refresh_failed');}
        })().finally(() => {delete session.refreshing;});
      }
      await session.refreshing;
    }
    if (!session.valid || session.deadline < now() || !session.tokens) throw new HttpError(401, 'login_required');
    return session.tokens.access;
  }
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.deezer.com https://*.dzcdn.net wss://live.deezer.com; media-src blob: https://*.deezer.com https://*.dzcdn.net; worker-src blob:; form-action 'self' https://oauth.deezer.com; frame-ancestors 'none'; base-uri 'none'");
    const send = (status: number, data: unknown) => {res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data));};
    const redirect = (location: string) => {res.statusCode = 303; res.setHeader('Location', location); res.end();};
    const setCookie = (id: string, age = 43200) => res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}`);
    try {
      if (req.headers.host !== 'localhost:3000') throw new HttpError(403, 'forbidden');
      const url = new URL(req.url || '/', ORIGIN), path = url.pathname;
      for (const [id, s] of sessions) if (s.deadline < now()) {s.valid = false; sessions.delete(id);}
      const cookies = (req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(COOKIE + '='));
      let id = cookies.length === 1 ? cookies[0].slice(COOKIE.length + 1) : '';
      let session = sessions.get(id);
      if (req.method === 'GET') {
        if (path === '/api/session') {
          if (!session) {
            if (sessions.size >= 1000) throw new HttpError(503, 'session_limit');
            id = random(); session = {csrf: random(), deadline: now() + TTL, valid: true, generation: 0}; sessions.set(id, session); setCookie(id);
          }
          return send(200, {authenticated: Boolean(session.tokens), csrf: session.csrf, appId: options.appId || '', sdkAvailable: existsSync(sdk), configured, expiresAt: session.tokens?.expires || null});
        }
        if (path === '/callback') {
          res.setHeader('Referrer-Policy', 'no-referrer');
          const pending = session?.pending;
          if (!session || !pending || pending.expires < now() || url.searchParams.getAll('state').length !== 1 || !equal(url.searchParams.get('state') || '', pending.state) || url.searchParams.getAll('code').length !== 1) throw new HttpError(400, 'invalid_callback');
          const code = url.searchParams.get('code')!;
          if (!code || code.length > 4096) throw new HttpError(400, 'invalid_callback');
          const generation = session.generation;
          delete session.pending; // Consume before any asynchronous exchange.
          const reply = await upstream(TOKEN_URL, {grant_type: 'authorization_code', client_id: options.clientId, code, code_verifier: pending.verifier, redirect_uri: ORIGIN + '/callback'});
          if (!session.valid || sessions.get(id) !== session || session.generation !== generation || session.deadline < now()) throw new HttpError(400, 'invalid_callback');
          accept(session, reply);
          sessions.delete(id); id = random(); session.csrf = random(); sessions.set(id, session); setCookie(id);
          return redirect('/');
        }
        const asset = assets[path];
        if (asset && existsSync(join(root, asset[0]))) {
          res.setHeader('Content-Type', asset[1]); return res.end(readFileSync(join(root, asset[0])));
        }
        return send(404, {error: 'not_found'});
      }
      if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      if (req.headers.origin !== ORIGIN || !session) throw new HttpError(403, 'forbidden');
      if (Number(req.headers['content-length']) > 65536) throw new HttpError(413, 'body_too_large');
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) {size += chunk.length; if (size > 65536) throw new HttpError(413, 'body_too_large'); chunks.push(chunk);}
      const content = Buffer.concat(chunks).toString(); let body: Json;
      const type = req.headers['content-type'] || '';
      try {
        if (type.startsWith('application/json')) body = content ? JSON.parse(content) : {};
        else if (type.startsWith('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(content));
        else throw new HttpError(415, 'unsupported_content_type');
      } catch (e) {if (e instanceof HttpError) throw e; throw new HttpError(400, 'invalid_json');}
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_json');
      const csrf = req.headers['x-csrf-token'] || body.csrf;
      if (typeof csrf !== 'string' || !equal(csrf, session.csrf)) throw new HttpError(403, 'forbidden');
      if (path === '/login') {
        if (!configured) throw new HttpError(503, 'configure_client_id');
        const verifier = randomBytes(48).toString('base64url'), state = random();
        session.generation++; session.pending = {verifier, state, expires: now() + 600_000}; delete session.tokens;
        return redirect('https://oauth.deezer.com/authorize?' + new URLSearchParams({client_id: options.clientId, response_type: 'code', scope: 'all', redirect_uri: ORIGIN + '/callback', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'}));
      }
      if (path === '/logout') {session.valid = false; session.generation++; delete session.tokens; delete session.pending; sessions.delete(id); setCookie('', 0); return send(200, {loggedOut: true});}
      if (!['/api/token', '/api/refresh', '/api/pipe'].includes(path)) return send(404, {error: 'not_found'});
      const token = await access(session, path === '/api/refresh');
      if (path === '/api/token') return send(200, {access_token: token});
      if (path === '/api/refresh') return send(200, {refreshed: true});
      if (typeof body.query !== 'string' || !body.query.trim() || (body.variables !== undefined && (!body.variables || typeof body.variables !== 'object' || Array.isArray(body.variables)))) throw new HttpError(400, 'invalid_query');
      const reply = await upstream(PIPE_URL, {query: body.query, ...(body.variables ? {variables: body.variables} : {})}, token);
      if (reply.status !== 200) throw new HttpError(502, 'upstream_failed');
      return send(200, reply.data);
    } catch (error) {
      // Do not echo codes, tokens, upstream response bodies, or signed media URLs.
      return send(error instanceof HttpError ? error.status : 502, {error: error instanceof HttpError ? error.message : 'upstream_failed'});
    }
  };
}
