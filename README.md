# 街角郵局

寄一張明信片給路過的人。這是 **GitHub Pages ＋ Firebase Spark（免費方案）** 的範例專案：

- **固定網址**：`https://<你的帳號>.github.io/<repo 名稱>/`
- **後端資料庫**：Cloud Firestore（即時更新）
- **登入**：Firebase Authentication 的 Google 登入
- **權限**：全部寫在 [`firestore.rules`](firestore.rules)，前端沒有任何密鑰
- **部署**：push 到 `main`，GitHub Actions 自動發布
- **網站不需要 npm、不需要建置**：純 HTML / CSS / JavaScript，Firebase SDK 從 Google 官方 CDN 載入
- **規則有自動測試**：`npm run test:rules` 在本機的 Firestore emulator 上跑 65 項測試（npm 只用在這裡）

還沒設定 Firebase 時，網站會以**示範模式**運作（資料只存在瀏覽器），可以先看介面。

```
瀏覽器（GitHub Pages 的靜態檔案）
   │  Google 登入
   ├──────────────► Firebase Authentication
   │  讀寫資料（帶著登入身分）
   └──────────────► Cloud Firestore ── Security Rules 決定放不放行
```

## 網站有什麼

| 區塊 | 資料位置 | 誰能讀 | 誰能寫 |
|---|---|---|---|
| 公佈牆 | `postcards/{id}` | 所有人 | 登入者新增；只有寄件人能撤回；寄出後不能改 |
| 我的抽屜 | `drawers/{uid}/letters/{id}` | 只有本人 | 只有本人 |
| 寄件紀錄 | `rate/{uid}` | 只有本人 | 只有本人，用來做 10 秒冷卻 |

## 1. 先在本機看示範模式

ES module 不能用 `file://` 開，要用本機伺服器（Python 內建的就可以）：

```bash
py -3.13 -m http.server 8000 --directory site
```

打開 <http://localhost:8000>。

## 2. 建立 Firebase 專案（Spark 免費方案，不用綁卡）

1. 到 [Firebase Console](https://console.firebase.google.com/) 新增專案（Google Analytics 可以關掉）。
2. **Authentication** → 開始使用 → **Sign-in method** → 啟用 **Google**，填支援電子郵件。
3. **Firestore Database** → 建立資料庫：
   - 位置建議選 **`asia-east1`（台灣）**，建立後不能改。
   - 選**正式版模式（production mode）**。
4. Firestore → **規則（Rules）** → 把 [`firestore.rules`](firestore.rules) 的內容整份貼上 → **發布**。
5. 專案設定（齒輪）→ 一般 → 你的應用程式 → 新增 **網頁應用程式（`</>`）**。不用勾 Firebase Hosting。記下設定裡的 `apiKey`、`authDomain`、`projectId`、`appId`。

> 不要升級成 Blaze，也不要開 Cloud Storage（2026-02-03 起 Storage 需要 Blaze 方案）。這個專案只用 Auth 和 Firestore。

## 3. 放上 GitHub

1. 在 GitHub 建立**公開** repo（免費帳號的 Pages 只能用公開 repo；Copilot Pro 不包含 GitHub Pro 的私有 repo Pages）。
2. 把這個資料夾 push 到 `main`。workflow 只在 `main` 觸發，Windows 的 Git 預設分支可能是 `master`，所以要先改名：

   ```bash
   git init
   git add .
   git commit -m "街角郵局"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/<repo 名稱>.git
   git push -u origin main
   ```

   這時 Pages 還沒設定，第一次 workflow 會失敗（紅叉），做完下面幾步再重跑就好。
3. repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
4. **Settings → Secrets and variables → Actions → Variables** 分頁，新增 4 個 **repository variables**（是 Variables 不是 Secrets）：

   | 名稱 | 值（從第 2 步第 5 點複製） |
   |---|---|
   | `FIREBASE_API_KEY` | `apiKey` |
   | `FIREBASE_AUTH_DOMAIN` | `authDomain`（像 `xxx.firebaseapp.com`） |
   | `FIREBASE_PROJECT_ID` | `projectId` |
   | `FIREBASE_APP_ID` | `appId` |

5. **Actions** 分頁 → `Deploy to GitHub Pages` → **Run workflow**（之後每次 push 到 `main` 都會自動部署）。
6. 回到 Firebase Console → **Authentication → Settings → Authorized domains** → 新增 `<你的帳號>.github.io`。

完成後打開 `https://<你的帳號>.github.io/<repo 名稱>/`。左側招牌從「連線中…」變成「營業中」，代表已經讀得到 Firestore。要確認整條路都通：登入、寄一張明信片，再用另一個瀏覽器（或無痕視窗）打開，看得到那張就成功了。

## 4. 建議：限制 API 金鑰能用的網站

Firebase 的 `apiKey` 是公開的識別碼，不是密碼，放在網站上是正常的；真正保護資料的是 Security Rules。但仍建議限制它只能從你的網站使用，避免被拿去別處消耗額度：

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) → 選同一個專案 → API 和服務 → 憑證 → 點 Firebase 自動建立的 **Browser key** → 應用程式限制選 **網站**，加入：

