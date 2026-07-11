import { useState } from 'react';
import { sendEmailLink, linkGoogle } from '../lib/auth';
import { XIcon } from './Icons';

interface Props {
  onClose: () => void;
  onGoogleLinked: () => void;
}

/**
 * Sign-in options. Email-link is offered first: it's the reliable method on
 * iOS Safari / installed PWA (no popup, no cross-domain redirect). Google is
 * kept for desktop convenience.
 */
export function LoginModal({ onClose, onGoogleLinked }: Props) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendEmailLink(value);
      setSent(true);
    } catch (err) {
      const code = (err as { code?: string }).code || '';
      setError(
        code === 'auth/operation-not-allowed'
          ? 'Вход по почте не включён в настройках проекта.'
          : 'Не удалось отправить ссылку. Проверьте адрес и попробуйте снова.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError(null);
    try {
      await linkGoogle();
      onGoogleLinked();
      onClose();
    } catch (err) {
      const code = (err as { code?: string }).code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Вход отменён.');
      } else {
        setError('Через Google не удалось. На телефоне надёжнее вход по почте ниже.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 px-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm border-2 border-ink-900 bg-white p-5 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink-900">Вход и синхронизация</h3>
          <button onClick={onClose} className="p-1 text-ink-400 hover:text-ink-900">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {sent ? (
          <div className="border border-dashed border-ink-900 bg-[#cfe36e]/40 p-4 text-sm text-ink-800">
            Отправили ссылку на <b>{email}</b>. Откройте письмо на этом устройстве и
            перейдите по ссылке — вы вернётесь сюда уже с синхронизацией.
            <p className="mt-2 text-xs text-ink-500">
              Письма нет? Загляните в папку <b>«Спам»</b> — письма от Firebase часто
              попадают туда. Отметьте «не спам», чтобы следующие пришли во «Входящие».
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-500">
              Прогресс и коллекции сохранятся и появятся на других устройствах.
            </p>

            <form onSubmit={submitEmail} className="space-y-2">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ваш e-mail"
                className="w-full border border-ink-900 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-ink-400"
              />
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="w-full border-2 border-ink-900 bg-ink-900 py-2.5 text-sm font-bold text-white transition hover:bg-ink-700 disabled:opacity-50"
              >
                {busy ? 'Отправляем…' : 'Прислать ссылку для входа'}
              </button>
            </form>

            <div className="my-3 flex items-center gap-2 text-xs text-ink-400">
              <span className="h-px flex-1 bg-ink-200" />
              или
              <span className="h-px flex-1 bg-ink-200" />
            </div>

            <button
              onClick={google}
              disabled={busy}
              className="w-full border border-ink-900 bg-white py-2.5 text-sm font-bold text-ink-900 transition hover:bg-ink-100 disabled:opacity-50"
            >
              войти через Google
            </button>
          </>
        )}

        {error && <p className="mt-3 text-sm font-medium text-[#c2401f]">{error}</p>}
      </div>
    </div>
  );
}
