// 啟動 Firestore emulator 跑 tests/firestore.rules.test.mjs，跑完關掉 emulator。
// Windows 上 firebase-tools 是透過 shell 啟動 emulator 的 java 程序，結束時只關掉 shell，
// java 會一直占著 port 8080，下次執行就會失敗。所以前後都把「這個專案的 emulator」關掉：
// 只比對命令列同時含 cloud-firestore-emulator 和 --project_id demo-postoffice 的 java 程序，不會動到別的程式。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT = 'demo-postoffice';
const root = fileURLToPath(new URL('..', import.meta.url));
const firebaseCli = fileURLToPath(new URL('../node_modules/firebase-tools/lib/bin/firebase.js', import.meta.url));

function stopLeftoverEmulator() {
  if (process.platform !== 'win32') return;
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name = 'java.exe'\"",
    `Where-Object { $_.CommandLine -like '*cloud-firestore-emulator*--project_id ${PROJECT}*' }`,
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output \"stopped leftover emulator (PID $($_.ProcessId))\" }",
  ].join(' | ');
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });
}

stopLeftoverEmulator();
const result = spawnSync(
  process.execPath,
  [
    firebaseCli,
    'emulators:exec',
    '--only',
    'firestore',
    '--project',
    PROJECT,
    '--non-interactive',
    // 兩個檔案依序跑：備份測試會清空 emulator，不能和規則測試同時進行
    'node --test tests/firestore.rules.test.mjs && node --test tests/backup-restore.test.mjs',
  ],
  { cwd: root, stdio: 'inherit' },
);
stopLeftoverEmulator();
process.exit(result.status ?? 1);
