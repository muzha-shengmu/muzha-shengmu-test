// MZSM-V9-SUPABASE-INTEGRATION-002｜公告一期後端候選設定（預設停用）
// 本檔不得填入 Secret／Service Role Key、帳號或個資；本輪未連線任何 Supabase 專案。
(() => {
  'use strict';

  const rpc = Object.freeze({
    publicListAnnouncements: 'mzsm_public_list_announcements',
    adminListAnnouncements: 'mzsm_admin_list_announcements',
    adminSaveAnnouncement: 'mzsm_admin_save_announcement',
    publicCreatePilgrimage: 'mzsm_public_create_pilgrimage',
    publicLookupPilgrimage: 'mzsm_public_lookup_pilgrimage',
    publicCreateLight: 'mzsm_public_create_light',
    publicLookupLight: 'mzsm_public_lookup_light',
    adminListLights: 'mzsm_admin_list_lights',
    adminUpdateLight: 'mzsm_admin_update_light',
    publicCreateTaisui: 'mzsm_public_create_taisui',
    publicLookupTaisui: 'mzsm_public_lookup_taisui',
    adminListPilgrimage: 'mzsm_admin_list_pilgrimage',
    adminUpdatePilgrimage: 'mzsm_admin_update_pilgrimage',
    adminListTaisui: 'mzsm_admin_list_taisui',
    adminUpdateTaisui: 'mzsm_admin_update_taisui'
  });

  const config = Object.freeze({
    candidateId: 'MZSM-CROSS-AUDIT-20260908-001',
    // 啟用步驟見 supabase/DEPLOY.md。改成 'rpc' 之前請先確認下面兩項都填好，
    // 否則 resolveMode() 會判定設定不完整並自動退回 disabled（不會誤連）。
    mode: 'disabled', // L3 本機候選：不連線正式後端
    // 專案 mzsm-temple（木柵聖母宮 / Free / 東京機房 / 建立於 2026-07-21）。
    // Project URL 不是機密：它會出現在每一個前端請求裡，可以安全放進版控。
    supabaseUrl: '',
    // Project Settings → API → Publishable key，以 sb_publishable_ 開頭。
    // 絕對不要填 service_role 或任何 secret key：本檔會被所有訪客下載。
    supabasePublishableKey: '',
    authRedirectUrl: '', // 正式啟用前須與目前網站同源，且精確加入 Supabase Redirect URLs。
    supabaseJsVersion: '2.110.8',
    timeoutMs: 8000,

    // ── 測試模式安全邊界（獨立驗收 M-03）────────────────────────────────
    // developmentBuild 必須為 true，測試模式才有可能啟用。正式候選包一律 false，
    // 因此 ?demo=1 / ?rpcmock=1 / ?role=admin 在任何網域都不會生效（hard-disable）。
    // 除了本旗標，mzsm-rpc-client.js 另外強制要求 loopback 主機
    // （localhost / 127.0.0.1 / ::1）。兩個條件必須同時成立。
    // 又：mode:'rpc' 時，query parameter 一律不得覆寫正式模式。
    developmentBuild: false,
    allowDemoQuery: true,   // 僅在 developmentBuild && loopback 時才被採用
    allowRpcMockQuery: true, // 僅在 developmentBuild && loopback 時才被採用
    rpc
  });

  window.MZSM_RPC_CONFIG = config;
  window.MZSM_ANNOUNCEMENT_CONFIG = config; // 保留 r2 全域名稱，避免舊頁面失效。
})();
