// 真正的郵局：Firebase Authentication（Google 登入）＋ Cloud Firestore。
// SDK 從 Google 官方 CDN 載入，不需要 npm 或建置步驟。三行的版本號要一起改。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  deleteDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {
  COOLDOWN_MS,
  WALL_LIMIT,
  DRAWER_LIMIT,
  StoreError,
  checkText,
  isStamp,
  httpsOnly,
  str,
} from './shared.js';
import { createOneTap } from './one-tap.js';

const QUEUE_AFTER_MS = 6000;

const ERROR_CODES = {
  'permission-denied': 'denied',
  unauthenticated: 'denied',
  'resource-exhausted': 'quota',
  unavailable: 'offline',
  'deadline-exceeded': 'offline',
  'not-found': 'no-db',
  'auth/unauthorized-domain': 'auth-domain',
  'auth/popup-blocked': 'popup-blocked',
  'auth/popup-closed-by-user': 'cancelled',
  'auth/cancelled-popup-request': 'cancelled',
  'auth/user-cancelled': 'cancelled',
  'auth/network-request-failed': 'offline',
  'auth/operation-not-allowed': 'provider-off',
  'auth/configuration-not-found': 'provider-off',
  'auth/invalid-api-key': 'config',
  'auth/invalid-credential': 'config', // googleClientId 不是這個 Firebase 專案的 OAuth client
};

function toStoreError(e) {
  if (e instanceof StoreError) return e;
  const raw = str(e?.code);
  const code = ERROR_CODES[raw] ?? (raw.startsWith('auth/api-key') ? 'config' : 'unknown');
  return new StoreError(code, str(e?.message) || raw || 'unknown');
}

