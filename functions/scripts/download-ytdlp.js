// Downloads the yt-dlp binary for the runtime platform into functions/bin.
// Runs automatically on `npm install` — including inside Cloud Build, so the
// deployed container always ships a Linux binary.
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, '..', 'bin');
const dest = path.join(binDir, 'yt-dlp');

// Cloud Functions run on Linux x64; local macOS install gets its own build
// so the function can also be smoke-tested with the emulator.
const asset = process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';

try {
  await stat(dest);
  console.log('yt-dlp already present:', dest);
  process.exit(0);
} catch {
  // not present — download
}

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
console.log('Downloading', url);
await mkdir(binDir, { recursive: true });
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok || !res.body) {
  console.error(`Failed to download yt-dlp (HTTP ${res.status})`);
  process.exit(1);
}
await pipeline(res.body, createWriteStream(dest));
await chmod(dest, 0o755);
console.log('yt-dlp installed:', dest);
