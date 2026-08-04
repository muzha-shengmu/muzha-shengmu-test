# 上線手冊｜木柵聖母宮

程式與資料庫結構都已完成並測過。**剩下的每一步都需要你的帳號，我沒有辦法代做。**
照著做完，網站就是對外開放、可以正常使用的狀態。

預估時間：40～60 分鐘。

---

## 現在的狀態

| 項目 | 狀態 |
|---|---|
| 14 頁前台 + 宮務後台 | 完成 |
| 資料庫結構、權限、11+4 支 RPC | 完成，已在 PostgreSQL 16 驗過 |
| 線上報名／點燈／安太歲 表單與查詢 | 完成，瀏覽器端對端測過 |
| 公告系統（前台＋後台編輯器） | 完成 |
| `config/announcement-config.js` | **停用中**，URL 與 Key 都是空字串 |

出貨的設定檔是「停用」狀態，所以現在直接部署，網站會正常顯示但線上服務不會運作。
下面第 4 步填入兩個值之後才會真正啟用。

---

## 第 1 步：建立 Supabase 專案

1. 到 https://supabase.com 註冊／登入
2. New project
   - Name：`mzsm`（隨意）
   - Database Password：**用密碼管理器產生一組並存好**，遺失只能重設
   - Region：選 `Northeast Asia (Tokyo)` 或 `Southeast Asia (Singapore)`，離台灣近
3. 等待專案建立完成（約 2 分鐘）

---

## 第 2 步：套用資料庫結構

在 Supabase 後台左側 **SQL Editor** → New query，依序執行：

1. 貼上 `supabase/migrations/20260804000001_mzsm_core.sql` 全部內容 → Run
2. 貼上 `supabase/migrations/20260804000002_mzsm_admin_console.sql` 全部內容 → Run

兩次都要看到 `Success`。

> **不要**執行 `supabase/tests/` 底下的檔案。`auth_shim.sql` 是本機測試用的替身，
> 套到正式環境會覆蓋掉 Supabase 自己的 `auth.uid()`，導致權限判斷全部失效。

驗證：左側 **Table Editor** 應該看得到 `mzsm_announcements`、`mzsm_lights`、
`mzsm_pilgrimage`、`mzsm_taisui`、`mzsm_admins` 等資料表，且每一張都標示 RLS enabled。

---

## 第 3 步：建立管理者帳號

管理權限來自 `mzsm_admins` 這張表，**不是**「有 Supabase 帳號就有權限」。

1. 左側 **Authentication → Users → Add user**
   - Email：宮方要用的管理信箱
   - 勾選 Auto Confirm User
   - 建立後，複製那一列的 **User UID**（一串 uuid）
2. 回到 **SQL Editor**，執行（把 uuid 和 email 換成上一步的值）：

```sql
insert into public.mzsm_admins (user_id, email)
values ('貼上剛剛複製的-uuid', '宮方管理信箱');
```

要多位管理者就重複這兩步。要移除某人的權限：

```sql
delete from public.mzsm_admins where email = '要移除的信箱';
```

移除後對方即使還能登入，也讀不到任何宮務資料。

---

## 第 4 步：取得連線資訊並填入設定檔

Supabase 後台 **Project Settings → API**：

- **Project URL**：形如 `https://xxxxxxxxxxxx.supabase.co`
- **Publishable key**：以 `sb_publishable_` 開頭的那一組

> 只用 Publishable key。**絕對不要**把 `service_role` 或任何 secret key 填進前端，
> 那把鑰匙可以繞過所有權限檢查。設定檔會被所有訪客下載。

編輯 `config/announcement-config.js`，改這四行：

```js
mode: 'rpc',                                             // 原本是 'disabled'
supabaseUrl: 'https://xxxxxxxxxxxx.supabase.co',         // 第 4 步的 Project URL
supabasePublishableKey: 'sb_publishable_...',            // 第 4 步的 Publishable key
authRedirectUrl: 'https://你的網域/admin.html',           // 見下方說明
```

`authRedirectUrl` 規則（程式會擋，填錯登入寄不出去）：

