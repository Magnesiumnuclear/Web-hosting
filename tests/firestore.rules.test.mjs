// firestore.rules 的自動測試：跑在本機的 Firestore emulator 上（假專案 demo-postoffice，不連真的 Firebase）。
// 執行：npm run test:rules
import { after, before, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { checkText, MAX_CHARS } from '../site/js/shared.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const ALICE = { uid: 'alice', name: 'Alice 王', picture: 'https://lh3.googleusercontent.com/a/alice' };
const BOB = { uid: 'bob', name: 'Bob', picture: 'https://lh3.googleusercontent.com/a/bob' };
const NAMELESS = { uid: 'nameless', picture: 'https://lh3.googleusercontent.com/a/nameless' };

let testEnv;

before(async () => {
  // FIRESTORE_EMULATOR_HOST 由 firebase emulators:exec 設定
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-postoffice',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv?.cleanup();
});

// ── 小工具 ─────────────────────────────────────────

// 預設是 Google 登入；ID token 帶 name、picture，和真的 Google 登入一樣
function as(user, provider = 'google.com') {
  return testEnv
    .authenticatedContext(user.uid, {
      name: user.name,
      picture: user.picture,
      firebase: { sign_in_provider: provider, identities: {} },
    })
    .firestore();
}

const guest = () => testEnv.unauthenticatedContext().firestore();
const newId = (db) => doc(collection(db, 'postcards')).id;
const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);

function card(user, overrides = {}) {
  return {
    text: '下次路過記得帶傘。',
    stamp: 'vermilion',
    authorId: user.uid,
    authorName: user.name ?? '',
    authorPhoto: user.picture ?? '',
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

const letter = (overrides = {}) => ({ text: '還不想寄的信', createdAt: serverTimestamp(), ...overrides });

// 和 site/js/firebase-store.js 一樣：明信片和寄件紀錄放在同一個批次
async function sendCard(db, user, data = card(user), id = newId(db)) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'rate', user.uid), { last: serverTimestamp(), kind: 'postcards', docId: id });
  batch.set(doc(db, 'postcards', id), data);
  await batch.commit();
  return id;
}

async function saveLetter(db, user, owner = user.uid, data = letter(), id = newId(db)) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'rate', user.uid), { last: serverTimestamp(), kind: 'letters', docId: id });
  batch.set(doc(db, 'drawers', owner, 'letters', id), data);
  await batch.commit();
  return id;
}

// 繞過規則直接放資料，用來準備測試情境
async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const seededCard = (user, id = 'card1') =>
  seed(`postcards/${id}`, { ...card(user), createdAt: ago(60_000) });

// ── 公佈牆讀取 ───────────────────────────────────────

describe('公佈牆讀取', () => {
  test('未登入可以用 limit 40 讀最新的明信片', async () => {
    await seededCard(ALICE);
    const q = query(collection(guest(), 'postcards'), orderBy('createdAt', 'desc'), limit(40));
    await assertSucceeds(getDocs(q));
  });

  test('未登入可以讀單張明信片', async () => {
    await seededCard(ALICE);
    await assertSucceeds(getDoc(doc(guest(), 'postcards/card1')));
  });

  test('沒有 limit 的查詢被拒', async () => {
    await assertFails(getDocs(collection(guest(), 'postcards')));
  });

  test('一次讀 51 張被拒', async () => {
    await assertFails(getDocs(query(collection(guest(), 'postcards'), limit(51))));
  });
});

// ── 寄明信片 ─────────────────────────────────────────

