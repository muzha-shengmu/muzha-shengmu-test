# 上線手冊｜木柵聖母宮

本文件保留歷史操作說明供比對；不是本次執行清單或授權。正式專案現況尚未重新驗證，以下步驟不得直接逐項執行。

本次候選：後端停用、連線值空白；尚缺宮方內容確認、正式來源裁決、真機與正式後端驗收。正式操作由 sen 或有權者完成。

---

## 現在的狀態

| 項目 | 狀態 |
|---|---|
| 14 頁前台 + 宮務後台 | 完成 |
| 資料庫結構、權限、11+4 支 RPC | 完成，已在 PostgreSQL 16 驗過 |
| 線上報名／點燈／安太歲 表單與查詢 | 完成，瀏覽器端對端測過 |
| 公告系統（前台＋後台編輯器） | 完成 |
| `config/announcement-config.js` | **L3 隔離候選停用**；URL、Key、Redirect 全空 |

出貨的設定檔是「停用」狀態，所以現在直接部署，網站會正常顯示但線上服務不會運作。
第 4 步填入 Publishable key、並把 `mode` 改成 `'rpc'` 之後才會真正啟用。

---

## 第 1 步：專案已經有了——先做事前檢查

專案在 2026-07-21 就建立好了，**不要再建一個**：

| | |
|---|---|
| 專案 | `mzsm-temple` |
| 組織 | 木柵聖母宮（Free） |
| 機房 | Northeast Asia（東京） |
| Project URL | `[待有權者核對的正式設定]` |
| 登入 | `temple-admin@example.invalid`（Google 登入） |

上列 URL 是歷史文件的專案識別線索。本次候選未填入任何真實連線值。

因為專案不是全新的，裡面可能已經有先前留下的東西。**先做檢查再動手**：

1. 左側 **SQL Editor** → New query
2. 貼上 `supabase/00_PREFLIGHT_CHECK.sql` 全部內容 → Run
3. 看最後一行判定：

| 判定 | 意思 | 下一步 |
|---|---|---|
| public schema 未找到 mzsm_ 表 | 不代表專案為空 | HOLD；先完整盤點 |
| 找到部分或全部物件 | 不代表相容或已驗收 | HOLD；先比較完整結構及權限 |
| ❌ 結構不符 | 有同名但欄位不同的舊表 | **先停下來**，把第 4 節結果整份回報再決定 |

這份檢查讀取目錄與筆數，含唯讀 DO 區塊。它不提供「可直接重跑」的判定；本次尚未在正式專案執行。

---

## 第 2 步：套用資料庫結構

在 Supabase 後台左側 **SQL Editor** → New query，依序執行：

1. 貼上 `supabase/migrations/20260804000001_mzsm_core.sql` 全部內容 → Run
2. 貼上 `supabase/migrations/20260804000002_mzsm_admin_console.sql` 全部內容 → Run

兩次都要看到 `Success`。

**關於重複執行**：歷史本機測試不能保證其他既有專案安全。CREATE OR REPLACE FUNCTION 仍會變更函式；兩個 migration 分別提交，不是跨兩檔自動回滾。須先比對完整 schema、函式及權限，固定備份與還原點，再由 sen 決定人工操作。

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

## 第 4 步：取得 Publishable key 並填入設定檔

Project URL 已經填好了，只差一把鑰匙。

Supabase 後台 **Project Settings → API** → 複製 **Publishable key**
（以 `sb_publishable_` 開頭）

> 只用 Publishable key。**絕對不要**把 `service_role` 或任何 secret key 填進前端，
> 那把鑰匙可以繞過所有權限檢查。設定檔會被所有訪客下載。

編輯 `config/announcement-config.js`，改這四行：

```js
mode: 'rpc',                                              // 原本是 'disabled'，改這個才會啟用
supabaseUrl: '',                                        // 正式專案確認前保持空白
supabasePublishableKey: 'sb_publishable_...',             // ← 貼上你複製的那一組
authRedirectUrl: 'https://你的網域/admin.html',            // ← 部署拿到網域後再填
```

注意：現有程式的 RPC 模式只核對 URL、Publishable Key 與 SDK 版本；Redirect 空白只阻擋寄送登入連結，不會阻止所有 RPC。不得把 Redirect 空白當成防誤連機制。候選維持 mode=disabled，三個連線欄位空白。

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

本階段只可執行本機匯出：`python3 tools/export_public.py`，產生 `dist/`。
此步驟不部署。輸出保留 15 頁與瀏覽器素材，排除 SQL、測試工具與版本庫。

不得將整個原始碼根目錄直接上傳為網站。候選輸出維持後端停用，且 `_headers` 明確封鎖連線與表單送出；正式啟用前必須另行核對發布平台對標頭的支援、權限、網域與後端設定。

隨機網址、robots.txt 與 noindex 都不是存取控制。私人測試需要平台實際提供的存取限制；目前沒有建立或部署任何網址。正式發布由 sen 或有權者在來源、內容與驗收條件完成後處理。
來源：https://developers.google.com/search/docs/crawling-indexing/control-what-you-share

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

測試資料應建立於隔離測試環境。不得以姓名包含「測試」等模糊條件刪除正式資料；若正式資料確需處理，須由有權者逐筆核對精確記錄 ID、備份與影響範圍。本文件不提供正式刪除指令。

---

## 之後的維護

**每天**：宮方人員登入 `/admin.html` 處理新的登記。

**備份**：Supabase 官方說明：Pro 提供每日備份並可存取最近 7 天；Free 建議另行匯出並保存。不可將 Free 當成已有 7 天可用自動備份。實際備份、還原能力與費用須由 sen 核對。來源：https://supabase.com/docs/guides/platform/backups（2026-09-08 查核）

**個資**：資料庫裡存有姓名、手機、生日。請確認宮方對信眾說明過蒐集目的，
並確認完整告知事項、保存期限與資料主體權利；正式清除只能由有權者依核定程序執行。

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
