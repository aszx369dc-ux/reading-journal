# 每日閱讀筆記

手機優先、無登入、純本機儲存的閱讀自由書寫 PWA。正式網站：<https://aszx369dc-ux.github.io/reading-journal/>

## 資料模型與隱私

- 正式筆記與自動草稿分別存放在瀏覽器 IndexedDB 的 `entries`、`drafts` object store。
- 日期由使用裝置的本地時區計算，每個日期最多一篇正式筆記。
- 主應用不載入 Supabase、分析工具、外部字型或任何 CDN，也不會把筆記送到 GitHub 或其他伺服器。
- 手機、筆電、不同瀏覽器與不同瀏覽器 profile 都是獨立筆記本。清除該網站的瀏覽器資料會遺失內容，應定期匯出 JSON。
- 匯出格式為 `reading-journal` version 2，包含全部正式筆記與草稿。匯入亦接受舊版 `{ "YYYY-MM-DD": "內容" }` 格式。
- 匯入同日期資料時會顯示衝突，必須明確選擇「保留目前版本」或「以備份覆蓋」。匯入使用單一 IndexedDB transaction。

## 舊資料搬移

### 更早的本機版

主頁會檢查同網域 localStorage 的 `daily-reading-journal-v1`。合法且尚未存在的日期會複製進 IndexedDB，既有新版日期優先；原 localStorage 不會刪除。

### Supabase 雲端版

雲端資料不會也不能由新版自動搬移。到 [`legacy-cloud-export.html`](https://aszx369dc-ux.github.io/reading-journal/legacy-cloud-export.html) 使用原 Email 登入，下載 JSON，再到主頁匯入。這個獨立搬移頁會載入 Supabase CDN/公開設定；主應用不會。若 magic link 返回網址被拒絕，需在既有 Supabase 專案的 Redirect URLs 加入：

```text
https://aszx369dc-ux.github.io/reading-journal/legacy-cloud-export.html
```

`supabase/schema.sql` 與既有 Supabase 專案不需刪除。`config.js` 只可放瀏覽器可公開的 publishable/anon key，絕不可放 service_role key、使用者 access token 或私人筆記。

## 本機執行與驗證

不需要 build 或安裝依賴：

```bash
python3 -m http.server 4173
```

開啟 <http://127.0.0.1:4173/>。macOS 已安裝 Chrome 時，可執行無依賴的端對端測試：

```bash
node tests/e2e.mjs
```

測試覆蓋本機日期、中文 composition、自動草稿、明確儲存、重新載入、日期切換、長文、JSON 格式與衝突選擇、service worker 舊快取清除、離線讀寫及不同瀏覽器 profile 的資料隔離。

## GitHub Pages 部署

推送 `main` 會由 `.github/workflows/pages.yml` 發布靜態檔案。所有正式資源使用相對路徑，manifest 的 scope/start URL 及 service worker 均相容 `/reading-journal/` 子路徑。

新版 service worker 安裝時預先快取 app shell，啟用時移除舊 cache 並接管頁面，但不會主動重新整理正在輸入的頁面。更新 service worker 或 cache 不會觸碰 IndexedDB。
