// Sets up the bgutil PoToken provider for yt-dlp:
//  1) the yt-dlp plugin zip  → functions/plugins/
//  2) the Node "script mode" generator (built)  → functions/bgutil/server/build/generate_once.js
// PoTokens let yt-dlp pass YouTube's bot-check from datacenter IPs (Cloud Functions).
import { createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pluginsDir = path.join(root, 'plugins');
const serverDir = path.join(root, 'bgutil', 'server');
const buildMarker = path.join(serverDir, 'build', 'generate_once.js');

const UA = { 'User-Agent': 'molly-setup' };
const REPO = 'Brainicism/bgutil-ytdlp-pot-provider';

async function exists(p) {
  return stat(p).then(() => true).catch(() => false);
}

async function downloadTo(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: UA });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status}: ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

if ((await exists(buildMarker)) && (await exists(path.join(pluginsDir, 'bgutil-ytdlp-pot-provider.zip')))) {
  console.log('bgutil already set up');
  process.exit(0);
}

const rel = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: UA })).json();
const tag = rel.tag_name;
if (!tag) throw new Error('cannot resolve bgutil release tag');
console.log('bgutil release:', tag);

// 1) plugin zip (python side, loaded by yt-dlp via --plugin-dirs)
await mkdir(pluginsDir, { recursive: true });
await downloadTo(
  `https://github.com/${REPO}/releases/download/${tag}/bgutil-ytdlp-pot-provider.zip`,
  path.join(pluginsDir, 'bgutil-ytdlp-pot-provider.zip'),
);
console.log('plugin zip installed');

// 2) node script generator: fetch source, build server/
const tarPath = path.join(tmpdir(), `bgutil-${tag}.tar.gz`);
await downloadTo(`https://github.com/${REPO}/archive/refs/tags/${tag}.tar.gz`, tarPath);
await mkdir(serverDir, { recursive: true });
const version = tag.replace(/^v/, '');
execSync(
  `tar -xzf "${tarPath}" -C "${serverDir}" --strip-components=2 "bgutil-ytdlp-pot-provider-${version}/server"`,
  { stdio: 'inherit' },
);
console.log('building bgutil server (npm install + tsc)...');
// --include=dev: cloud builds default to production installs, but the build
// needs the typescript devDependency
execSync('npm install --include=dev --no-audit --no-fund --loglevel=error', {
  cwd: serverDir,
  stdio: 'inherit',
});
execSync(path.join('node_modules', '.bin', 'tsc'), { cwd: serverDir, stdio: 'inherit' });

if (!(await exists(buildMarker))) throw new Error('bgutil build did not produce generate_once.js');
await writeFile(path.join(root, 'bgutil', 'VERSION'), tag);
console.log('bgutil ready:', buildMarker);
