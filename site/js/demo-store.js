// 示範模式：還沒設定 Firebase 時使用。資料只存在這個瀏覽器的 localStorage。
// 介面和 firebase-store.js 相同，並照 firestore.rules 檢查內容與冷卻時間，行為才會一致。
import {
  COOLDOWN_MS,
  WALL_LIMIT,
  DRAWER_LIMIT,
  StoreError,
  checkText,
  isStamp,
} from './shared.js';

const KEY = 'street-postoffice-demo-v1';
const LATENCY_MS = 350;
const DEMO_USER = { uid: 'demo-you', name: '你（示範）', photo: '' };

const SEEDS = [
  { text: '下次路過記得帶傘，這條街的雨說來就來。', stamp: 'moss', authorName: '阿凱', minutesAgo: 12 },
  { text: '第一次寫 Firestore 規則，被退件三次才寄出這張。', stamp: 'indigo', authorName: '小林', minutesAgo: 95 },
  { text: '巷口豆花換老闆了，花生還是一樣軟。', stamp: 'vermilion', authorName: 'Mei', minutesAgo: 260 },
  { text: '寄給明天的自己：作業先寫，再來逛牆。', stamp: 'indigo', authorName: '路人乙', minutesAgo: 1440 },
  { text: 'Greetings from a static site that somehow has a database.', stamp: 'moss', authorName: 'Tom', minutesAgo: 2900 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// getRandomValues 在 http 的區網網址（非 secure context）也能用，randomUUID 不行
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function seed() {
  const now = Date.now();
  return {
    signedIn: false,
    cards: SEEDS.map((s, i) => ({
      id: `seed${i}`,
      text: s.text,
      stamp: s.stamp,
      authorId: `seed-author-${i}`,
      authorName: s.authorName,
      authorPhoto: '',
      createdAt: now - s.minutesAgo * 60_000,
    })),
    letters: {},
    rate: {},
  };
}

export function createDemoStore() {
  let db = read() ?? seed();
  const subs = { user: new Set(), wall: new Set(), drawer: new Set() };

  const currentUser = () => (db.signedIn ? DEMO_USER : null);

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      // 無痕模式或儲存空間被擋：資料只留在這次的頁面裡
    }
  }

  const wall = () =>
    [...db.cards]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, WALL_LIMIT)
      .map((c) => ({ ...c, createdAt: new Date(c.createdAt), pending: false }));

  const drawer = () => {
    const user = currentUser();
    if (!user) return [];
    return [...(db.letters[user.uid] ?? [])]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, DRAWER_LIMIT)
      .map((l) => ({ ...l, createdAt: new Date(l.createdAt), pending: false }));
  };

  // 和 Firebase 一樣：登入狀態改變才通知 onUser，資料改變只通知監聽中的清單
  function emit({ userChanged = false } = {}) {
    if (userChanged) for (const cb of subs.user) cb(currentUser());
    for (const cb of subs.wall) cb(wall());
    for (const cb of subs.drawer) cb(drawer());
  }

  // 其他分頁改了資料時同步
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const wasSignedIn = db.signedIn;
    db = read() ?? seed();
    emit({ userChanged: db.signedIn !== wasSignedIn });
  });

  function subscribe(set, callback, snapshot) {
    set.add(callback);
    queueMicrotask(() => set.has(callback) && callback(snapshot()));
    return () => set.delete(callback);
  }

  // 和規則的 stampedRate 一樣：每次新增前檢查 10 秒冷卻
  async function writeWithRate(mutate) {
    const user = currentUser();
    if (!user) throw new StoreError('denied', 'not signed in');
    const wait = (db.rate[user.uid] ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) throw new StoreError('cooldown', 'cooldown', { waitMs: wait });
    db.rate[user.uid] = Date.now();
    await sleep(LATENCY_MS);
    mutate(user);
    save();
    emit();
    return { queued: false };
  }

  function validated(text, stamp) {
    const check = checkText(text);
    if (!check.ok) throw new StoreError('invalid', check.reason);
    if (stamp !== undefined && !isStamp(stamp)) throw new StoreError('invalid', 'stamp');
    return check.text;
  }

  function postcard(text, stamp, user) {
    return {
      id: newId(),
      text,
      stamp,
      authorId: user.uid,
      authorName: user.name,
      authorPhoto: user.photo,
      createdAt: Date.now(),
    };
  }

  return {
    mode: 'demo',

    onUser: (cb) => subscribe(subs.user, cb, currentUser),
    watchWall: (cb) => subscribe(subs.wall, cb, wall),
    watchDrawer: (cb) => subscribe(subs.drawer, cb, drawer),
    setBackgroundErrorHandler() {}, // 示範模式的寫入不會排隊

    async signIn() {
      await sleep(LATENCY_MS);
      db.signedIn = true;
      save();
      emit({ userChanged: true });
    },

    async signOut() {
      db.signedIn = false;
      save();
      emit({ userChanged: true });
    },

    async sendPostcard({ text, stamp }) {
      const body = validated(text, stamp);
      return writeWithRate((user) => db.cards.push(postcard(body, stamp, user)));
    },

    async saveLetter({ text }) {
      const body = validated(text);
      return writeWithRate((user) => {
        (db.letters[user.uid] ??= []).push({ id: newId(), text: body, createdAt: Date.now() });
      });
    },

    async sendLetter(letter, stamp) {
      const body = validated(letter.text, stamp);
      return writeWithRate((user) => {
        db.cards.push(postcard(body, stamp, user));
        db.letters[user.uid] = (db.letters[user.uid] ?? []).filter((l) => l.id !== letter.id);
      });
    },

    async discardLetter(id) {
      const user = currentUser();
      if (!user) throw new StoreError('denied', 'not signed in');
      await sleep(LATENCY_MS);
      db.letters[user.uid] = (db.letters[user.uid] ?? []).filter((l) => l.id !== id);
      save();
      emit();
    },

    async withdrawPostcard(id) {
      const user = currentUser();
      const card = db.cards.find((c) => c.id === id);
      if (!user || !card || card.authorId !== user.uid) throw new StoreError('denied', 'not author');
      await sleep(LATENCY_MS);
      db.cards = db.cards.filter((c) => c.id !== id);
      save();
      emit();
    },
  };
}