- 必須是 `https`
- 必須與網站**同源**（同一個網域）
- 不可以有 `?` 查詢參數或 `#` 片段
- 例：網站在 `https://muzha-shengmu.org`，就填 `https://muzha-shengmu.org/admin.html`

---

## 第 5 步：設定 Supabase 的回跳白名單

**Authentication → URL Configuration**：

- **Site URL**：`https://你的網域`
- **Redirect URLs**：新增 `https://你的網域/admin.html`
  以及 `https://你的網域/announcement-admin.html`

沒設這一步，登入連結點下去會被 Supabase 拒絕。

---

## 第 6 步：部署靜態網站

整個網站是純靜態檔案，任何靜態主機都可以。三個常見選擇：

**A. Cloudflare Pages（推薦，免費、自帶 HTTPS 與 CDN）**
1. 把 repo 推到 GitHub
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. Build command 留空，Build output directory 填 `/`
4. 部署後會拿到 `xxx.pages.dev`，可再綁自己的網域

**B. GitHub Pages**
Settings → Pages → Source 選分支與根目錄。網域用 `xxx.github.io/repo` 或自訂網域。

**C. Netlify**
拖曳整個資料夾到 Netlify Drop 即可。

無論用哪一個，網站**必須是 https**——設定檔會拒絕非 https 的 Supabase 連線，
瀏覽器也會擋掉 http 頁面對 https 的部分請求。

---

## 第 7 步：上線後自己驗一次

| # | 動作 | 應該看到 |
|---|---|---|
| 1 | 開首頁 | 龍身主視覺、煙霧會動 |
| 2 | 開「服務 → 南巡進香」，送出一筆測試報名 | 拿到 `MSM-2026-xxxx` 報名碼 |
| 3 | 用該報名碼 + 手機末四碼查詢 | 查得到，且**不顯示姓名與完整手機** |
| 4 | 故意用錯的末四碼查 | 顯示查無資料 |
| 5 | 開 `/admin.html`（未登入） | 只看到登入畫面，看不到任何登記資料 |
| 6 | 用管理信箱收登入連結並登入 | 三個分頁都看得到資料，手機只顯示末四碼 |
| 7 | 把第 2 步那筆標為「已確認」 | 狀態變更成功 |
| 8 | 用**非**管理者帳號登入 `/admin.html` | 明確顯示「不在宮務管理者名單內」，讀不到資料 |
| 9 | 開 `/announcement-admin.html`，發佈一則公告 | 公告頁看得到；改回草稿後立刻看不到 |

第 3、5、8 項是個資保護的重點，請務必實測。

驗完記得把測試資料刪掉：

```sql
delete from public.mzsm_pilgrimage where name like '%測試%';
delete from public.mzsm_lights      where name like '%測試%';
delete from public.mzsm_taisui      where name like '%測試%';
```

---

## 之後的維護

**每天**：宮方人員登入 `/admin.html` 處理新的登記。

**備份**：Supabase 免費方案只保留 7 天自動備份。有真實信眾資料之後，
建議 Project Settings → Database → 定期手動 Download backup，或升級到付費方案。

**個資**：資料庫裡存有姓名、手機、生日。請確認宮方對信眾說明過蒐集目的，
並約定保存期限；過期資料用上面那種 `delete` 語句清除。

---

## 目前沒有做、你可能會想要的

這些不是缺陷，是還沒決定或超出目前範圍的項目，需要你決定要不要做：

1. **線上收款** — 目前所有頁面都只登記、不收錢。要串金流需要另外評估
   （綠界、藍新等），也牽涉發票與退費規則。
2. **通知信／簡訊** — 登記成功後不會自動通知信眾，目前要宮方主動聯絡。
3. **農曆與生肖自動換算** — 安太歲只存國曆生日，農曆由宮方人工核對。
   自動換算需要一份可信的農曆對照表，且錯誤的宗教資訊比沒有更糟。
4. **報名額滿控管** — 目前不限名額，也不會自動關閉報名。
5. **公告圖片上傳** — 公告目前只有純文字。
