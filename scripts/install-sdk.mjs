import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
if (!process.env.JFROG_TOKEN) {console.error('Set JFROG_TOKEN to the read-only token supplied by staff, then retry.'); process.exit(1);}
const dir = mkdtempSync(join(tmpdir(), 'deezer-sdk-'));
try {
  const config = join(dir, 'npmrc');
  writeFileSync(config, '@deezer:registry=https://deezerpps.jfrog.io/artifactory/api/npm/web-sdk/\n//deezerpps.jfrog.io/artifactory/api/npm/web-sdk/:_authToken=${JFROG_TOKEN}\n', {mode: 0o600});
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--userconfig', config, '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', '@deezer/sdk-player@8.8.6', '@deezer/sdk-auth@3.0.2'], {stdio: 'inherit', shell: process.platform === 'win32'});
  process.exitCode = result.status ?? 1;
} finally {rmSync(dir, {recursive: true, force: true});}
