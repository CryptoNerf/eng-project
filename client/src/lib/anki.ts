import type { Card } from './types';

function escapeCsv(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Anki-friendly TSV: Front, Back (translation + example with highlight). */
export function toAnkiTsv(cards: Card[]): string {
  const rows = cards.map((c) => {
    const ex = c.examples[0];
    const front = c.word;
    const exHtml = ex
      ? `<br><br><span style="color:#64748b">${highlight(ex.en, c.forms?.length ? c.forms : [c.word])}</span>` +
        (ex.ru ? `<br><span style="color:#94a3b8">${ex.ru}</span>` : '')
      : '';
    const back = `${c.translation}${exHtml}`;
    // TSV: tabs separate fields, so strip tabs/newlines from cell content
    return [clean(front), clean(back)].join('\t');
  });
  return rows.join('\n');
}

/** Generic CSV: word, translation, example EN, example RU. */
export function toCsv(cards: Card[]): string {
  const header = ['word', 'translation', 'example_en', 'example_ru'];
  const rows = cards.map((c) => {
    const ex = c.examples[0];
    return [c.word, c.translation, ex?.en || '', ex?.ru || '']
      .map(escapeCsv)
      .join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

function clean(s: string): string {
  return s.replace(/[\t\r\n]+/g, ' ').trim();
}

function highlight(sentence: string, forms: string[]): string {
  const esc = forms.map(escapeRegExp).join('|');
  const re = new RegExp(`\\b((?:${esc})\\w*)`, 'gi');
  return sentence.replace(re, '<b>$1</b>');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
