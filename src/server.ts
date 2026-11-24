import {createServer} from 'node:http';
import {createApp} from './app.ts';
const server = createServer(createApp({clientId: process.env.DEEZER_CLIENT_ID || '', appId: process.env.DEEZER_APP_ID || ''}));
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(3000, '127.0.0.1', () => console.log('Open http://localhost:3000 — Ctrl+C to stop.'));
server.on('error', () => {console.error('Cannot start: check that port 3000 is free.'); process.exitCode = 1;});
