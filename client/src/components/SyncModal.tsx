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
 * Длинный ключ живёт в браузере и никуда не отправляется — на сервер попадает
 * только его хеш как адрес данных. Чтобы открыть тот же прогресс на телефоне,
 * человек вводит короткий код, который действует десять минут и сгорает после
 * первого применения: набирать двадцать четыре символа руками не нужно.
 */
export function SyncModal({ spaceKey, onApplyKey, onClose }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [left, setLeft] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<string | null>(null);
  codeRef.current = code;

  // код гасим при закрытии окна — он больше не нужен
  useEffect(() => {
    return () => {
      if (codeRef.current) revokePairing(codeRef.current);
    };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setLeft(Math.max(0, expiresAt - Date.now()));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [expiresAt]);

  useEffect(() => {
    if (code && left === 0 && expiresAt) setCode(null);
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
    if (isValidKey(raw)) {
      onApplyKey(raw);
      return;
    }
    if (!isValidCode(raw)) {
      setError('Это не похоже на код или ключ.');
      return;
    }
    setBusy(true);
    try {
      const key = await claimPairing(raw);
      if (!key) {
        setError('Код не найден или уже использован. Создайте новый.');
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
      <div className="relative max-h-full w-full max-w-lg overflow-y-auto border-2 border-ink-900 bg-white p-5 sm:p-7">
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
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          Аккаунта нет: прогресс привязан к ключу, который хранится в этом
          браузере. Ни почты, ни входа через другие сервисы — приложению не
          нужно знать, кто вы.
        </p>

        {/* ---------- ключ ---------- */}
        <p className="mt-5 text-[11px] font-bold uppercase tracking-wide text-ink-500">
          ваш ключ
        </p>
        <p className="mt-1 select-all break-all border border-ink-900 bg-[#f4f2ea] px-3 py-2 font-bold tracking-wide text-ink-900">
          {formatKey(spaceKey)}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={copyKey}
            className="inline-flex items-center gap-1.5 border border-ink-900 bg-white px-2.5 py-1 text-xs font-bold text-ink-900 transition hover:bg-ink-100"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : null}
            {copied ? 'скопирован' : 'копировать'}
          </button>
          <a
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(
              `Ключ синхронизации «Эмиль гений»\n\n${formatKey(spaceKey)}\n\nВведите его в приложении, чтобы открыть свой прогресс.\n`,
            )}`}
            download="emile-sync-key.txt"
            className="border border-ink-900 bg-white px-2.5 py-1 text-xs font-bold text-ink-900 transition hover:bg-ink-100"
          >
            скачать файлом
          </a>
        </div>
        <p className="mt-2 border-l-4 border-[#c2401f] bg-white px-3 py-2 text-xs text-ink-700">
          Сохраните ключ. Восстановить его нечем — почты у нас нет, и если
          браузер очистят, прогресс останется только на других устройствах,
          где вы уже подключились.
        </p>

        {/* ---------- перенос ---------- */}
        <div className="mt-6 border-t border-dotted border-ink-300 pt-4">
          {code ? (
            <div>
              <p className="text-sm text-ink-600">
                Введите этот код на другом устройстве:
              </p>
              <p className="mt-2 text-center text-4xl font-bold tracking-widest text-ink-900">
                {formatCode(code)}
              </p>
              <p className="mt-2 text-center text-xs text-ink-500">
                действует {mm}:{String(ss).padStart(2, '0')} и сгорает после
                первого применения
              </p>
            </div>
          ) : (
            <button
              onClick={makeCode}
              disabled={busy}
              className="w-full border-2 border-ink-900 bg-[#f7dd4b] px-4 py-2.5 text-sm font-bold text-ink-900 transition hover:opacity-90 disabled:opacity-50"
            >
              перенести на другое устройство
            </button>
          )}
        </div>

        {/* ---------- подключение ---------- */}
        <div className="mt-5 border-t border-dotted border-ink-300 pt-4">
          <p className="text-sm text-ink-600">
            Открыли приложение на новом устройстве? Введите код с первого — или
            сам ключ.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
              placeholder="код или ключ"
              autoCapitalize="characters"
              spellCheck={false}
              className="min-w-[10rem] flex-1 border border-ink-900 bg-white px-3 py-2 text-base uppercase tracking-wide text-ink-900 outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-400"
            />
            <button
              onClick={connect}
              disabled={busy || !input.trim()}
              className="border-2 border-ink-900 bg-[#cfe36e] px-4 py-2 text-sm font-bold text-ink-900 transition hover:opacity-90 disabled:opacity-50"
            >
              подключить
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-400">
            Данные этого браузера при подключении заменятся на те, что лежат под
            введённым ключом.
          </p>
        </div>

        {error && (
          <p className="mt-4 border border-[#c2401f] bg-white px-3 py-2 text-sm text-[#c2401f]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