describe('寄明信片', () => {
  test('Google 登入、內容正確，可以寄出', async () => {
    await assertSucceeds(sendCard(as(ALICE), ALICE));
  });

  test('沒有名字的 Google 帳號，寄件人名字用空字串可以寄出', async () => {
    await assertSucceeds(sendCard(as(NAMELESS), NAMELESS));
  });

  test('沒在同一個批次寫寄件紀錄，被拒', async () => {
    const db = as(ALICE);
    await assertFails(setDoc(doc(db, 'postcards', newId(db)), card(ALICE)));
  });

  test('已有舊的寄件紀錄、但這次沒更新，被拒', async () => {
    await seed('rate/alice', { last: ago(60_000), kind: 'postcards', docId: 'old' });
    const db = as(ALICE);
    await assertFails(setDoc(doc(db, 'postcards', newId(db)), card(ALICE)));
  });

  test('同一個批次放兩張明信片，整批被拒', async () => {
    const db = as(ALICE);
    const first = newId(db);
    const batch = writeBatch(db);
    batch.set(doc(db, 'rate', ALICE.uid), { last: serverTimestamp(), kind: 'postcards', docId: first });
    batch.set(doc(db, 'postcards', first), card(ALICE));
    batch.set(doc(db, 'postcards', newId(db)), card(ALICE));
    await assertFails(batch.commit());
  });

  test('同一個批次放一張明信片和一封抽屜信，整批被拒', async () => {
    const db = as(ALICE);
    const id = newId(db);
    const batch = writeBatch(db);
    batch.set(doc(db, 'rate', ALICE.uid), { last: serverTimestamp(), kind: 'postcards', docId: id });
    batch.set(doc(db, 'postcards', id), card(ALICE));
    batch.set(doc(db, 'drawers', ALICE.uid, 'letters', newId(db)), letter());
    await assertFails(batch.commit());
  });

  test('寄件紀錄指向別的文件，被拒', async () => {
    const db = as(ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'rate', ALICE.uid), { last: serverTimestamp(), kind: 'postcards', docId: 'someone-else' });
    batch.set(doc(db, 'postcards', newId(db)), card(ALICE));
    await assertFails(batch.commit());
  });

  test('10 秒內寄第二張，被拒', async () => {
    const db = as(ALICE);
    await assertSucceeds(sendCard(db, ALICE));
    await assertFails(sendCard(db, ALICE));
  });

  test('距離上一張只有 5 秒，被拒', async () => {
    await seed('rate/alice', { last: ago(5_000), kind: 'postcards', docId: 'old' });
    await assertFails(sendCard(as(ALICE), ALICE));
  });

  test('距離上一張超過 10 秒，可以寄出', async () => {
    await seed('rate/alice', { last: ago(11_000), kind: 'postcards', docId: 'old' });
    await assertSucceeds(sendCard(as(ALICE), ALICE));
  });

  test('冒用別人的 authorId，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { authorId: BOB.uid })));
  });

  test('寄件人名字和 Google 名字不同，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { authorName: '郵局官方' })));
  });

  test('頭像網址和 Google 頭像不同，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { authorPhoto: BOB.picture })));
  });

  test('多塞欄位，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { isAdmin: true })));
  });

  test('少了欄位，被拒', async () => {
    const { authorPhoto, ...withoutPhoto } = card(ALICE);
    await assertFails(sendCard(as(ALICE), ALICE, withoutPhoto));
  });

  test('空字串，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { text: '' })));
  });

  test('全是空白，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { text: '   \n  ' })));
  });

  test('文字不是字串，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { text: 140 })));
  });

  test('141 個字，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { text: '字'.repeat(141) })));
  });

  test('140 個中文字，可以寄出', async () => {
    await assertSucceeds(sendCard(as(ALICE), ALICE, card(ALICE, { text: '字'.repeat(140) })));
  });

  // 規則的 size() 以 UTF-16 單位計算：一個 😀 算 2
  test('70 個 emoji（140 個 UTF-16 單位），可以寄出', async () => {
    await assertSucceeds(sendCard(as(ALICE), ALICE, card(ALICE, { text: '😀'.repeat(70) })));
  });

  test('71 個 emoji（142 個 UTF-16 單位），被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { text: '😀'.repeat(71) })));
  });

  test('8 行，可以寄出', async () => {
    await assertSucceeds(sendCard(as(ALICE), ALICE, card(ALICE, { text: Array(8).fill('一行').join('\n') })));
  });

  test('9 行，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { text: Array(9).fill('一行').join('\n') })));
  });

  test('塞滿換行（繞過前端），被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { text: `x${'\n'.repeat(138)}y` })));
  });

  test('郵票不在清單裡，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { stamp: 'gold' })));
  });

  test('自己填寄出時間，被拒', async () => {
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE, { createdAt: Timestamp.now() })));
  });

  test('匿名登入，被拒', async () => {
    await assertFails(sendCard(as(ALICE, 'anonymous'), ALICE));
  });

  test('自訂 token 登入，被拒', async () => {
    await assertFails(sendCard(as(ALICE, 'custom'), ALICE));
  });

  test('未登入，被拒', async () => {
    await assertFails(sendCard(guest(), ALICE));
  });
});

// ── 前端和規則的字數算法一致 ─────────────────────────────

describe('前端和規則的字數一致', () => {
  const samples = [
    ['140 個中文字', '字'.repeat(MAX_CHARS)],
    ['141 個中文字', '字'.repeat(MAX_CHARS + 1)],
    ['70 個 emoji', '😀'.repeat(70)],
    ['71 個 emoji', '😀'.repeat(71)],
    ['國旗加中文', '🇹🇼'.repeat(30) + '字'.repeat(20)],
    ['8 行', Array(8).fill('一行').join('\n')],
    ['9 行', Array(9).fill('一行').join('\n')],
  ];
  for (const [label, text] of samples) {
    test(`${label}：前端判斷和規則結果相同`, async () => {
      const send = sendCard(as(ALICE), ALICE, card(ALICE, { text }));
      await (checkText(text).ok ? assertSucceeds(send) : assertFails(send));
    });
  }
});

// ── 修改與撤回 ───────────────────────────────────────

