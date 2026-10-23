import { MAX_CHARS, MAX_LINES, COOLDOWN_MS, DRAWER_LIMIT, STAMPS, charCount, checkText, isStamp } from './shared.js';
import { renderPostcard, renderStamp, renderPostmark, formatDateTime } from './postcard.js';

const $ = (selector) => document.querySelector(selector);

const els = {
  modeLabel: $('#mode-label'),
  account: $('#account'),
  notice: $('#notice'),
  form: $('#compose'),
  text: $('#compose-text'),
  zip: $('#compose-zip'),
  zipLabel: $('#compose-zip-label'),
  zipBoxes: $('#compose-zip-boxes'),
  zipSpoken: $('#compose-zip-spoken'),
  composeAlert: $('#compose-alert'),
  stampSlot: $('#compose-stamp'),
  stampPicker: $('#stamp-picker'),
  sender: $('#compose-sender'),
  toDrawer: $('#to-drawer'),
  send: $('#send'),
  locked: $('#desk-locked'),
  lockedSignIn: $('#desk-sign-in'),
  drawer: $('#drawer'),
  letters: $('#letters'),
  drawerEmpty: $('#drawer-empty'),
  wall: $('#wall'),
  wallEmpty: $('#wall-empty'),
  wallCount: $('#wall-count'),
  wallCountSpoken: $('#wall-count-spoken'),
  wallStatus: $('#wall-status'),
  slips: $('#slips'),
  register: $('#register'),
  registerNo: $('#register-no'),
  registerName: $('#register-name'),
  registerDate: $('#register-date'),
  registerSeal: $('#register-seal'),
  registerStatus: $('#register-status'),
  registerFine: $('#register-fine'),
  registerCancel: $('#register-cancel'),
  registerGo: $('#register-go'),
  registerPopup: $('#register-popup'),
  registerDone: $('#register-done'),
  registerApproved: $('#register-approved'),
};

const state = {
  store: null,
  user: null,
  cards: [],
  letters: [],
  busy: false,
  stamp: readPref('stamp', 'vermilion'),
  oneTapSkipped: false,
  seen: new Set(),
  wallLoaded: false,
  stopDrawer: null,
  cardNodes: new Map(), // id → { key, node }，沒變的卡片沿用同一個節點，焦點才不會跑掉
  letterNodes: new Map(),
};

if (!isStamp(state.stamp)) state.stamp = 'vermilion';

boot();

async function boot() {
  wireCompose();
  renderComposeIdentity();
  renderWall();

  let config;
  try {
    config = await loadConfig();
  } catch (e) {
    closeShop(e.title ?? '讀不到 firebase-config.js', e);
    return;
  }
  try {
    state.store = config
      ? (await import('./firebase-store.js')).createFirebaseStore(config)
      : (await import('./demo-store.js')).createDemoStore();
  } catch (e) {
    closeShop('連不上 Firebase', e);
    return;
  }

  els.modeLabel.textContent = '連線中…';
  els.notice.hidden = state.store.mode !== 'demo';
  state.store.setBackgroundErrorHandler((e) => reportError(e));
  state.store.onUser(onUser);
  state.store.watchWall(onWall, (e) => {
    if (!state.wallLoaded) {
      document.body.dataset.mode = 'closed';
      els.modeLabel.textContent = '暫停營業';
    }
    reportError(e, 'read');
  });
}

// 只有在 localhost 才先找 firebase-config.local.js（不進 git），方便本機連真的 Firebase 測試。
// 127.0.0.1 不在 Firebase 預設的授權網域裡，所以不算。
async function loadConfig() {
  if (location.hostname === 'localhost') {
    try {
      const { firebaseConfig } = await import('../firebase-config.local.js');
      if (firebaseConfig) return checkConfig(firebaseConfig);
    } catch (e) {
      if (e.title) throw e;
      // 沒有本機設定檔就用一般的
    }
  }
  const { firebaseConfig } = await import('../firebase-config.js');
  return firebaseConfig ? checkConfig(firebaseConfig) : null;
}

function checkConfig(config) {
  const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((k) => !config[k]);
  if (missing.length) {
    throw Object.assign(new Error(`firebaseConfig 缺少 ${missing.join(', ')}`), { title: 'Firebase 設定不完整' });
  }
  return config;
}

