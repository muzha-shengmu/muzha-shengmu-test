# MZSM｜2026-09-10 SQL 執行順序

狀態：所有真實資料庫操作及測試皆 NOT RUN，等待 Owner 在已確認的 Supabase 專案執行並回貼原始結果。

不需要提供 Database Password、secret key、Service Role 或 DB 連線字串。

## 順序

1. `supabase/20260910_READ_ONLY_CHECK.sql`
   只讀系統目錄。應列出指定 8 表，table_exists 均為 true，relation_kind 均為 r，以及現有 RPC 函式。請保留全部結果。缺表、出現不同結構或專案身分不確定時，停在這一步並回貼；不要執行舊 RUN_ALL 或重建正式資料庫。
2. `supabase/migrations/20260910000001_mzsm_deny_direct.sql`
   對八張既有表 ENABLE RLS、建立 restrictive deny-direct policy，撤回匿名與一般登入者直接表／欄位存取權。若有繼承權限仍可直接查表，整筆交易中止，不擅自改其他角色。限制鎖等待 5 秒。沒有刪除資料、建立帳號或強制 RLS；受控 Security Definer RPC 仍須另行驗證。
3. `supabase/migrations/20260910000002_mzsm_public_lookup_privacy.sql`
   替換兩個既有公開查詢函式，移除點燈對象、安太歲對象／生日。既有函式不存在即中止，避免以預設授權新建函式。
4. `supabase/tests/rls_negative_test.sql`
   驗證 8 張真實表 RLS 啟用、restrictive policy 定義正確、沒有直接表／欄位授權，並以 anon／authenticated 各測一次 SELECT LIMIT 0。必須收到預期權限錯誤 42501，不接受其他錯誤或空結果冒充通過。成功會輸出 8 表、16 次角色查核的 JSON。只建立暫存測試結果，最後 ROLLBACK；不填寫信眾資料。
5. `supabase/tests/rpc_privacy_catalog_test.sql`
   檢查真實 DB 中兩個公開函式已移除個資回傳鍵。只看定義，不讀信眾資料。成功會輸出 2 支函式的 JSON；這不等於實際 RPC 端到端驗收。

任一步出錯即停止後續步驟，回貼該步檔名與完整錯誤。若編輯器顯示 transaction aborted，先單獨執行 ROLLBACK，再回報；不要跳過失敗步驟。

請回貼每一步的原始結果表／JSON／錯誤，不要只回「成功」。不要貼密碼、金鑰、JWT 或真實信眾資料。這是 Owner 明確要求的資料庫人工執行節點，並非一般施工逐步核准。

## 還原與界線

- 第一份檢查與兩份測試不留下正式資料變更。
- 每份 migration 都有獨立交易；錯誤只回復該份，前一份已成功的變更仍存在。
- 不提供自動關閉 RLS／恢復個資暴露的 rollback；出現功能問題，維持前台停用並向前修復。
- 目前尚未部署。首次發布若需下線，將使用確認後的 Hosting 平台停用部署；Hosting／Domain 未指定前不編造下線指令或 Deployment ID。
- migration 成功、RLS 負向測試成功，也不代表管理者 RPC、網頁登入、真機、效能和正式網站均完成。

依據：PostgreSQL CREATE POLICY 與 Row Security Policies 官方文件。
https://www.postgresql.org/docs/current/sql-createpolicy.html
https://www.postgresql.org/docs/current/ddl-rowsecurity.html
