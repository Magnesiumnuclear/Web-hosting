// 前端和 firestore.rules 共用的限制。140 字、8 行、10 秒要和規則相同；
// WALL_LIMIT／DRAWER_LIMIT 不能超過規則的 50／100（比較小沒關係，還能省讀取額度）。
export const MAX_CHARS = 140;
export const MAX_LINES = 8;
export const COOLDOWN_MS = 10_000;
export const WALL_LIMIT = 40;
export const DRAWER_LIMIT = 50;

export const STAMPS = {
  vermilion: { name: '朱紅', value: '5' },
  indigo: { name: '靛藍', value: '10' },
  moss: { name: '苔綠', value: '20' },
};

// 和規則的 string.size() 一樣以 UTF-16 單位計數（已用 emulator 測過，見 tests/）：
// 中文字算 1，emoji 多半算 2，國旗、膚色這類組合 emoji 更多。
export function charCount(s) {
  return s.length;
}

const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

// 換行統一成 \n，連續空行最多留一行；至少要有一個看得見的字，最多 8 行
export function checkText(raw) {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!VISIBLE.test(text)) return { ok: false, text, reason: 'empty' };
  if (charCount(text) > MAX_CHARS) return { ok: false, text, reason: 'long' };
  if (text.split('\n').length > MAX_LINES) return { ok: false, text, reason: 'lines' };
  return { ok: true, text };
}

export function isStamp(value) {
  return Object.hasOwn(STAMPS, value);
}

export class StoreError extends Error {
  constructor(code, message = code, detail = {}) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    Object.assign(this, detail);
  }
}

export const str = (v) => (typeof v === 'string' ? v : '');

// 頭像網址只接受 https，其餘一律當作沒有頭像
export function httpsOnly(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}