function closeShop(title, error) {
  console.error(error);
  document.body.dataset.mode = 'closed';
  els.modeLabel.textContent = '暫停營業';
  showSlip({ kind: 'reject', title, body: error?.message ?? String(error), sticky: true });
}

// ── 登入狀態 ─────────────────────────────────────────

function onUser(user) {
  state.user = user;
  state.stopDrawer?.();
  state.stopDrawer = null;
  state.letters = [];
  els.drawer.hidden = !user;
  if (user) state.stopDrawer = state.store.watchDrawer(onLetters, (e) => reportError(e, 'read'));
  if (user && els.register.open && els.register.dataset.phase === 'checking') approveRegister(user);
  renderAccount();
  renderComposeIdentity();
  renderLetters();
  renderWall();
}

// LINE、Facebook、Instagram 的內建瀏覽器不允許 Google 登入（Google 會回 disallowed_useragent）
const IN_APP_BROWSER = /\bLine\/|FBAN|FBAV|Instagram/i;

// ── 寄件人登記單 ─────────────────────────────────────
// 先在郵局櫃台填登記單，按「出示 Google 帳號」才開 Google 的登入視窗；
// 登入成功後把頭像印成郵票貼上、蓋郵戳，再回到寫信桌。

function openRegister() {
  if (state.user || !state.store || els.register.open) return;
  state.oneTapSkipped = false;
  state.store.warmUpSignIn?.();
  setRegisterPhase('idle');
  els.registerNo.textContent = String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');
  els.registerDate.textContent = formatDateTime(new Date()).split(' ')[0];
  els.registerName.replaceChildren(
    Object.assign(document.createElement('span'), { className: 'register__blank', textContent: '（由 Google 帳號帶入）' }),
  );
  els.registerSeal.replaceChildren(
    Object.assign(document.createElement('span'), { className: 'stamp-slot__empty', textContent: '貼郵票處' }),
  );
  els.registerFine.textContent =
    state.store.mode === 'demo'
      ? '示範模式不會連到 Google，按下去就直接登記成示範寄件人。'
      : '在共用電腦上請用無痕視窗：登出後，瀏覽器裡仍可能留著讀過的資料。';
  els.register.showModal();
}

function setRegisterPhase(phase, status = '', { alternative = false } = {}) {
  els.register.dataset.phase = phase;
  els.registerStatus.textContent = status;
  els.registerGo.hidden = phase === 'approved';
  els.registerGo.disabled = phase === 'checking';
  els.registerGo.textContent =
    phase === 'checking' ? '查驗中…' : usesOneTap() || !state.store?.hasOneTap ? '出示 Google 帳號' : '改用 Google 視窗登入';
  els.registerPopup.hidden = !alternative;
  els.registerCancel.hidden = phase === 'approved';
  els.registerDone.hidden = phase !== 'approved';
  els.registerApproved.hidden = phase !== 'approved';
}

// 有設定 One Tap，而且這次登記還沒被略過，就先用 One Tap
const usesOneTap = () => Boolean(state.store?.hasOneTap) && !state.oneTapSkipped;

function presentId() {
  if (IN_APP_BROWSER.test(navigator.userAgent)) {
    setRegisterPhase(
      'idle',
      'LINE、Facebook 的內建瀏覽器不能用 Google 登入。請點右上角選單，改用 Chrome 或 Safari 開啟。',
    );
    return;
  }
  if (usesOneTap()) presentOneTap();
  else presentPopup();
}

async function presentOneTap() {
  setRegisterPhase('checking', '請在 Google 的帳號面板選擇帳號，櫃台查驗中……', { alternative: true });
  try {
    await state.store.signInWithOneTap();
  } catch (e) {
    if (e?.code === 'cancelled') return; // 改用彈出視窗了，或登記單已經關掉
    if (e?.code === 'one-tap-skipped') {
      state.oneTapSkipped = true;
      if (els.register.open) setRegisterPhase('idle', 'Google 的帳號面板沒有出現，或被關掉了。再按一次會改用 Google 的登入視窗。');
      return;
    }
    registerFailed(e);
  }
}

// signInWithPopup 要在點擊的同一個事件裡呼叫，彈出視窗才不會被擋，所以呼叫前不能 await
async function presentPopup() {
  state.store.cancelOneTap?.();
  setRegisterPhase('checking', '請在 Google 的視窗選擇帳號，櫃台查驗中……');
  try {
    await state.store.signIn();
  } catch (e) {
    if (e?.code === 'cancelled' && els.register.open) {
      setRegisterPhase('idle', '沒關係，準備好再出示一次。');
      return;
    }
    registerFailed(e);
  }
}