- `https://<你的帳號>.github.io/*`
- `https://<projectId>.firebaseapp.com/*`（Google 登入的彈出視窗會用到）
- `http://localhost:8000/*`（本機測試用，不需要可以不加）

## 5. 選用：Google One Tap 登入

預設登入會開 Google 的彈出視窗，手機上會切到 `accounts.google.com` 的分頁。設定 One Tap 後，支援 FedCM 的瀏覽器（例如 Android 的 Chrome）改成從畫面下方滑出系統的帳號面板，不用離開網站；面板沒出現或被關掉時，登記單會改用原本的彈出視窗。iPhone 和其他瀏覽器照舊用彈出視窗。

1. Firebase Console → **Authentication → Sign-in method → Google** → 展開 **網頁 SDK 設定**，複製 **網頁用戶端 ID**（像 `123…-xxx.apps.googleusercontent.com`）。
2. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → 選同一個專案 → 憑證 → **OAuth 2.0 用戶端 ID** 裡的 **Web client (auto created by Google Service)** → **已授權的 JavaScript 來源** 加入 `https://<你的帳號>.github.io`（本機測試再加 `http://localhost` 和 `http://localhost:8000`）→ 儲存。生效可能要幾分鐘。
3. GitHub repo 的 **Settings → Secrets and variables → Actions → Variables** 新增 `FIREBASE_GOOGLE_CLIENT_ID`，值是第 1 點的用戶端 ID，然後重跑 `Deploy to GitHub Pages`。

不設定這個變數就維持彈出視窗。本機測試要用 One Tap，在 `firebase-config.local.js` 加上 `googleClientId: '...'`。

One Tap 拿到的 Google ID token 會用 `signInWithCredential` 換成 Firebase 登入，`sign_in_provider` 一樣是 `google.com`，`name`、`picture` 也一樣，規則不用改。使用者關掉面板後，Chrome 會有一段冷卻時間不再顯示面板，這段時間會直接改用彈出視窗。

## Security Rules 做了什麼

| 規則 | 擋下什麼 |
|---|---|
| 只接受 `sign_in_provider == 'google.com'` | 就算之後開了匿名登入，匿名帳號也不能寫 |
| `authorId == request.auth.uid` | 不能用別人的身分寄信 |
| `authorName`、`authorPhoto` 必須等於 ID token 的 `name`、`picture` | 不能冒用別人的名字或頭像 |
| `keys().hasOnly(...)` ＋ `hasAll(...)` | 不能多塞欄位、也不能少欄位 |
| 文字 1–140 字、不能全是空白、最多 8 行；郵票只能三選一 | 塞超長內容、用一堆換行把卡片撐高、奇怪的值 |
| `createdAt == request.time` | 不能偽造寄出時間 |
| 每次新增都要在同一批次把 `rate/{uid}` 寫成「這次的時間＋這次新增的文件」，且和上次至少隔 10 秒 | 一個批次塞很多張來洗版、短時間內吃光每日寫入額度 |
| 公佈牆一次最多讀 50 張、抽屜 100 封 | 一次把整個集合讀光 |
| 明信片 `update: false`；只有寄件人能 `delete` | 寄出後改內容、刪別人的明信片 |
| 抽屜路徑的 `{uid}` 必須是本人 | 讀別人的抽屜 |

改了 [`firestore.rules`](firestore.rules) 的數字，也要改 [`site/js/shared.js`](site/js/shared.js)：140 字、8 行、10 秒兩邊要相同；前端一次讀的張數（`WALL_LIMIT` 40、`DRAWER_LIMIT` 50）不能超過規則的 50／100，比較小沒關係，還能省讀取額度。

