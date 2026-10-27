// 把 scripts/firestore-backup.mjs 倒出來的 JSON 寫回 Firestore。
//
//   用法：node scripts/firestore-restore.mjs backups/firestore-xxx.json [--wipe]
//   --wipe：還原前先刪掉三個集合裡現有的所有文件（備份裡沒有的也會被刪）。不加就只覆蓋同路徑的文件。
//   需要：GOOGLE_APPLICATION_CREDENTIALS；設定 FIRESTORE_EMULATOR_HOST 時寫進本機 emulator。
//
// Admin SDK 不受 Security Rules 限制，所以 createdAt 這種「必須等於 request.time」的欄位也能原樣寫回。
import { readFile } from 'node:fs/promises';
import { getDb, fromPlain } from './firestore-admin.mjs';

const COLLECTION_GROUPS = ['postcards', 'letters', 'rate'];
const BATCH = 400; // Firestore 一個批次最多 500 筆

async function commitInBatches(db, items, apply) {
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = db.batch();
    for (const item of items.slice(i, i + BATCH)) apply(batch, item);
    await batch.commit();
  }
}

export async function wipe(db) {
  const refs = [];
  for (const group of COLLECTION_GROUPS) {
    const snap = await db.collectionGroup(group).select().get();
    refs.push(...snap.docs.map((d) => d.ref));
  }
  await commitInBatches(db, refs, (batch, ref) => batch.delete(ref));
  return refs.length;
}

export async function restore(db, backup) {
  if (backup.version !== 1 || !Array.isArray(backup.docs)) throw new Error('不是這個腳本認得的備份檔');
  await commitInBatches(db, backup.docs, (batch, { path, data }) => batch.set(db.doc(path), fromPlain(data)));
  return backup.docs.length;
}

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) {
    console.error('用法：node scripts/firestore-restore.mjs <備份檔.json> [--wipe]');
    process.exit(2);
  }
  const backup = JSON.parse(await readFile(file, 'utf8'));
  const db = getDb();
  if (backup.projectId && backup.projectId !== db.projectId) {
    console.error(`備份來自專案 ${backup.projectId}，現在要寫進 ${db.projectId}。確定的話把備份檔裡的 projectId 改掉再跑。`);
    process.exit(2);
  }
  if (flag === '--wipe') console.log(`先清掉 ${await wipe(db)} 份現有文件`);
  console.log(`還原了 ${await restore(db, backup)} 份文件到 ${db.projectId}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