function registerFailed(e) {
  if (!els.register.open) {
    reportError(e);
    return;
  }
  console.error(e);
  const { title, body } = messageFor(e);
  setRegisterPhase('idle', `${title}：${body}`);
}

function approveRegister(user) {
  const name = user.name || '無名寄件人';
  const ink = document.createElement('span');
  ink.className = 'register__ink';
  ink.textContent = name;
  els.registerName.replaceChildren(ink);
  els.registerSeal.replaceChildren(
    renderStamp({ stamp: state.stamp, name: user.name, photo: user.photo, specimen: state.store.mode === 'demo' }),
    renderPostmark(new Date()),
  );
  setRegisterPhase('approved', `登記完成。歡迎，${name}。`);
  els.registerDone.focus();
}

function closedRegister() {
  const approved = els.register.dataset.phase === 'approved';
  state.store.cancelOneTap?.();
  setRegisterPhase('idle');
  if (!approved || !state.user) return;
  // 剛印好的郵票貼到寫信桌上
  const slot = els.stampSlot;
  slot.classList.remove('is-arriving');
  void slot.offsetWidth;
  slot.classList.add('is-arriving');
  slot.addEventListener('animationend', () => slot.classList.remove('is-arriving'), { once: true });
  els.text.focus();
}

async function signOut() {
  try {
    await state.store.signOut();
  } catch (e) {
    reportError(e);
  }
}

function renderAccount() {
  const box = els.account;
  box.replaceChildren();
  if (!state.store) return;
  if (!state.user) {
    box.append(makeButton('btn btn--ink', '登記寄件人', openRegister));
    return;
  }
  const who = document.createElement('span');
  who.className = 'account__who';
  const name = document.createElement('span');
  name.className = 'account__name';
  name.textContent = state.user.name || '無名寄件人';
  who.append(renderStamp({ stamp: state.stamp, name: state.user.name, photo: state.user.photo, size: 'mini' }), name);
  box.append(who, makeButton('btn btn--quiet', '登出', signOut));
}

// ── 寫明信片 ─────────────────────────────────────────

function wireCompose() {
  els.text.addEventListener('input', updateCounter);
  els.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });
  // 在郵票選項上按 Enter 不要直接寄出
  els.form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.type === 'radio') e.preventDefault();
  });
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendCompose();
  });
  els.toDrawer.addEventListener('click', saveCompose);
  els.lockedSignIn.addEventListener('click', openRegister);
  els.registerGo.addEventListener('click', presentId);
  els.registerPopup.addEventListener('click', presentPopup);
  els.register.addEventListener('close', closedRegister);
  for (const radio of els.form.elements.stamp) {
    radio.checked = radio.value === state.stamp;
    radio.addEventListener('change', () => {
      state.stamp = radio.value;
      writePref('stamp', radio.value);
      renderComposeIdentity();
      renderAccount();
      renderLetters();
    });
  }
  updateCounter();
}

function renderComposeIdentity() {
  const user = state.user;
  els.locked.hidden = Boolean(user) || !state.store;
  els.text.disabled = !user;
  els.stampPicker.disabled = !user;
  els.sender.textContent = user ? user.name || '無名寄件人' : '尚未登記';
  els.stampSlot.replaceChildren(
    user
      ? renderStamp({ stamp: state.stamp, name: user.name, photo: user.photo, specimen: state.store?.mode === 'demo' })
      : Object.assign(document.createElement('span'), { className: 'stamp-slot__empty', textContent: '貼郵票處' }),
  );
  updateCounter();
}

function updateCounter() {
  const check = checkText(els.text.value);
  const left = MAX_CHARS - charCount(check.text);
  const tooManyLines = check.reason === 'lines';
  const over = left < 0 || tooManyLines;
  els.zip.classList.toggle('is-over', over);
  els.zipLabel.textContent = left < 0 ? '超過' : '還能寫';
  renderZip(els.zipBoxes, Math.abs(left));
  els.zipSpoken.textContent = tooManyLines
    ? `超過 ${MAX_LINES} 行`
    : left < 0
      ? `超過 ${-left} 字`
      : `還能寫 ${left} 字`;
  // 剛超過的那一刻才讓螢幕閱讀器主動念出來，平常打字不要一直插話
  if (String(over) !== els.zip.dataset.wasOver) {
    els.composeAlert.textContent = over ? els.zipSpoken.textContent : '';
    els.zip.dataset.wasOver = String(over);
  }
  const ready = check.ok && Boolean(state.user) && !state.busy;
  els.send.disabled = !ready;
  els.toDrawer.disabled = !ready;
}

