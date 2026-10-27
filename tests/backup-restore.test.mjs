// 在 emulator 上真的試一次：塞資料 → 備份 → 清空 → 還原 → 比對一模一樣。
// 由 tests/run-rules-tests.mjs 和規則測試一起跑（emulator 已經開著）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';
import { getDb } from '../scripts/firestore-admin.mjs';
import { dump } from '../scripts/firestore-backup.mjs';
import { restore, wipe } from '../scripts/firestore-restore.mjs';

const scripts = (name) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));

test('備份後清空再還原，資料一模一樣', async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, '要在 emulator 上跑');
  const db = getDb();
  await wipe(db);

  const t = Timestamp.fromDate(new Date('2026-10-23T09:16:00Z'));
  const seeds = {
    'postcards/p1': { text: '走回小巷，穿回記憶', stamp: 'indigo', authorId: 'alice', authorName: 'Alice', authorPhoto: 'https://example.com/a', createdAt: t },
    'postcards/p2': { text: '第二張 🎉', stamp: 'moss', authorId: 'bob', authorName: 'Bob', authorPhoto: '', createdAt: t },
    'drawers/alice/letters/l1': { text: '還沒寄的', createdAt: t },
    'rate/alice': { last: t, kind: 'letters', docId: 'l1' },
  };
  for (const [path, data] of Object.entries(seeds)) await db.doc(path).set(data);

  // 用命令列的方式跑一次備份，確認整支腳本能跑
  const dir = await mkdtemp(join(tmpdir(), 'postoffice-backup-'));
  const run = spawnSync(process.execPath, [scripts('firestore-backup.mjs'), dir], { encoding: 'utf8', env: process.env });
  assert.equal(run.status, 0, run.stderr);
  const file = run.stdout.match(/到 (\S+\.json)/)?.[1];
  assert.ok(file, run.stdout);
  const backup = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(backup.docs.length, 4);
  assert.deepEqual(backup.docs.map((d) => d.path), Object.keys(seeds).sort());
  assert.deepEqual(backup.docs[0].data.createdAt, { __type: 'timestamp', value: '2026-10-23T09:16:00.000Z' });

  assert.equal(await wipe(db), 4);
  assert.equal((await db.collectionGroup('postcards').get()).size, 0);

  assert.equal(await restore(db, backup), 4);
  for (const [path, data] of Object.entries(seeds)) {
    const snap = await db.doc(path).get();
    assert.ok(snap.exists, `${path} 沒還原回來`);
    const got = snap.data();
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof Timestamp) assert.ok(got[k].isEqual(v), `${path}.${k} 時間不同`);
      else assert.equal(got[k], v, `${path}.${k} 不同`);
    }
  }
  // 再備份一次，內容要和第一次相同
  const again = await dump(db);
  assert.deepEqual(again.docs, backup.docs);
  await rm(dir, { recursive: true });
  await wipe(db);
});