字數的算法：規則的 `size()` 以 UTF-16 單位計算（已用 emulator 測過），中文字算 1，emoji 多半算 2，國旗這類組合 emoji 更多。前端計數器用同樣的算法，所以畫面上「還能寫幾個字」和規則一致。前端另外要求至少一個看得見的字，連續空行會縮成一行。

改完規則先跑一次 `npm run test:rules`（見下一節），再重新貼到 Firebase Console 發布。也可以用專案裡裝好的 Firebase CLI 發布（需要先登入你的 Google 帳號）：

```bash
npx firebase login
```

```bash
npx firebase deploy --only firestore:rules --project <projectId>
```

## Security Rules 自動測試

[`tests/firestore.rules.test.mjs`](tests/firestore.rules.test.mjs) 在本機的 Firestore emulator 上跑 65 項測試，用的是假專案 `demo-postoffice`，不需要登入，也不會連到你真的 Firebase 專案。

需要 Node.js 20 以上、Java 21 以上（emulator 是 Java 程式）。

```bash
npm ci --ignore-scripts --omit=optional
```

```bash
npm run test:rules
```

- 第一次執行時，firebase-tools 會從 Google 下載 Firestore emulator（約 137 MB，會核對 MD5），存在 `~/.cache/firebase/emulators`。
- 安裝時加 `--ignore-scripts --omit=optional`：不執行任何套件的安裝腳本，也不裝 re2、node-gyp 這類原生建置工具（只有 hosting 模擬器會用到）。
- Windows 上 firebase-tools 結束時不會關掉 emulator 的 Java 程序，會一直占著 port 8080。[`tests/run-rules-tests.mjs`](tests/run-rules-tests.mjs) 在測試前後會把「這個專案的 emulator」關掉：只關命令列同時含 `cloud-firestore-emulator` 和 `demo-postoffice` 的 Java 程序。

測試涵蓋：

| 類別 | 項目 |
|---|---|
| 公佈牆讀取 | 未登入可讀；沒有 limit 或一次讀超過 50 張被拒 |
| 寄明信片 | 正常寄出；沒寫寄件紀錄、同一批次塞兩張或明信片加抽屜信、寄件紀錄指向別的文件、10 秒內第二張都被拒；冒用 authorId、名字或頭像被拒；多欄位、少欄位、空白、非字串、141 字、9 行、塞滿換行、怪郵票、自填時間、匿名或自訂 token、未登入都被拒 |
| 字數一致 | 中文、emoji、國旗、行數等樣本：前端 `checkText` 的判斷和規則結果相同 |
| 修改與撤回 | 不能改、不能覆蓋；只有寄件人能撤回 |
| 抽屜 | 只有主人能讀寫；不能放進別人的抽屜；從抽屜寄出成功；不能改 |
| 寄件紀錄 | 只能讀自己的、不能刪、不能多欄位或自填時間 |

放上 GitHub 後，[`.github/workflows/test-rules.yml`](.github/workflows/test-rules.yml) 會在 push 到 `main` 或開 PR、而且改到規則相關檔案（`firestore.rules`、`firebase.json`、`package*.json`、`tests/`、`site/js/shared.js`）時自動跑同一套測試，也可以在 Actions 分頁手動執行。它和部署是分開的，測試失敗不會擋住網站部署；Node 寫死在已修補 2026-10-21 安全更新的 22.23.4，emulator JAR 會快取，不用每次重新下載。

部署到真的 Firebase 後，仍建議手動確認一次：登入、寄一張、放一封進抽屜再寄出、10 秒內連寄兩張（第二張應顯示「郵差還在路上」）。

## 共用電腦

Firestore 開了本機快取，登出後瀏覽器裡仍可能留著讀過的資料（包括抽屜裡的信）。在共用電腦上請用無痕視窗。

## 免費額度要注意的地方

Spark 方案每天：Firestore 讀 5 萬次、寫 2 萬次、刪除 2 萬次，儲存 1 GiB（太平洋時間午夜重置）。

