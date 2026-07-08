import { useState } from 'react';
import type { Difficulty } from '../lib/types';
import { DIFF_SWATCH } from '../lib/palette';
import { BrainIcon, DownloadIcon, SearchIcon } from './Icons';

export type SortKey = 'frequency' | 'difficulty' | 'alpha' | 'appearance';

interface Props {
  counts: Record<Difficulty, number>;
  active: Set<Difficulty>;
  onToggle: (d: Difficulty) => void;
  search: string;
  onSearch: (v: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  visible: number;
  dueCount: number;
  masteredCount: number;
  showMastered: boolean;
  onToggleMastered: () => void;
  onStudy: () => void;
  onExportTsv: () => void;
  onExportCsv: () => void;
}

const DIFFS: { key: Difficulty; label: string }[] = [
  { key: 'easy', label: 'простые' },
  { key: 'medium', label: 'средние' },
  { key: 'hard', label: 'сложные' },
];

export function Toolbar(p: Props) {
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-ink-900 bg-[#f4f2ea] px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2.5">
        {/* Difficulty filter */}
        <div className="flex items-center gap-1.5">
          {DIFFS.map((d) => {
            const on = p.active.has(d.key);
            return (
              <button
                key={d.key}
                onClick={() => p.onToggle(d.key)}
                className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-sm font-medium transition ${
                  on
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-ink-300 bg-white text-ink-400 hover:border-ink-900 hover:text-ink-900'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 border border-black/20"
                  style={{ backgroundColor: on ? DIFF_SWATCH[d.key] : '#d9d6cb' }}
                />
                {d.label}
                <span className="text-xs opacity-60">{p.counts[d.key]}</span>
              </button>
            );
          })}
        </div>

        {/* Mastered toggle */}
        {p.masteredCount > 0 && (
          <button
            onClick={p.onToggleMastered}
            className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-sm font-medium transition ${
              p.showMastered
                ? 'border-ink-900 bg-[#cfe36e] text-ink-900'
                : 'border-ink-300 bg-white text-ink-400 hover:border-ink-900 hover:text-ink-900'
            }`}
            title="Показать слова, которые вы уже знаете"
          >
            ✓ выученные
            <span className="text-xs opacity-60">{p.masteredCount}</span>
          </button>
        )}

        {/* Search */}
        <div className="relative min-w-[160px] flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            placeholder="поиск…"
            className="w-full border border-ink-900 bg-white py-2 pl-8 pr-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:bg-white"
          />
        </div>

        {/* Sort */}
        <select
          value={p.sort}
          onChange={(e) => p.onSort(e.target.value as SortKey)}
          className="border border-ink-900 bg-white px-2.5 py-2 text-sm text-ink-900 outline-none"
        >
          <option value="frequency">по частоте</option>
          <option value="difficulty">по сложности</option>
          <option value="appearance">по порядку</option>
          <option value="alpha">по алфавиту</option>
        </select>

        {/* Export */}
        <div className="relative">
          <button
            onClick={() => setExportOpen((o) => !o)}
            onBlur={() => setTimeout(() => setExportOpen(false), 150)}
            className="inline-flex items-center gap-2 border border-ink-900 bg-white px-3 py-2 text-sm font-medium text-ink-900 transition hover:bg-ink-100"
          >
            <DownloadIcon className="h-4 w-4" />
            экспорт
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-44 border border-ink-900 bg-white">
              <button
                onMouseDown={p.onExportTsv}
                className="block w-full px-3 py-2.5 text-left text-sm text-ink-900 transition hover:bg-[#f7dd4b]"
              >
                Anki (.txt / TSV)
              </button>
              <button
                onMouseDown={p.onExportCsv}
                className="block w-full border-t border-dotted border-ink-300 px-3 py-2.5 text-left text-sm text-ink-900 transition hover:bg-[#f7dd4b]"
              >
                Таблица (.csv)
              </button>
            </div>
          )}
        </div>

        {/* Study */}
        <button
          onClick={p.onStudy}
          disabled={p.visible === 0}
          className="inline-flex items-center gap-2 border-2 border-ink-900 bg-[#c2401f] px-4 py-1.5 text-sm font-bold text-white transition hover:bg-[#a83519] disabled:opacity-50"
        >
          <BrainIcon className="h-4 w-4" />
          учить
          {p.dueCount > 0 && (
            <span className="bg-white px-1.5 text-xs font-bold text-[#c2401f]">{p.dueCount}</span>
          )}
        </button>
      </div>
    </div>
  );
}
