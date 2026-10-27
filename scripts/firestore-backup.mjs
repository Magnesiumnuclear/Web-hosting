// 把 Firestore 裡的三個集合（postcards、drawers/*/letters、rate）倒成一個 JSON 檔。
// Spark 方案不能用 Firestore 的官方匯出（要 Blaze），所以用 Admin SDK 自己讀。
//
//   用法：node scripts/firestore-backup.mjs [輸出資料夾]      預設 backups/
//   需要：GOOGLE_APPLICATION_CREDENTIALS 指向服務帳戶金鑰（見 README「備份與還原」）
//   設定 FIRESTORE_EMULATOR_HOST 時會改讀本機 emulator（tests/backup-restore.test.mjs 用）
//
// 檔案格式：{ version, exportedAt, projectId, docs: [{ path, data }] }
// Timestamp 轉成 { __type: 'timestamp', value: ISO 字串 }，還原時再轉回來。
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, toPlain } from './firestore-admin.mjs';

const COLLECTION_GROUPS = ['postcards', 'letters', 'rate'];

export async function dump(db) {
  const docs = [];
  for (const group of COLLECTION_GROUPS) {
    const snap = await db.collectionGroup(group).get();
    for (const doc of snap.docs) docs.push({ path: doc.ref.path, data: toPlain(doc.data()) });
  }
  docs.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { version: 1, exportedAt: new Date().toISOString(), projectId: db.projectId, docs };
}

async function main() {
  const outDir = process.argv[2] ?? 'backups';
  const db = getDb();
  const backup = await dump(db);
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `firestore-${backup.exportedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(backup, null, 2));
  const count = (g) => backup.docs.filter((d) => d.path.split('/').at(-2) === g).length;
  console.log(`已備份 ${backup.docs.length} 份文件到 ${file}`);
  console.log(`  公佈牆 ${count('postcards')} 張、抽屜 ${count('letters')} 封、寄件紀錄 ${count('rate')} 份`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