// 郵遞區號方格：固定三格；還沒有數字時顯示橫線
function renderZip(container, number) {
  const digits = number === null ? '---' : String(Math.min(number, 999)).padStart(3, '0');
  container.replaceChildren(
    ...Array.from(digits, (d) => Object.assign(document.createElement('span'), { textContent: d })),
  );
}

async function sendCompose() {
  const sent = els.text.value;
  const { ok, text } = checkText(sent);
  if (!ok || state.busy) return;
  const result = await runBusy(els.send, '寄送中…', () => state.store.sendPostcard({ text, stamp: state.stamp }));
  if (!result) return;
  clearCompose(sent);
  showSlip(
    result.value?.queued
      ? { kind: 'info', title: '已排進待寄', body: '現在沒有網路，連上後會自動寄出。' }
      : { kind: 'ok', title: '已寄出', body: '明信片貼上公佈牆了。' },
  );
}

async function saveCompose() {
  const sent = els.text.value;
  const { ok, text } = checkText(sent);
  if (!ok || state.busy) return;
  if (state.letters.length >= DRAWER_LIMIT) {
    showSlip({ kind: 'reject', title: '抽屜滿了', body: `抽屜最多放 ${DRAWER_LIMIT} 封，先寄出或丟掉幾封吧。` });
    return;
  }
  const result = await runBusy(els.toDrawer, '收進抽屜…', () => state.store.saveLetter({ text }));
  if (!result) return;
  clearCompose(sent);
  showSlip(
    result.value?.queued
      ? { kind: 'info', title: '已排進待寄', body: '現在沒有網路，連上後會自動收進抽屜。' }
      : { kind: 'info', title: '放進抽屜了', body: '只有你看得到，想寄的時候再寄。' },
  );
}

// 寄送期間又打了字，就保留文字框不清空
function clearCompose(sent) {
  if (els.text.value === sent) els.text.value = '';
  updateCounter();
  els.text.focus();
}

// 執行寫入，期間鎖住所有寫入按鈕。成功回傳 { value }，失敗回傳 null
async function runBusy(button, label, action) {
  const original = button.textContent;
  state.busy = true;
  button.textContent = label;
  setWriteButtonsDisabled(true);
  try {
    return { value: await action() };
  } catch (e) {
    reportError(e);
    return null;
  } finally {
    state.busy = false;
    button.textContent = original;
    setWriteButtonsDisabled(false);
    updateCounter();
    // 按鈕被停用時焦點會掉到 body，還給原本的按鈕
    if (button.isConnected && (!document.activeElement || document.activeElement === document.body)) button.focus();
  }
}

function setWriteButtonsDisabled(disabled) {
  els.send.disabled = disabled;
  els.toDrawer.disabled = disabled;
  for (const b of els.letters.querySelectorAll('[data-write]')) b.disabled = disabled;
}

// 刪除類的按鈕要按兩次：第一次變成「確定？」，4 秒內再按才執行
function confirmClick(button, confirmLabel, action) {
  const reset = () => {
    clearTimeout(Number(button.dataset.timer));
    button.dataset.armed = 'false';
    button.textContent = button.dataset.original;
  };
  if (button.dataset.armed === 'true') {
    reset();
    button.disabled = true;
    Promise.resolve(action()).finally(() => {
      button.disabled = false;
    });
    return;
  }
  button.dataset.original = button.textContent;
  button.dataset.armed = 'true';
  button.textContent = confirmLabel;
  button.dataset.timer = String(setTimeout(reset, 4000));
}

// 只動有變化的節點：沒變的節點留在原位，焦點和「確定？」狀態都會保留
function syncChildren(parent, nodes) {
  const wanted = new Set(nodes);
  for (const child of [...parent.children]) if (!wanted.has(child)) child.remove();
  nodes.forEach((node, i) => {
    if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
  });
}

