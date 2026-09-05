// Ставит отметку времени перед деплоем функций.
//
// Зачем: бинарник yt-dlp качается Cloud Build'ом и живёт ровно до следующего
// деплоя, а firebase пропускает деплой, если исходники не менялись («No changes
// detected») — bin в них не входит. Из-за этого «просто передеплоить, чтобы
// обновить yt-dlp» молча не работало. Отметка меняет хеш исходников, значит
// контейнер пересобирается и бинарник всегда свежий.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, '..', 'build-stamp.json');
const stamp = { deployedAt: new Date().toISOString() };
await writeFile(file, JSON.stringify(stamp, null, 2) + '\n');
console.log('Отметка деплоя:', stamp.deployedAt, '— контейнер пересоберётся, yt-dlp будет свежим');
