'use strict';
// This UI is shared by the Python and TypeScript samples.
const $ = id => document.getElementById(id);
const originalFetch = window.fetch.bind(window);
let session, player, selectedTrack, sdkLoading, preparing = false;
const messages = {
  login_required: 'Connectez-vous à Deezer pour continuer.',
  refresh_failed: 'La session a expiré. Reconnectez-vous à Deezer.',
  configure_client_id: 'Renseignez DEEZER_CLIENT_ID dans .env, puis redémarrez.',
  graphql_failed: 'La requête Pipe a été refusée. Vérifiez scope=all et les droits du compte.',
  sdk_missing: 'Installez le SDK : npm run sdk:install, puis rechargez la page.',
  app_id_missing: 'Renseignez DEEZER_APP_ID dans .env, puis redémarrez.',
  playback_failed: 'Lecture indisponible. Vérifiez Premium, les droits du titre et votre connexion.',
};
function fail(error) {
  // Upstream/SDK errors can contain credentials: only display known fixed messages.
  $('message').textContent = messages[error?.message] || 'La demande a échoué. Vérifiez votre connexion et réessayez.';
}
async function post(path, payload = {}) {
  const response = await originalFetch(path, {method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf}, body: JSON.stringify(payload)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'request_failed');
  return data;
}
async function gql(query, variables = {}) {
  const result = await post('/api/pipe', {query, variables});
  if (result.errors?.length || !result.data) throw new Error('graphql_failed');
  return result.data;
}
// The published SDK has a fixed Pipe URL. Relay only that exact endpoint.
// Signed MP3 files use a second, strictly restricted local relay.
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === 'https://pipe.deezer.com/api') {
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : '{}');
    const parsed = JSON.parse(body);
    return originalFetch('/api/pipe', {method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf}, body: JSON.stringify({query: parsed.query, variables: parsed.variables || {}})});
  }
  if (url.startsWith('https://cdnt-stream.dzcdn.net/media/')) {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : {}));
    return originalFetch('/api/media', {method: 'POST', credentials: 'same-origin',
      signal: init?.signal || (input instanceof Request ? input.signal : undefined),
      headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf},
      body: JSON.stringify({url, range: headers.get('Range') || ''})});
  }
  return originalFetch(input, init);
};
async function loadSession() {
  const response = await originalFetch('/api/session');
  if (!response.ok) throw new Error('request_failed');
  session = await response.json(); $('csrf').value = session.csrf;
  $('login').disabled = !session.configured;
  for (const id of ['refresh', 'logout', 'search']) $(id).disabled = !session.authenticated;
  $('session-status').textContent = !session.configured ? messages.configure_client_id : session.authenticated ? 'Compte connecté · prêt à explorer.' : 'Connectez votre compte Deezer pour commencer.';
  $('sdk-status').textContent = !session.sdkAvailable ? messages.sdk_missing : !session.appId ? messages.app_id_missing : 'SDK disponible · choisissez un titre pour préparer le lecteur.';
}
function loadSdk() {
  if (!session.sdkAvailable) return Promise.reject(new Error('sdk_missing'));
  if (!session.appId) return Promise.reject(new Error('app_id_missing'));
  sdkLoading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/sdk-player.js';
    script.onload = resolve; script.onerror = () => {sdkLoading = null; reject(new Error('sdk_missing'));}; document.head.append(script);
  });
  return sdkLoading;
}
async function ensurePlayer() {
  if (player) return player;
  await loadSdk();
  const permissions = await gql('query Access { permissions { access { hasLimitedPermissions } } }');
  if (permissions.permissions?.access?.hasLimitedPermissions !== false) throw new Error('playback_failed');
  const instance = new DeezerPlayer();
  instance.subscribeOnPlaybackStateChanged(state => {$('playback-status').textContent = String(state.playerState || 'Prêt'); if (String(state.playerState) === 'Playing') $('message').textContent = '';});
  instance.subscribeOnPlaybackProgress(({position, duration}) => {
    $('progress').max = Math.max(1, duration || 1); $('progress').value = position || 0;
  });
  instance.subscribeOnPlayerError(() => fail(new Error('playback_failed')));
  await instance.init({
    app: {id: session.appId, name: 'Unaite Deezer Sample', version: '1.0.1'}, debug: false,
    userProvider: async () => {
      const data = await gql('query PlayerUser { me { user { id } } tokens { mediaServiceLicenseToken { token expirationDate } liveToken { token expirationDate } recToken { token expirationDate } } }');
      return {id: data.me.user.id, licenseToken: data.tokens.mediaServiceLicenseToken, liveToken: data.tokens.liveToken, authToken: data.tokens.recToken};
    },
    getToken: async () => (await post('/api/token')).access_token,
    trackMediaRequestProvider: async trackId => {
      const data = await gql('query TrackMedia($trackId: String!) { track(trackId: $trackId) { media { id gain version token { payload expiresAt } } } }', {trackId});
      const media = data.track?.media;
      if (!media?.token?.payload) throw new Error('playback_failed');
      return {externalUrl: '', gain: media.gain || undefined, mediaId: media.id, mediaVersion: media.version || '0',
        trackToken: {expirationDateSec: new Date(media.token.expiresAt).getTime(), value: media.token.payload}};
    },
    adsMediaProvider: {fetchAds: async () => {throw new Error('playback_failed');}},
    adsMediaRenderer: {playAds: () => {instance.pause(); fail(new Error('playback_failed'));}},
    defaultAudioQuality: DeezerAudioQualities.MP3_128,
  });
  instance.setVolume(Number($('volume').value)); player = instance; return player;
}
async function selectTrack(track) {
  if (preparing) return;
  preparing = true;
  $('playback-status').textContent = 'Préparation du lecteur…';
  $('message').textContent = ''; $('play').disabled = true; $('pause').disabled = true;
  try {
    if (player) player.pause();
    const p = await ensurePlayer(); selectedTrack = track;
    p.queueList.setQueue([Playable.withDefault(new PlayableIdentifier(PlayableType.TRACK, track.id), new StreamContext(track.id, PlayableType.TRACK.name), ListenType.MOD)]);
    $('track-title').textContent = track.title; $('playback-status').textContent = 'Titre prêt. Cliquez sur Lire pour démarrer.';
    $('play').disabled = false; $('pause').disabled = false;
  } catch (error) {fail(error);} finally {preparing = false;}
}
$('search-form').addEventListener('submit', async event => {
  event.preventDefault(); $('message').textContent = ''; $('search').disabled = true;
  try {
    const term = $('query').value.trim(); if (!term) return;
    const data = await gql(`query Search { search(query: ${JSON.stringify(term)}) { results { tracks(first: 8) { edges { node { id title duration media { rights { sub { available } } } } } } } } }`);
    $('tracks').replaceChildren(); const tracks = data.search?.results?.tracks?.edges || [];
    for (const {node: track} of tracks) {
      const row = document.createElement('li'), text = document.createElement('span'), button = document.createElement('button');
      text.textContent = track.title + ' · ' + Math.round(track.duration) + ' s';
      button.textContent = 'Choisir'; button.disabled = !track.media?.rights?.sub?.available;
      if (button.disabled) button.textContent = 'Indisponible';
      button.onclick = () => selectTrack(track); row.append(text, button); $('tracks').append(row);
    }
    if (!tracks.length) $('tracks').textContent = 'Aucun titre trouvé.';
  } catch (error) {fail(error);} finally {$('search').disabled = !session.authenticated;}
});
$('play').onclick = () => {try {if (player && selectedTrack) player.play();} catch {fail(new Error('playback_failed'));}};
$('pause').onclick = () => {if (player) player.pause();};
$('volume').oninput = () => {if (player) player.setVolume(Number($('volume').value));};
$('refresh').onclick = async () => {try {await post('/api/refresh'); await loadSession(); $('message').textContent = 'Session renouvelée.';} catch (error) {fail(error); await loadSession();}};
$('logout').onclick = async () => {try {if (player) player.pause(); await post('/logout'); window.location.assign('/');} catch (error) {fail(error);}};
window.addEventListener('unhandledrejection', () => fail(new Error('playback_failed')));
loadSession().catch(fail);