function keyedNodes(cache, items, keyOf, build) {
  const live = new Set();
  const nodes = items.map((item) => {
    live.add(item.id);
    const key = keyOf(item);
    const hit = cache.get(item.id);
    if (hit && hit.key === key) return hit.node;
    const node = build(item);
    cache.set(item.id, { key, node });
    return node;
  });
  for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
  return nodes;
}

// ── 抽屜 ────────────────────────────────────────────

function onLetters(letters) {
  state.letters = letters;
  renderLetters();
}

function renderLetters() {
  const nodes = keyedNodes(
    state.letterNodes,
    state.letters,
    (l) => `${l.pending}|${l.text}|${state.stamp}`,
    buildLetter,
  );
  syncChildren(els.letters, nodes);
  els.drawerEmpty.hidden = state.letters.length > 0;
}

function buildLetter(letter) {
  const li = document.createElement('li');
  li.className = 'letter';
  if (letter.pending) li.classList.add('is-pending');

  const text = document.createElement('p');
  text.className = 'letter__text';
  text.textContent = letter.text;

  const meta = document.createElement('time');
  meta.className = 'letter__time';
  meta.dateTime = letter.createdAt.toISOString();
  meta.textContent = `收進抽屜 ${formatDateTime(letter.createdAt)}`;

  const actions = document.createElement('div');
  actions.className = 'letter__actions';
  const send = makeButton('btn btn--stamp btn--small', `貼${STAMPS[state.stamp].name}郵票寄出`, async () => {
    const result = await runBusy(send, '寄送中…', () => state.store.sendLetter(letter, state.stamp));
    if (!result) return;
    showSlip(
      result.value?.queued
        ? { kind: 'info', title: '已排進待寄', body: '現在沒有網路，連上後會自動寄出。' }
        : { kind: 'ok', title: '已寄出', body: '這封信貼上公佈牆了。' },
    );
  });
  send.dataset.write = 'true';
  send.disabled = state.busy;
  const discard = makeButton('btn btn--quiet', '丟掉', () =>
    confirmClick(discard, '確定丟掉？', async () => {
      try {
        await state.store.discardLetter(letter.id);
      } catch (e) {
        reportError(e);
      }
    }),
  );
  actions.append(send, discard);
  li.append(text, meta, actions);
  return li;
}

// ── 公佈牆 ──────────────────────────────────────────

function onWall(cards) {
  if (!state.wallLoaded) {
    document.body.dataset.mode = state.store.mode;
    els.modeLabel.textContent = state.store.mode === 'demo' ? '示範模式' : '營業中';
  }
  state.cards = cards;
  renderWall({ fromSnapshot: true });
}

function renderWall({ fromSnapshot = false } = {}) {
  const specimen = state.store?.mode === 'demo';
  const arrivals = [];
  const isMine = (card) => Boolean(state.user) && card.authorId === state.user.uid;
  const nodes = keyedNodes(
    state.cardNodes,
    state.cards,
    (c) => [c.pending, isMine(c), specimen, c.text, c.stamp, c.authorName, c.authorPhoto, +c.createdAt].join('|'),
    (card) => {
      const isNew = fromSnapshot && state.wallLoaded && !state.seen.has(card.id);
      if (isNew && !isMine(card)) arrivals.push(card);
      return renderPostcard(card, {
        mine: isMine(card),
        specimen,
        isNew,
        onWithdraw: (c, button) =>
          confirmClick(button, '確定撤回？', async () => {
            try {
              await state.store.withdrawPostcard(c.id);
            } catch (e) {
              reportError(e);
            }
          }),
      });
    },
  );
  if (fromSnapshot) {
    for (const card of state.cards) state.seen.add(card.id);
    state.wallLoaded = true;
  }
  syncChildren(els.wall, nodes);
  els.wallEmpty.hidden = !state.wallLoaded || state.cards.length > 0;
  renderZip(els.wallCount, state.wallLoaded ? state.cards.length : null);
  els.wallCountSpoken.textContent = state.wallLoaded ? `牆上 ${state.cards.length} 張` : '公佈牆載入中';
  if (arrivals.length === 1) {
    els.wallStatus.textContent = `新明信片：${arrivals[0].authorName || '無名寄件人'}寄來「${arrivals[0].text.slice(0, 40)}」`;
  } else if (arrivals.length > 1) {
    els.wallStatus.textContent = `公佈牆新增 ${arrivals.length} 張明信片`;
  }
}

