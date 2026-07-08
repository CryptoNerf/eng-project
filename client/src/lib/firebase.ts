import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// Public web config — identifies the project; security lives in Firestore rules.
const firebaseConfig = {
  apiKey: 'AIzaSyDeQD8FgzX2ZmzxxOCoTnuzIIUokU1ddxY',
  authDomain: 'engproject-b4a58.firebaseapp.com',
  projectId: 'engproject-b4a58',
  storageBucket: 'engproject-b4a58.firebasestorage.app',
  messagingSenderId: '282228794132',
  appId: '1:282228794132:web:a1f4a5ba1ec929432d9801',
  measurementId: 'G-SDG4GFTZ90',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const fns = getFunctions(app, 'europe-west1');

// Persistent cache = offline-first: decks and progress are readable and
// writable without network; changes sync when the connection returns.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});