export function createFirebaseStore(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  // 本機快取：重新整理頁面時，即時監聽只需要補讀有變動的文件，省每日讀取額度
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  const provider = new GoogleAuthProvider();
  const oneTap = config.googleClientId ? createOneTap(config.googleClientId) : null;

  let me = null;
  let lastWriteAt = 0;
  let writing = false;
  let onBackgroundError = () => {};

  // 名字和頭像取自 ID token 的 claims，因為規則就是拿 request.auth.token 來比對
  async function profileOf(user) {
    try {
      const { claims } = await user.getIdTokenResult();
      return { uid: user.uid, name: str(claims.name), photo: str(claims.picture) };
    } catch {
      return { uid: user.uid, name: user.displayName ?? '', photo: user.photoURL ?? '' };
    }
  }

  async function readLastWrite(uid) {
    try {
      const snap = await getDoc(doc(db, 'rate', uid));
      return snap.get('last')?.toMillis() ?? 0;
    } catch {
      return 0;
    }
  }

  function requireUser() {
    if (!me) throw new StoreError('denied', 'not signed in');
    return me;
  }

  function validated(text, stamp) {
    const check = checkText(text);
    if (!check.ok) throw new StoreError('invalid', check.reason);
    if (stamp !== undefined && !isStamp(stamp)) throw new StoreError('invalid', 'stamp');
    return check.text;
  }

  function postcardData(text, stamp, user) {
    return {
      text,
      stamp,
      authorId: user.uid,
      authorName: user.name,
      authorPhoto: user.photo,
      createdAt: serverTimestamp(),
    };
  }

  // 每次「新增」都和 /rate/{uid} 放在同一個批次，並寫明這次新增的是哪一份文件，
  // 規則才放行（見 firestore.rules 的 stampedRate）。
  // 離線時 commit 要等連線後伺服器確認才會結束：超過 QUEUE_AFTER_MS 就先回 { queued: true }
  // 讓畫面解鎖，寫入留在本機佇列，連線後自動送出；之後失敗再透過 onBackgroundError 通知。
  async function commitWithRate(kind, target, build) {
    const user = requireUser();
    if (writing) throw new StoreError('queued', 'previous write still pending');
    const wait = lastWriteAt + COOLDOWN_MS - Date.now();
    if (wait > 0) throw new StoreError('cooldown', 'cooldown', { waitMs: Math.max(wait, 1000) });

    writing = true;
    const batch = writeBatch(db);
    batch.set(doc(db, 'rate', user.uid), { last: serverTimestamp(), kind, docId: target.id });
    build(batch, user);
    const done = batch
      .commit()
      .then(
        () => {
          lastWriteAt = Date.now();
        },
        async (e) => {
          throw await explainWriteError(e, user);
        },
      )
      .finally(() => {
        writing = false;
      });

    let timer;
    const queued = new Promise((resolve) => {
      timer = setTimeout(() => resolve('queued'), QUEUE_AFTER_MS);
    });
    const outcome = await Promise.race([done.then(() => 'sent'), queued]).finally(() => clearTimeout(timer));
    if (outcome === 'queued') {
      done.catch((err) => onBackgroundError(err));
      return { queued: true };
    }
    return { queued: false };
  }

  // 被規則擋下時，多讀一次寄件紀錄，分辨是「寄太快」還是「內容不符規則」。
  // 容許 3 秒的時鐘誤差，所以剛過冷卻的 3 秒內，真正的規則錯誤也可能被當成冷卻；原始錯誤留在 console。
  async function explainWriteError(e, user) {
    const err = toStoreError(e);
    if (err.code !== 'denied') return err;
    const last = await readLastWrite(user.uid);
    const wait = last + COOLDOWN_MS - Date.now();
    if (wait > -3000) {
      console.warn('Firestore 拒絕寫入，判斷為冷卻中：', e);
      lastWriteAt = Math.max(lastWriteAt, last);
      return new StoreError('cooldown', 'cooldown', { waitMs: Math.max(wait, 1000) });
    }
    return err;
  }

  function toCard(snap) {
    const v = snap.data({ serverTimestamps: 'estimate' });
    return {
      id: snap.id,
      text: str(v.text),
      stamp: isStamp(v.stamp) ? v.stamp : 'vermilion',
      authorId: str(v.authorId),
      authorName: str(v.authorName),
      authorPhoto: httpsOnly(v.authorPhoto),
      createdAt: v.createdAt?.toDate?.() ?? new Date(),
      pending: snap.metadata.hasPendingWrites,
    };
  }

  function toLetter(snap) {
    const v = snap.data({ serverTimestamps: 'estimate' });
    return {
      id: snap.id,
      text: str(v.text),
      createdAt: v.createdAt?.toDate?.() ?? new Date(),
      pending: snap.metadata.hasPendingWrites,
    };
  }

  return {
    mode: 'live',

    onUser(callback) {
      return onAuthStateChanged(auth, async (user) => {
        if (!user) {
          me = null;
          lastWriteAt = 0;
          callback(null);
          return;
        }
        const profile = await profileOf(user);
        if (auth.currentUser?.uid !== user.uid) return; // 等待期間已登出或換人
        me = profile;
        callback(me);
        const last = await readLastWrite(user.uid);
        if (me?.uid === user.uid) lastWriteAt = Math.max(lastWriteAt, last);
      });
    },

    async signIn() {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        throw toStoreError(e);
      }
    },

    // 有設定 googleClientId 才有 One Tap
    hasOneTap: Boolean(oneTap),

    warmUpSignIn() {
      oneTap?.warmUp();
    },

    // 用 One Tap 拿到 Google 的 ID token，再換成 Firebase 登入；
    // token 的 sign_in_provider 一樣是 google.com，name、picture 也照樣帶過來，規則不用改
    async signInWithOneTap() {
      if (!oneTap) throw new StoreError('one-tap-skipped', 'no googleClientId');
      const idToken = await oneTap.prompt();
      try {
        await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      } catch (e) {
        throw toStoreError(e);
      }
    },

    cancelOneTap() {
      oneTap?.cancel();
    },

    async signOut() {
      await firebaseSignOut(auth);
    },

    watchWall(callback, onError) {
      const q = query(collection(db, 'postcards'), orderBy('createdAt', 'desc'), limit(WALL_LIMIT));
      return onSnapshot(
        q,
        (snap) => callback(snap.docs.map(toCard)),
        (e) => onError(toStoreError(e)),
      );
    },

    watchDrawer(callback, onError) {
      if (!me) return () => {};
      const q = query(
        collection(db, 'drawers', me.uid, 'letters'),
        orderBy('createdAt', 'desc'),
        limit(DRAWER_LIMIT),
      );
      return onSnapshot(
        q,
        (snap) => callback(snap.docs.map(toLetter)),
        (e) => onError(toStoreError(e)),
      );
    },

    setBackgroundErrorHandler(handler) {
      onBackgroundError = handler;
    },

    async sendPostcard({ text, stamp }) {
      const body = validated(text, stamp);
      const card = doc(collection(db, 'postcards'));
      return commitWithRate('postcards', card, (batch, user) => {
        batch.set(card, postcardData(body, stamp, user));
      });
    },

    async saveLetter({ text }) {
      const body = validated(text);
      const letter = doc(collection(db, 'drawers', requireUser().uid, 'letters'));
      return commitWithRate('letters', letter, (batch) => {
        batch.set(letter, { text: body, createdAt: serverTimestamp() });
      });
    },

    async sendLetter(letter, stamp) {
      const body = validated(letter.text, stamp);
      const card = doc(collection(db, 'postcards'));
      return commitWithRate('postcards', card, (batch, user) => {
        batch.set(card, postcardData(body, stamp, user));
        batch.delete(doc(db, 'drawers', user.uid, 'letters', letter.id));
      });
    },

    async discardLetter(id) {
      const user = requireUser();
      try {
        await deleteDoc(doc(db, 'drawers', user.uid, 'letters', id));
      } catch (e) {
        throw toStoreError(e);
      }
    },

    async withdrawPostcard(id) {
      requireUser();
      try {
        await deleteDoc(doc(db, 'postcards', id));
      } catch (e) {
        throw toStoreError(e);
      }
    },
  };
}
