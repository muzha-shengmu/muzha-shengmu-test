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
    publicLookupTaisui: 'mzsm_public_lookup_taisui'
  });

  const config = Object.freeze({
    candidateId: 'MZSM-V9-SUPABASE-INTEGRATION-002',
    mode: 'disabled', // disabled | rpc；demo/rpcmock 只能由本機查詢參數啟用。
    supabaseUrl: '',
    supabasePublishableKey: '',
    authRedirectUrl: '', // 正式啟用前須與目前網站同源，且精確加入 Supabase Redirect URLs。
    supabaseJsVersion: '2.110.8',
    timeoutMs: 8000,
    allowDemoQuery: true,
    allowRpcMockQuery: true,
    rpc
  });

  window.MZSM_RPC_CONFIG = config;
  window.MZSM_ANNOUNCEMENT_CONFIG = config; // 保留 r2 全域名稱，避免舊頁面失效。
})();