// ── 退件單（錯誤與通知） ───────────────────────────────

const INVALID_REASONS = {
  empty: '明信片至少要寫一個字。',
  long: `明信片最多 ${MAX_CHARS} 個字。`,
  lines: `明信片最多 ${MAX_LINES} 行。`,
  stamp: '請選一張郵票。',
};

function messageFor(e, context) {
  switch (e?.code) {
    case 'cooldown':
      return {
        title: '郵差還在路上',
        body: `每 ${COOLDOWN_MS / 1000} 秒只能寄一次，請 ${Math.ceil((e.waitMs ?? COOLDOWN_MS) / 1000)} 秒後再試。`,
      };
    case 'queued':
      return { title: '上一張還在排隊', body: '沒有網路時寫入會先排隊，連上後自動寄出。請等它寄出後再寫下一張。' };
    case 'invalid':
      return { title: '內容不符規定', body: INVALID_REASONS[e.message] ?? '請檢查內容後再寄。' };
    case 'denied':
      return context === 'read'
        ? {
            title: '讀不到資料',
            body: '請確認 firestore.rules 已發布到 Firebase，而且 Cloud Firestore 已經建立。',
          }
        : { title: '被郵局退件', body: '這次寫入不符合 Security Rules。請確認已登入，或重新登入後再試。' };
    case 'quota':
      return { title: '今天的免費額度用完了', body: 'Firebase Spark 方案每天有讀寫上限，明天就會恢復。' };
    case 'offline':
      return { title: '暫時連不上郵局', body: '網路恢復後會自動重新連線。' };
    case 'auth-domain':
      return {
        title: '這個網址還不能登入',
        body: `請到 Firebase Console → Authentication → Settings → Authorized domains 加入 ${location.hostname}。`,
      };
    case 'popup-blocked':
      return { title: '登入視窗被擋住了', body: '請允許這個網站開啟彈出式視窗，再按一次登記。' };
    case 'provider-off':
      return { title: 'Google 登入還沒開啟', body: '請到 Firebase Console → Authentication → Sign-in method 啟用 Google。' };
    case 'config':
      return { title: 'Firebase 設定有誤', body: '請檢查 FIREBASE_* 變數的值是否和 Firebase Console 上的一致。' };
    case 'no-db':
      return { title: '找不到 Firestore 資料庫', body: '請到 Firebase Console 建立 Firestore（建議選 asia-east1 台灣）。' };
    default:
      return { title: '出了點狀況', body: e?.message ?? String(e) };
  }
}

function reportError(e, context) {
  if (e?.code === 'cancelled') return;
  if (!['cooldown', 'invalid', 'queued'].includes(e?.code)) console.error(e);
  showSlip({ kind: 'reject', ...messageFor(e, context) });
}

const SLIP_MARK = { reject: '退件', ok: '已收件', info: '通知' };

function showSlip({ kind, title, body, sticky = false }) {
  const slip = document.createElement('div');
  slip.className = `slip slip--${kind}`;
  slip.setAttribute('role', kind === 'reject' ? 'alert' : 'status');
  if (sticky) slip.dataset.sticky = 'true';

  const mark = document.createElement('span');
  mark.className = 'slip__mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = SLIP_MARK[kind];
  const heading = document.createElement('p');
  heading.className = 'slip__title';
  heading.textContent = title;
  const text = document.createElement('p');
  text.className = 'slip__body';
  text.textContent = body;
  const close = makeButton('slip__close', '×', () => slip.remove());
  close.setAttribute('aria-label', '關閉');

  slip.append(mark, heading, text, close);
  els.slips.append(slip);
  // 最多同時 3 張；常駐的（例如暫停營業）不擠掉
  const removable = [...els.slips.children].filter((s) => s.dataset.sticky !== 'true');
  for (const old of removable.slice(0, Math.max(0, els.slips.children.length - 3))) old.remove();
  if (!sticky) setTimeout(() => slip.remove(), kind === 'reject' ? 9000 : 4500);
}

// ── 小工具 ─────────────────────────────────────────

function makeButton(className, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function readPref(key, fallback) {
  try {
    return localStorage.getItem(`postoffice:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(`postoffice:${key}`, value);
  } catch {
    // 存不了偏好也沒關係
  }
}
