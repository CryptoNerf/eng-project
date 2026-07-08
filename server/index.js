import express from 'express';
import cors from 'cors';
import { fetchTranscript } from './transcript.js';
import { translateBatch } from './translate.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/transcript', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Укажите ссылку на YouTube-видео.' });
  }
  try {
    const data = await fetchTranscript(url);
    res.json(data);
  } catch (e) {
    const status = e.code === 'BAD_URL' ? 400 : e.code === 'NOT_FOUND' ? 404 : 422;
    console.error('[transcript]', e.code || '', e.message);
    res.status(status).json({ error: e.message, code: e.code || 'ERROR' });
  }
});

app.post('/api/translate', async (req, res) => {
  const { texts, target } = req.body || {};
  if (!Array.isArray(texts)) {
    return res.status(400).json({ error: 'texts must be an array' });
  }
  try {
    const translations = await translateBatch(texts, target || 'ru');
    res.json({ translations });
  } catch (e) {
    console.error('[translate]', e.message);
    res.status(502).json({ error: 'Ошибка перевода.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Molly server listening on http://localhost:${PORT}`);
});
