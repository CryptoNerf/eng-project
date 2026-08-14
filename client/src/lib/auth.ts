// Приложению больше не нужно знать, кто вы.
//
// Раньше здесь были вход через Google и ссылка на почту. Их нет: почта — это
// персональные данные, а вход через учётную запись иностранного сервиса прямо
// запрещён (406-ФЗ). Осталась анонимная сессия Firebase — она не спрашивает
// ничего и нужна только для того, чтобы у запросов к базе и к функции
// извлечения субтитров был хоть какой-то заслон от посторонних.
//
// Личность пользователя определяется ключом пространства (lib/space.ts), а не
// этой сессией: она у каждого устройства своя и меняется свободно.

import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { auth } from './firebase';

/**
 * Подписка на сессию; при первом заходе тихо создаёт анонимную. Если Firebase
 * недоступен, отдаёт null — приложение продолжает работать на localStorage.
 */
export function watchUser(cb: (user: User | null) => void): () => void {
  let triedAnon = false;

  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      cb(user);
      return;
    }
    if (!triedAnon) {
      triedAnon = true;
      try {
        await signInAnonymously(auth); // снова вызовет onAuthStateChanged
        return;
      } catch (e) {
        console.warn('Анонимная сессия недоступна, работаем локально:', e);
      }
    }
    cb(null);
  });
}