- 每次打開網頁，公佈牆最多讀 40 張（＝ 40 次讀取）。有開本機快取，同一台電腦 30 分鐘內重新整理，只會補讀有變動的文件。
- 額度用完時，Firestore 會回 `resource-exhausted`，網站顯示「今天的免費額度用完了」，隔天恢復，**不會自動收費**。
- 讀取沒辦法用規則限流。如果網站變熱門或被刷，可以再加 [App Check](https://firebase.google.com/docs/app-check)。

## 本機連真的 Firebase 測試

1. 建立 `site/firebase-config.local.js`（已在 `.gitignore`，不會進 git）：

   ```js
   export const firebaseConfig = {
     apiKey: '...',
     authDomain: '...',
     projectId: '...',
     appId: '...',
   };
   ```

2. 用第 1 節的指令開 <http://localhost:8000>。`localhost` 預設就在 Firebase 的授權網域裡；`127.0.0.1` 不在，用它開會無法登入。

只有網址是 `localhost` 時才會讀這個檔案；部署到 GitHub Pages 時讀的是 Actions 產生的 `firebase-config.js`。沒有建這個檔案時，本機的瀏覽器 console 會出現一行 `firebase-config.local.js` 404，這是正常的。

## 檔案

```
.github/workflows/deploy-pages.yml  部署到 GitHub Pages（寫入 Firebase 設定）
.github/workflows/test-rules.yml    規則相關檔案有變動時自動跑規則測試
firestore.rules                     Firestore Security Rules
firebase.json                       Firebase CLI 設定（規則檔位置、emulator port）
package.json、package-lock.json     規則測試用的套件（版本固定）
tests/
  firestore.rules.test.mjs          規則的自動測試
  run-rules-tests.mjs               啟動 emulator 跑測試，跑完關掉 emulator
site/
  index.html                        頁面
  styles.css                        樣式（自動跟隨系統的深色模式）
  firebase-config.js                預設 null＝示範模式；部署時被覆寫
  js/app.js                         畫面與互動
  js/firebase-store.js              Firebase 版的資料層（Auth＋Firestore）
  js/one-tap.js                     Google One Tap（有設定 googleClientId 才會載入 Google 的程式）
  js/demo-store.js                  示範模式的資料層（localStorage，照規則檢查）
  js/postcard.js                    明信片、郵票、郵戳的 DOM
  js/shared.js                      和規則共用的限制
```

## 疑難排解

| 看到的訊息 | 原因與處理 |
|---|---|
| 這個網址還不能登入 | Authentication → Settings → Authorized domains 加入 `<你的帳號>.github.io` |
| Google 登入還沒開啟 | Authentication → Sign-in method 啟用 Google |
| 找不到 Firestore 資料庫 | 還沒建立 Firestore Database |
| 被郵局退件 | 規則擋下：確認已貼上最新的 `firestore.rules`，或登出再登入一次 |
| 郵差還在路上 | 10 秒冷卻，等一下再寄 |
| 讀不到資料 | Firestore 規則還沒發布，或 Firestore 還沒建立 |
| Pages 網址 404 | Settings → Pages 的 Source 要選 GitHub Actions，並確認 workflow 跑成功 |
| 部署後還是「示範模式」 | 4 個 `FIREBASE_*` 要建在 **Variables** 分頁，不是 Secrets；也要是 repository 層級，不是 `github-pages` 這個 environment 底下的變數。建完重跑 workflow |
| 手動執行 workflow 時 deploy 被擋 | `github-pages` environment 預設只允許從 `main` 部署，Run workflow 時分支要選 `main` |
| 按了登記，Google 面板一直沒出現 | `FIREBASE_GOOGLE_CLIENT_ID` 的 OAuth client 沒把網站加進「已授權的 JavaScript 來源」，或剛加還沒生效；可以先按「改用 Google 視窗」 |
| One Tap 選完帳號後顯示 Firebase 設定有誤 | `FIREBASE_GOOGLE_CLIENT_ID` 不是這個 Firebase 專案的網頁用戶端 ID |
| 從 LINE、Facebook 點開無法登入 | 這些 App 的內建瀏覽器不允許 Google 登入，請改用 Chrome 或 Safari 開啟 |

## 版本

- Firebase JS SDK 12.19.0（`site/js/firebase-store.js` 開頭三行，要一起改）
- Google Identity Services 從 `https://accounts.google.com/gsi/client` 載入，Google 不提供固定版本
- `actions/checkout` v7.0.1、`actions/upload-pages-artifact` v5.0.0、`actions/deploy-pages` v5.0.1；規則測試另用 `actions/setup-node` v7.1.0、`actions/setup-java` v6.1.0、`actions/cache` v6.1.0（全部釘在 commit SHA）
- CI 的 Node 22.23.4、Java Temurin 21
- 規則測試：`firebase-tools` 15.34.0、`@firebase/rules-unit-testing` 5.0.2、`firebase` 12.19.0。rules-unit-testing 6.x 需要 Node 24.12 以上並搭配 firebase 13，所以停在 5.0.2；lockfile 只收發布滿 7 天的版本。
