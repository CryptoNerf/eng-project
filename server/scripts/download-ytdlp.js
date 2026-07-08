// Downloads the standalone yt-dlp binary for the current platform into server/bin.
// Run via: npm run setup:ytdlp
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, '..', 'bin');

function assetForPlatform() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp'; // linux
}

async function main() {
  const asset = assetForPlatform();
  const dest = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

  try {
    await stat(dest);
    console.log('✓ yt-dlp уже на месте:', dest);
    return;
  } catch {
    // not present — download
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  console.log('Скачиваю yt-dlp:', url);
  await mkdir(binDir, { recursive: true });

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать yt-dlp (HTTP ${res.status})`);
  await pipeline(res.body, createWriteStream(dest));
  if (process.platform !== 'win32') await chmod(dest, 0o755);
  console.log('✓ yt-dlp установлен:', dest);
}

main().catch((e) => {
  console.error('Ошибка установки yt-dlp:', e.message);
  process.exit(1);
});
