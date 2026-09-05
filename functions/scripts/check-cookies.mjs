#!/usr/bin/env node
// Проверка файла кук ПЕРЕД загрузкой в Secret Manager.
//
// Куки для YouTube умирают тихо: срок жизни в файле остаётся годным, а сессию
// Google гасит на своей стороне — и bot-check возвращается. Этот скрипт
// отвечает на единственный важный вопрос: пускает ли YouTube по этим кукам.
//
//   node functions/scripts/check-cookies.mjs ~/Downloads/cookies.txt

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const file = process.argv[2];

// Без аргумента проверяем то, что реально работает в облаке. Это ответ на
// вопрос «а сейчас-то всё живо?» одной командой, без выгрузки файлов руками.
let raw;
if (file) {
  raw = await readFile(file, 'utf8').catch((e) => {
    console.error('Не удалось прочитать файл:', e.message);
    process.exit(1);
  });
} else {
  console.log('Файл не указан — проверяю секрет YT_COOKIES из облака…');
  try {
    const { stdout } = await execFileAsync(
      'npx',
      ['firebase-tools', 'functions:secrets:access', 'YT_COOKIES'],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    raw = stdout;
  } catch (e) {
    console.error('Не удалось получить секрет:', e.message);
    process.exit(1);
  }
}

const lines = raw.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const rows = lines.map((l) => l.split('\t')).filter((f) => f.length >= 7);
if (rows.length === 0) {
  console.error('✗ Это не формат Netscape. Нужен экспорт «cookies.txt», а не JSON.');
  process.exit(1);
}

// Без этих кук сессия не считается авторизованной.
const REQUIRED = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'];
const names = new Set(rows.map((f) => f[5]));
const missing = REQUIRED.filter((n) => !names.has(n));
const now = Math.floor(Date.now() / 1000);
const expired = rows.filter((f) => Number(f[4]) && Number(f[4]) < now).map((f) => f[5]);

console.log(`строк с куками: ${rows.length}`);
console.log(missing.length ? `✗ не хватает: ${missing.join(', ')}` : '✓ все ключевые куки на месте');
if (expired.length) console.log(`  просрочены: ${expired.join(', ')}`);

// Главная проверка: реальный запрос к YouTube с этими куками.
//
// Берём ТОЛЬКО куки, подходящие youtube.com. Экспорт из браузера тащит их для
// всех доменов Google сразу, и одно имя (SID, HSID, …) встречается по разу на
// домен с разными значениями — если склеить всё подряд, YouTube получит
// противоречивый заголовок и не признает сессию.
const HOST = 'www.youtube.com';
const forHost = rows.filter((f) => {
  const domain = f[0].replace(/^\./, '');
  return HOST === domain || HOST.endsWith(`.${domain}`);
});
const byName = new Map();
for (const f of forHost) byName.set(f[5], f[6]);
const jar = [...byName].map(([k, v]) => `${k}=${v}`).join('; ');
console.log(`  подходит для youtube.com: ${forHost.length} строк, уникальных имён: ${byName.size}`);
const res = await fetch('https://www.youtube.com/', {
  headers: {
    cookie: jar,
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  },
});
const html = await res.text();
const m = html.match(/"LOGGED_IN":(true|false)/);

if (m?.[1] === 'true') {
  if (file) {
    console.log('\n✓ YouTube принимает эти куки — можно выкладывать:');
    console.log(`  npx firebase-tools functions:secrets:set YT_COOKIES --data-file ${file}`);
    console.log('  npm run deploy:functions   # секрет привязан по версии, деплой обязателен');
  } else {
    console.log('\n✓ Сессия в облаке жива — извлечение субтитров работает.');
  }
} else {
  console.log(`\n✗ YouTube этих кук не признаёт (LOGGED_IN: ${m?.[1] ?? 'не найдено'}).`);
  console.log('  Экспортируйте заново из вкладки, где вы точно вошли, и НЕ выходите из аккаунта после экспорта,');
  console.log('  затем: npm run check:cookies -- <файл>  →  functions:secrets:set  →  npm run deploy:functions');
  process.exit(1);
}
