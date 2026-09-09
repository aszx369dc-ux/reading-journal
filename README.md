# 每日閱讀自由書寫

這是獨立的純靜態前端，與旁邊的 `SPY_SMA200_PAPER` 量化研究專案分開部署。網站使用 Supabase Auth、Database 與 Row Level Security，不包含任何量化研究檔案。

## 本機設定

1. 在 Supabase 建立 Project，執行 `supabase/schema.sql`。
2. 在 Supabase Authentication 的 URL Configuration 設定 Site URL 與 Redirect URL，例如本機 `http://127.0.0.1:4173/`。
3. 複製 `config.example.js` 為 `config.js`，填入 Supabase Project URL 與 publishable/anon key。不要填 service_role key。
4. 在此目錄啟動靜態伺服器：

```bash
python3 -m http.server 4173
```

5. 開啟 `http://127.0.0.1:4173/`。

## 部署 GitHub Pages

這個 repository 使用 GitHub Actions 發布到 GitHub Pages。網站沒有 build command；部署內容只包含 `index.html`、`styles.css`、`app.js`、`config.js`。`config.js` 只包含可公開的 Supabase URL 與 publishable/anon key，絕對不能包含 service_role key。每次推送到 `main` 都會重新部署。

正式網址格式為 `https://<github-帳號>.github.io/<repository>/`。部署後請把這個網址加入 Supabase Authentication 的 Site URL 與 Redirect URLs。

## 資料與安全

日記寫入 `public.reading_entries`。每個帳號以 `(user_id, entry_date)` 唯一，使用者只能透過 RLS 讀寫自己的列。未登入時前端不會查詢或渲染任何日記資料；RLS 是真正的資料安全邊界。

舊版 `daily-reading-journal-v1` 若存在，登入後只會在歷史頁顯示一次性匯入提示。匯入成功後，會另外詢問是否移除本機舊資料。

## 尚未完成的人工步驟

GitHub repository 建立、GitHub Pages 啟用，以及 Supabase 正式網址設定需要由 repository 擁有者完成。真實登入、雲端 CRUD、RLS 實際拒絕跨帳號查詢與正式 HTTPS 網址，會在部署完成後驗證。
