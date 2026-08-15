import { useEffect, useRef, useState } from 'react';
import { claimPairing, publishPairing, revokePairing } from '../lib/pairing';
import { formatCode, formatKey, isValidCode, isValidKey, normalizeKey } from '../lib/space';
import { CheckIcon, XIcon } from './Icons';

interface Props {
  spaceKey: string;
  /** Переключить приложение на другой ключ (перезагружает данные). */
  onApplyKey: (key: string) => void;
  onClose: () => void;
}

/**
 * Синхронизация без аккаунта.
 *
 * Окно открывается сразу с коротким кодом: это единственное, что нужно
 * подавляющему большинству. Длинный ключ и файл для восстановления спрятаны за
 * раскрытием — они пугают ровно тех, кто просто хотел открыть свои карточки на
 * телефоне, а нужны редко.
 */
export function SyncModal({ spaceKey, onApplyKey, onClose }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [left, setLeft] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const codeRef = useRef<string | null>(null);
  codeRef.current = code;

  // код гасим при закрытии окна — он больше не нужен
  useEffect(() => {
    return () => {
      if (codeRef.current) revokePairing(codeRef.current);
    };
  }, []);

  // код нужен сразу: ради него окно и открывают
  useEffect(() => {
    void makeCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setLeft(Math.max(0, expiresAt - Date.now()));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [expiresAt]);

  useEffect(() => {
    if (code && expiresAt && left === 0) setCode(null);
  }, [left, code, expiresAt]);

  async function makeCode() {
    setBusy(true);
    setError(null);
    try {
      const p = await publishPairing(spaceKey);
      setCode(p.code);
      setExpiresAt(p.expiresAt);
    } catch {
      setError('Не удалось создать код. Проверьте соединение.');
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const raw = normalizeKey(input);
    setError(null);
    if (isValidKey(raw)) return onApplyKey(raw);
    if (!isValidCode(raw)) {
      setError('Это не похоже на код или ключ.');
      return;
    }
    setBusy(true);
    try {
      const key = await claimPairing(raw);
      if (!key) {
        setError('Код не найден или уже использован. Создайте новый на первом устройстве.');
        return;
      }
      onApplyKey(key);
    } catch {
      setError('Не удалось подключиться. Проверьте соединение.');
    } finally {
      setBusy(false);
    }
  }

  function copyKey() {
    navigator.clipboard?.writeText(formatKey(spaceKey)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setError('Браузер не дал скопировать — выделите ключ вручную.'),
    );
  }

  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#f4f2ea] p-4">
      <div className="relative max-h-full w-full max-w-md overflow-y-auto border-2 border-ink-900 bg-white p-5 sm:p-7">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 border border-ink-300 p-1.5 text-ink-500 transition hover:bg-ink-100"
          title="Закрыть"
        >
          <XIcon className="h-4 w-4" />
        </button>

        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
          синхронизация
        </h2>

        {/* ---------- главное: код ---------- */}
        <p className="mt-3 pr-8 text-sm leading-relaxed text-ink-700">
          Введите этот код на другом устройстве — там откроется тот же прогресс.
        </p>

        {code ? (
          <div className="mt-3 border-2 border-ink-900 bg-[#f7dd4b] px-4 py-5 text-center">
            <p className="select-all text-4xl font-bold tracking-widest text-ink-900">
              {formatCode(code)}
            </p>
            <p className="mt-2 text-xs text-ink-700">
              действует {mm}:{String(ss).padStart(2, '0')} · сгорает после первого
              применения
            </p>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-center border-2 border-dashed border-ink-300 px-4 py-6">
            {busy ? (
              <span className="flex items-center gap-2 text-sm text-ink-400">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-ink-200 border-t-ink-500 animate-spin-slow" />
                готовим код…
              </span>
            ) : (
              <button
                onClick={makeCode}
                className="border-2 border-ink-900 bg-[#f7dd4b] px-4 py-2 text-sm font-bold text-ink-900 transition hover:opacity-90"
              >
                получить код
              </button>
            )}
          </div>
        )}

        {/* ---------- обратная сторона: ввести код ---------- */}
        <div className="mt-5 border-t border-dotted border-ink-300 pt-4">
          <p className="text-sm text-ink-600">Пришли с другого устройства?</p>
          <div className="mt-2 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
              placeholder="код"
              autoCapitalize="characters"
              spellCheck={false}
              className="min-w-0 flex-1 border border-ink-900 bg-white px-3 py-2 text-base uppercase tracking-widest text-ink-900 outline-none placeholder:tracking-normal placeholder:text-ink-400"
            />
            <button
              onClick={connect}
              disabled={busy || !input.trim()}
              className="shrink-0 border-2 border-ink-900 bg-[#cfe36e] px-4 py-2 text-sm font-bold text-ink-900 transition hover:opacity-90 disabled:opacity-50"
            >
              подключить
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-400">
            Прогресс этого браузера заменится на тот, что под кодом.
          </p>
        </div>

        {error && (
          <p className="mt-4 border border-[#c2401f] bg-white px-3 py-2 text-sm text-[#c2401f]">
            {error}
          </p>
        )}

        {/* ---------- редкое: ключ восстановления ---------- */}
        <div className="mt-5 border-t border-dotted border-ink-300 pt-3">
          <button
            onClick={() => setShowKey((v) => !v)}
            className="flex w-full items-center gap-1.5 text-left text-xs text-ink-500 transition hover:text-ink-900"
          >
            <span className="inline-block w-3">{showKey ? '▾' : '▸'}</span>
            ключ для восстановления
          </button>

          {showKey && (
            <div className="mt-2">
              <p className="text-xs leading-relaxed text-ink-500">
                Аккаунта нет — прогресс привязан к этому ключу. Он нужен, только
                если вы потеряете доступ ко всем устройствам сразу: восстановить
                его нечем, почты у приложения нет.
              </p>
              <p className="mt-2 select-all break-all border border-ink-300 bg-[#f4f2ea] px-3 py-2 text-sm font-bold tracking-wide text-ink-900">
                {formatKey(spaceKey)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={copyKey}
                  className="inline-flex items-center gap-1.5 border border-ink-900 bg-white px-2.5 py-1 text-xs font-bold text-ink-900 transition hover:bg-ink-100"
                >
                  {copied && <CheckIcon className="h-3.5 w-3.5" />}
                  {copied ? 'скопирован' : 'копировать'}
                </button>
                <a
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(
                    `Ключ синхронизации «Эмиль гений»\n\n${formatKey(spaceKey)}\n\nВведите его в поле «код» в окне синхронизации.\n`,
                  )}`}
                  download="emile-sync-key.txt"
                  className="border border-ink-900 bg-white px-2.5 py-1 text-xs font-bold text-ink-900 transition hover:bg-ink-100"
                >
                  скачать файлом
                </a>
              </div>
              <p className="mt-2 text-xs text-ink-400">
                Вводится в то же поле «код» выше.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
