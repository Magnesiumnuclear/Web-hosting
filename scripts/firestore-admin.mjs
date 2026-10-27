// 備份與還原共用：連 Firestore（真的專案或 emulator），以及 Timestamp 和 JSON 之間的轉換。
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

export function getDb() {
  if (!getApps().length) {
    const emulator = process.env.FIRESTORE_EMULATOR_HOST;
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (emulator) {
      initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'demo-postoffice' });
    } else if (keyFile) {
      const key = JSON.parse(readFileSync(keyFile, 'utf8'));
      initializeApp({ credential: cert(key), projectId: key.project_id });
    } else {
      throw new Error('請設定 GOOGLE_APPLICATION_CREDENTIALS 指向服務帳戶金鑰（或 FIRESTORE_EMULATOR_HOST 連本機 emulator）');
    }
  }
  // db.projectId 是 Firestore 自己提供的，備份檔用它記下來源，還原時可以比對
  return getFirestore();
}

export function toPlain(value) {
  if (value instanceof Timestamp) return { __type: 'timestamp', value: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
  }
  return value;
}

export function fromPlain(value) {
  if (value && typeof value === 'object') {
    if (value.__type === 'timestamp') return Timestamp.fromDate(new Date(value.value));
    if (Array.isArray(value)) return value.map(fromPlain);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromPlain(v)]));
  }
  return value;
}