describe('修改與撤回', () => {
  test('寄出後不能修改', async () => {
    await seededCard(ALICE);
    await assertFails(updateDoc(doc(as(ALICE), 'postcards/card1'), { text: '改過的內容' }));
  });

  test('不能用新增的方式覆蓋已寄出的明信片', async () => {
    await seededCard(ALICE);
    await assertFails(sendCard(as(ALICE), ALICE, card(ALICE), 'card1'));
  });

  test('寄件人可以撤回', async () => {
    await seededCard(ALICE);
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'postcards/card1')));
  });

  test('別人不能撤回', async () => {
    await seededCard(ALICE);
    await assertFails(deleteDoc(doc(as(BOB), 'postcards/card1')));
  });

  test('未登入不能撤回', async () => {
    await seededCard(ALICE);
    await assertFails(deleteDoc(doc(guest(), 'postcards/card1')));
  });
});

// ── 抽屜 ────────────────────────────────────────────

describe('抽屜', () => {
  const seededLetter = () => seed('drawers/alice/letters/letter1', { text: '還不想寄的信', createdAt: ago(60_000) });

  test('主人可以把信收進抽屜', async () => {
    await assertSucceeds(saveLetter(as(ALICE), ALICE));
  });

  test('主人可以用 limit 50 列出抽屜', async () => {
    await seededLetter();
    const q = query(collection(as(ALICE), 'drawers/alice/letters'), orderBy('createdAt', 'desc'), limit(50));
    await assertSucceeds(getDocs(q));
  });

  test('主人沒有 limit 的查詢被拒', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'drawers/alice/letters')));
  });

  test('別人不能讀單封信', async () => {
    await seededLetter();
    await assertFails(getDoc(doc(as(BOB), 'drawers/alice/letters/letter1')));
  });

  test('別人不能列出抽屜', async () => {
    await seededLetter();
    await assertFails(getDocs(query(collection(as(BOB), 'drawers/alice/letters'), limit(50))));
  });

  test('未登入不能讀抽屜', async () => {
    await seededLetter();
    await assertFails(getDoc(doc(guest(), 'drawers/alice/letters/letter1')));
  });

  test('不能把信放進別人的抽屜', async () => {
    await assertFails(saveLetter(as(ALICE), ALICE, BOB.uid));
  });

  test('抽屜信超過 8 行，被拒', async () => {
    await assertFails(saveLetter(as(ALICE), ALICE, ALICE.uid, letter({ text: Array(9).fill('一行').join('\n') })));
  });

  test('抽屜信多塞欄位，被拒', async () => {
    await assertFails(saveLetter(as(ALICE), ALICE, ALICE.uid, letter({ stamp: 'vermilion' })));
  });

  test('從抽屜寄出：新增明信片並刪掉那封信', async () => {
    await seededLetter();
    const db = as(ALICE);
    const id = newId(db);
    const batch = writeBatch(db);
    batch.set(doc(db, 'rate', ALICE.uid), { last: serverTimestamp(), kind: 'postcards', docId: id });
    batch.set(doc(db, 'postcards', id), card(ALICE, { text: '還不想寄的信' }));
    batch.delete(doc(db, 'drawers', ALICE.uid, 'letters', 'letter1'));
    await assertSucceeds(batch.commit());
  });

  test('抽屜的信不能修改', async () => {
    await seededLetter();
    await assertFails(updateDoc(doc(as(ALICE), 'drawers/alice/letters/letter1'), { text: '改過' }));
  });

  test('主人可以丟掉抽屜的信', async () => {
    await seededLetter();
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'drawers/alice/letters/letter1')));
  });
});

// ── 寄件紀錄 ─────────────────────────────────────────

describe('寄件紀錄', () => {
  const seededRate = () => seed('rate/alice', { last: ago(60_000), kind: 'postcards', docId: 'old' });

  test('可以讀自己的寄件紀錄', async () => {
    await seededRate();
    await assertSucceeds(getDoc(doc(as(ALICE), 'rate/alice')));
  });

  test('不能讀別人的寄件紀錄', async () => {
    await seededRate();
    await assertFails(getDoc(doc(as(BOB), 'rate/alice')));
  });

  test('不能刪掉寄件紀錄', async () => {
    await seededRate();
    await assertFails(deleteDoc(doc(as(ALICE), 'rate/alice')));
  });

  test('單獨更新寄件紀錄可以（只會重置自己的冷卻）', async () => {
    await assertSucceeds(
      setDoc(doc(as(ALICE), 'rate/alice'), { last: serverTimestamp(), kind: 'postcards', docId: 'x' }),
    );
  });

  test('寄件紀錄多塞欄位，被拒', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), 'rate/alice'), { last: serverTimestamp(), kind: 'postcards', docId: 'x', extra: 1 }),
    );
  });

  test('寄件紀錄的 kind 不在清單裡，被拒', async () => {
    await assertFails(setDoc(doc(as(ALICE), 'rate/alice'), { last: serverTimestamp(), kind: 'rate', docId: 'x' }));
  });

  test('寄件紀錄自己填時間，被拒', async () => {
    await assertFails(setDoc(doc(as(ALICE), 'rate/alice'), { last: ago(60_000), kind: 'postcards', docId: 'x' }));
  });
});
