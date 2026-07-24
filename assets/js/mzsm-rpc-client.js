(() => {
  'use strict';

  const root = window;
  const cfg = root.MZSM_RPC_CONFIG || root.MZSM_ANNOUNCEMENT_CONFIG || {};
  const DEFAULT_TIMEOUT_MS = 8000;
  const RPC_DEFAULTS = Object.freeze({
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
  const ADMIN_CALLS = new Set([
    'adminListAnnouncements',
    'adminSaveAnnouncement',
    'adminListLights',
    'adminUpdateLight'
  ]);
  const LIVE_RPC_CALLS = new Set([
    'publicListAnnouncements',
    'adminListAnnouncements',
    'adminSaveAnnouncement'
  ]);
  const SENSITIVE_LOG_FIELDS = new Set([
    'title', 'content', 'name', 'phone', 'last4', 'target', 'birth', 'note'
  ]);
  const params = new URLSearchParams(root.location?.search || '');

  class MzsmRpcError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = 'MzsmRpcError';
      this.code = code || 'UNKNOWN_ERROR';
      this.status = Number(options.status || 0);
      this.retryable = options.retryable === true;
      this.details = options.details ?? null;
    }
  }

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const year = () => new Date().getFullYear();
  const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rpcMap = Object.freeze({...RPC_DEFAULTS, ...asObject(cfg.rpc)});

  function fail(code, message, options) {
    throw new MzsmRpcError(code, message, options);
  }

  function normalizeError(error) {
    if (error instanceof MzsmRpcError) return error;
    if (error?.name === 'AbortError') {
      return new MzsmRpcError('TIMEOUT', 'RPC 請求逾時。', {retryable: true});
    }
    if (error instanceof TypeError) {
      return new MzsmRpcError('NETWORK_ERROR', 'RPC 網路連線失敗。', {retryable: true});
    }
    const rawCode = String(error?.code || '');
    const message = String(error?.message || 'RPC 發生未知錯誤。');
    const rawStatus = Number(error?.status || 0);
    if (rawCode === '23505' || message.includes('MZSM_CONFLICT')) {
      return new MzsmRpcError('CONFLICT', '公告已被其他操作更新，請重新載入。', {status:409});
    }
    if (rawCode === 'P0002' || message.includes('MZSM_NOT_FOUND')) {
      return new MzsmRpcError('NOT_FOUND', '找不到公告。', {status:404});
    }
    if (rawCode === '42501' || rawStatus === 401 || rawStatus === 403) {
      const signedOut = rawStatus === 401;
      return new MzsmRpcError(signedOut ? 'UNAUTHENTICATED' : 'FORBIDDEN', signedOut ? '請先登入管理者帳號。' : '目前帳號沒有宮務管理權限。', {status:rawStatus || 403});
    }
    if (rawCode === '22023' || message.includes('MZSM_VALIDATION_ERROR')) {
      return new MzsmRpcError('VALIDATION_ERROR', '公告欄位驗證失敗。', {status:400});
    }
    if (rawStatus === 0 && /(?:typeerror|failed to fetch|networkerror|network request)/i.test(message)) {
      return new MzsmRpcError('NETWORK_ERROR', 'RPC 網路連線失敗。', {retryable:true});
    }
    return new MzsmRpcError(rawCode || 'UNKNOWN_ERROR', message, {
      status: rawStatus,
      retryable: error?.retryable,
      details: error?.details
    });
  }

  function payloadForLog(payload) {
    return Object.fromEntries(Object.entries(payload).map(([key, value]) => [
      key,
      SENSITIVE_LOG_FIELDS.has(key) ? '[REDACTED]' : clone(value)
    ]));
  }

  function assertOnly(payload, allowed) {
    const extra = Object.keys(payload).filter((key) => !allowed.includes(key));
    if (extra.length) fail('FIELD_NOT_ALLOWED', `不允許的欄位：${extra.join('、')}`);
  }

  function text(payload, key, {required = false, max = 200} = {}) {
    const value = String(payload[key] ?? '').trim();
    if (required && !value) fail('VALIDATION_ERROR', `${key} 為必填。`);
    if (value.length > max) fail('VALIDATION_ERROR', `${key} 超過 ${max} 字元。`);
    return value;
  }

  function phone(payload, key = 'phone') {
    const value = text(payload, key, {required: true, max: 10});
    if (!/^\d{8,10}$/.test(value)) fail('VALIDATION_ERROR', `${key} 格式不正確。`);
    return value;
  }

  function last4(payload) {
    const value = text(payload, 'last4', {required: true, max: 4});
    if (!/^\d{4}$/.test(value)) fail('VALIDATION_ERROR', 'last4 必須是四位數字。');
    return value;
  }

  function integer(payload, key, {min = 0, max = 999} = {}) {
    const value = Number(payload[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      fail('VALIDATION_ERROR', `${key} 必須是 ${min}～${max} 的整數。`);
    }
    return value;
  }

  function boolean(payload, key) {
    if (typeof payload[key] !== 'boolean') fail('VALIDATION_ERROR', `${key} 必須是布林值。`);
    return payload[key];
  }

  function isoDate(payload, key) {
    const value = text(payload, key, {required: true, max: 10});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('VALIDATION_ERROR', `${key} 日期格式不正確。`);
    const parsed = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      fail('VALIDATION_ERROR', `${key} 日期不存在。`);
    }
    return value;
  }

  function statusValue(payload, key, allowed) {
    const value = text(payload, key, {required: true, max: 30});
    if (!allowed.includes(value)) fail('VALIDATION_ERROR', `${key} 狀態不允許。`);
    return value;
  }

  function idempotencyKey(payload) {
    const value = text(payload, 'idempotency_key', {required: true, max: 80});
    if (!/^[A-Za-z0-9._:-]{8,80}$/.test(value)) fail('VALIDATION_ERROR', 'idempotency_key 格式不正確。');
    return value;
  }

  function resolveMode() {
    const demo = cfg.allowDemoQuery === true && params.get('demo') === '1';
    const mock = cfg.allowRpcMockQuery === true && params.get('rpcmock') === '1';
    if (demo && mock) return {mode: 'disabled', reason: 'MODE_CONFLICT'};
    if (demo) return {mode: 'demo', reason: null};
    if (mock) return {mode: 'rpcmock', reason: null};
    let validUrl = false;
    try {
      const url = new URL(String(cfg.supabaseUrl || ''));
      validUrl = url.protocol === 'https:' && !url.username && !url.password;
    } catch (_) {}
    const validPublishableKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(String(cfg.supabasePublishableKey || ''));
    const hasLiveConfig = cfg.mode === 'rpc' && validUrl && validPublishableKey && cfg.supabaseJsVersion === '2.110.8';
    if (hasLiveConfig) return {mode: 'rpc', reason: null};
    return {mode: 'disabled', reason: cfg.mode === 'rpc' ? 'CONFIG_INCOMPLETE' : null};
  }

  let sharedSupabaseClient = null;

  function createSameOriginRestFetch() {
    const baseFetch = root.fetch.bind(root);
    const supabaseOrigin = new URL(cfg.supabaseUrl).origin;
    const publishableBearer = `Bearer ${cfg.supabasePublishableKey}`;
    return (input, init = {}) => {
      const inputUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const requestUrl = new URL(inputUrl, root.location.href);
      const isSameOriginRest = requestUrl.origin === supabaseOrigin && (requestUrl.pathname === '/rest/v1' || requestUrl.pathname.startsWith('/rest/v1/'));
      if (!isSameOriginRest) return baseFetch(input, init);
      const headers = new root.Headers(input instanceof root.Request ? input.headers : undefined);
      new root.Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
      if (headers.get('authorization') === publishableBearer) headers.delete('authorization');
      return baseFetch(input, {...init, headers});
    };
  }

  function getSupabaseClient() {
    if (resolveMode().mode !== 'rpc') fail('CONFIG_INCOMPLETE', 'Supabase 公告候選設定不完整。');
    if (!root.supabase?.createClient) fail('SDK_NOT_LOADED', 'Supabase JS 2.110.8 尚未載入。');
    if (!sharedSupabaseClient) {
      sharedSupabaseClient = root.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
        db: {schema:'public'},
        auth: {autoRefreshToken:true, persistSession:true, detectSessionInUrl:true, flowType:'pkce'},
        global: {fetch:createSameOriginRestFetch()}
      });
    }
    return sharedSupabaseClient;
  }

  function seedAnnouncements() {
    return {
      seq: 3,
      rows: [
        {id:'ANN-DEMO-0001',title:'測試公告：服務時間調整',content:'此為本機測試資料，不代表本宮正式公告。',status:'published',is_pinned:true,published_at:'2026-07-20T08:00:00+08:00',created_at:'2026-07-20T08:00:00+08:00',updated_at:'2026-07-20T08:00:00+08:00',version:1},
        {id:'ANN-DEMO-0002',title:'測試公告：祈福活動',content:'請勿依本測試資料安排活動或填寫真實個人資料。',status:'draft',is_pinned:false,published_at:null,created_at:'2026-07-19T08:00:00+08:00',updated_at:'2026-07-19T08:00:00+08:00',version:1}
      ]
    };
  }

  function seedCombined() {
    return {
      seq: 3,
      registrations: [
        {id:'MSM-2026-0001',name:'測試信眾甲',phone:'0000001234',adult:2,child:1,total:7500,status:'已確認',pay:'已繳',bus:3,note:'測試資料',created:'2026-06-19'}
      ],
      lampSeq: 2,
      lamps: [
        {id:'LMP-2026-0001',name:'測試點燈信眾',phone:'0000001234',type:'平安燈',target:'測試對象',birth:'2000-01-01',note:'測試資料',status:'待確認',pay:'未繳',created:'2026-06-19',version:1}
      ]
    };
  }

  function seedTaisui() {
    return {
      seq: 2,
      rows: [
        {id:'PEA-2026-0001',name:'測試香客甲',phone:'0000001234',target:'測試對象甲',birth:'2000-01-01',note:'平安順遂',status:'待確認'}
      ]
    };
  }

  function readStorage(key, fallback) {
    const base = fallback();
    try {
      const raw = root.localStorage.getItem(key);
      if (!raw) {
        root.localStorage.setItem(key, JSON.stringify(base));
        return base;
      }
      return {...base, ...asObject(JSON.parse(raw))};
    } catch (_) {
      root.localStorage.setItem(key, JSON.stringify(base));
      return base;
    }
  }

  function demoRepository() {
    const ANNOUNCEMENTS = 'mzsm_announcement_demo_v1';
    const COMBINED = 'msm_v1_demo_state';
    const TAISUI = 'msm_taisui_demo_v1';
    return {
      getAnnouncements() {
        const state = readStorage(ANNOUNCEMENTS, seedAnnouncements);
        state.rows = Array.isArray(state.rows) ? state.rows : seedAnnouncements().rows;
        return state;
      },
      saveAnnouncements(state) { root.localStorage.setItem(ANNOUNCEMENTS, JSON.stringify(state)); },
      getCombined() {
        const state = readStorage(COMBINED, seedCombined);
        const base = seedCombined();
        state.registrations = Array.isArray(state.registrations) ? state.registrations : base.registrations;
        state.lamps = Array.isArray(state.lamps) ? state.lamps : base.lamps;
        return state;
      },
      saveCombined(state) { root.localStorage.setItem(COMBINED, JSON.stringify(state)); },
      getTaisui() {
        const state = readStorage(TAISUI, seedTaisui);
        state.rows = Array.isArray(state.rows) ? state.rows : seedTaisui().rows;
        return state;
      },
      saveTaisui(state) { root.localStorage.setItem(TAISUI, JSON.stringify(state)); }
    };
  }

  function memoryRepository() {
    const announcements = seedAnnouncements();
    const combined = seedCombined();
    const taisui = seedTaisui();
    return {
      getAnnouncements: () => announcements,
      saveAnnouncements: () => {},
      getCombined: () => combined,
      saveCombined: () => {},
      getTaisui: () => taisui,
      saveTaisui: () => {}
    };
  }

  function localAdapter({repository, mode, role, scenario}) {
    const idempotent = new Map();

    function requireAdmin(logicalName) {
      if (mode === 'rpcmock' && ADMIN_CALLS.has(logicalName) && role !== 'admin') {
        fail('FORBIDDEN', 'RPC Mock：目前角色沒有宮務管理權限。', {status: 403});
      }
    }

    function scenarioGate(logicalName) {
      if (mode !== 'rpcmock') return null;
      if (scenario === 'timeout') return new Promise(() => {});
      if (scenario === 'network') fail('NETWORK_ERROR', 'RPC Mock 網路錯誤。', {retryable: true});
      if (scenario === 'field_error') fail('VALIDATION_ERROR', 'RPC Mock 欄位驗證失敗。', {status: 400});
      if (scenario === 'forbidden') fail('FORBIDDEN', 'RPC Mock 權限拒絕。', {status: 403});
      if (scenario === 'empty') {
        if (logicalName.includes('List')) return {rows: [], next_cursor: null};
        if (logicalName.includes('Lookup')) return {record: null};
      }
      return null;
    }

    async function execute(logicalName, rawPayload) {
      const payload = asObject(rawPayload);
      const gated = scenarioGate(logicalName);
      if (gated) return gated;
      requireAdmin(logicalName);

      switch (logicalName) {
        case 'publicListAnnouncements': {
          assertOnly(payload, ['limit', 'cursor']);
          const rows = repository.getAnnouncements().rows
            .filter((row) => row.status === 'published')
            .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) || String(b.published_at || '').localeCompare(String(a.published_at || '')))
            .map(({id, title, content, is_pinned, published_at}) => ({id, title, content, is_pinned, published_at}));
          return {rows, next_cursor: null};
        }
        case 'adminListAnnouncements': {
          assertOnly(payload, ['limit', 'cursor']);
          const rows = [...repository.getAnnouncements().rows]
            .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
          return {rows: clone(rows), next_cursor: null};
        }
        case 'adminSaveAnnouncement': {
          assertOnly(payload, ['id', 'title', 'content', 'status', 'is_pinned', 'expected_version']);
          const title = text(payload, 'title', {required: true, max: 120});
          const content = text(payload, 'content', {required: true, max: 4000});
          const status = statusValue(payload, 'status', ['draft', 'published']);
          const isPinned = boolean(payload, 'is_pinned');
          const state = repository.getAnnouncements();
          const id = text(payload, 'id', {max: 80});
          let row;
          if (id) {
            row = state.rows.find((item) => String(item.id) === id);
            if (!row) fail('NOT_FOUND', '找不到公告。', {status: 404});
            if (payload.expected_version != null && Number(payload.expected_version) !== Number(row.version || 1)) {
              fail('CONFLICT', '公告已被其他操作更新，請重新載入。', {status: 409});
            }
            Object.assign(row, {title, content, status, is_pinned: isPinned, published_at: status === 'published' ? (row.published_at || now()) : null, updated_at: now(), version: Number(row.version || 1) + 1});
          } else {
            const next = Number(state.seq || 1);
            state.seq = next + 1;
            row = {id:`ANN-DEMO-${String(next).padStart(4, '0')}`, title, content, status, is_pinned:isPinned, published_at:status === 'published' ? now() : null, created_at:now(), updated_at:now(), version:1};
            state.rows.push(row);
          }
          repository.saveAnnouncements(state);
          return {row: clone(row)};
        }
        case 'publicCreatePilgrimage': {
          assertOnly(payload, ['name', 'phone', 'adult', 'child', 'note', 'idempotency_key']);
          const key = idempotencyKey(payload);
          if (idempotent.has(`${logicalName}:${key}`)) return clone(idempotent.get(`${logicalName}:${key}`));
          const state = repository.getCombined();
          const adult = integer(payload, 'adult', {min: 0, max: 20});
          const child = integer(payload, 'child', {min: 0, max: 20});
          if (adult + child < 1) fail('VALIDATION_ERROR', '至少需要一位參加者。');
          const next = Number(state.seq || 1);
          state.seq = next + 1;
          const row = {id:`MSM-${year()}-${String(next).padStart(4, '0')}`, name:text(payload, 'name', {required:true, max:80}), phone:phone(payload), adult, child, note:text(payload, 'note', {max:500}), status:'待確認', created:now().slice(0, 10)};
          if (mode === 'demo') Object.assign(row, {total: adult * 3000 + child * 1500, pay:'未繳', bus:'待安排'});
          state.registrations.push(row);
          repository.saveCombined(state);
          const result = {code:row.id, status:row.status, created_at:row.created};
          if (mode === 'demo') result.demo_total = row.total;
          idempotent.set(`${logicalName}:${key}`, result);
          return clone(result);
        }
        case 'publicLookupPilgrimage': {
          assertOnly(payload, ['code', 'last4']);
          const code = text(payload, 'code', {required:true, max:80});
          const suffix = last4(payload);
          const row = repository.getCombined().registrations.find((item) => String(item.id) === code && String(item.phone || '').slice(-4) === suffix);
          return {record: row ? {code:row.id, adult:Number(row.adult || 0), child:Number(row.child || 0), status:String(row.status || '待確認')} : null};
        }
        case 'publicCreateLight': {
          assertOnly(payload, ['name', 'phone', 'type', 'target', 'birth', 'note', 'idempotency_key']);
          const key = idempotencyKey(payload);
          if (idempotent.has(`${logicalName}:${key}`)) return clone(idempotent.get(`${logicalName}:${key}`));
          const state = repository.getCombined();
          const next = Number(state.lampSeq || 1);
          state.lampSeq = next + 1;
          const birth = text(payload, 'birth', {max:10});
          if (birth) isoDate({birth}, 'birth');
          const row = {id:`LMP-${year()}-${String(next).padStart(4, '0')}`, name:text(payload, 'name', {required:true, max:80}), phone:phone(payload), type:text(payload, 'type', {required:true, max:40}), target:text(payload, 'target', {required:true, max:80}), birth, note:text(payload, 'note', {max:500}), status:'待確認', pay:'未繳', created:now().slice(0, 10), version:1};
          state.lamps.push(row);
          repository.saveCombined(state);
          const result = {code:row.id, type:row.type, status:row.status, created_at:row.created};
          idempotent.set(`${logicalName}:${key}`, result);
          return clone(result);
        }
        case 'publicLookupLight': {
          assertOnly(payload, ['code', 'last4']);
          const code = text(payload, 'code', {required:true, max:80});
          const suffix = last4(payload);
          const row = repository.getCombined().lamps.find((item) => String(item.id) === code && String(item.phone || '').slice(-4) === suffix);
          return {record: row ? {code:row.id, type:String(row.type || ''), target:String(row.target || ''), status:String(row.status || '待確認')} : null};
        }
        case 'adminListLights': {
          assertOnly(payload, ['limit', 'cursor']);
          const rows = repository.getCombined().lamps.map((row) => ({id:row.id, name:row.name, phone_last4:String(row.phone || '').slice(-4), type:row.type, target:row.target, birth:row.birth || '', note:row.note || '', status:row.status, pay:row.pay, created_at:row.created, version:Number(row.version || 1)}));
          return {rows:clone(rows), next_cursor:null};
        }
        case 'adminUpdateLight': {
          assertOnly(payload, ['id', 'expected_version', 'status', 'pay']);
          if (mode === 'rpcmock' && scenario === 'conflict') fail('CONFLICT', 'RPC Mock：版本衝突。', {status:409});
          const id = text(payload, 'id', {required:true, max:80});
          const expectedVersion = integer(payload, 'expected_version', {min:1, max:999999});
          const state = repository.getCombined();
          const row = state.lamps.find((item) => String(item.id) === id);
          if (!row) fail('NOT_FOUND', '找不到點燈資料。', {status:404});
          if (Number(row.version || 1) !== expectedVersion) fail('CONFLICT', '資料已被其他操作更新，請重新載入。', {status:409});
          if (payload.status != null) row.status = statusValue(payload, 'status', ['待確認', '已確認']);
          if (payload.pay != null) row.pay = statusValue(payload, 'pay', ['未繳', '已繳']);
          row.version = expectedVersion + 1;
          repository.saveCombined(state);
          return {row:{id:row.id, status:row.status, pay:row.pay, version:row.version}};
        }
        case 'publicCreateTaisui': {
          assertOnly(payload, ['name', 'phone', 'target', 'birth', 'note', 'idempotency_key']);
          const key = idempotencyKey(payload);
          if (idempotent.has(`${logicalName}:${key}`)) return clone(idempotent.get(`${logicalName}:${key}`));
          const state = repository.getTaisui();
          const next = Number(state.seq || 1);
          state.seq = next + 1;
          const row = {id:`PEA-${year()}-${String(next).padStart(4, '0')}`, name:text(payload, 'name', {required:true, max:80}), phone:phone(payload), target:text(payload, 'target', {required:true, max:80}), birth:isoDate(payload, 'birth'), note:text(payload, 'note', {max:500}), status:'待確認'};
          state.rows.push(row);
          repository.saveTaisui(state);
          const result = {code:row.id, status:row.status, lunar_status:'pending_review'};
          idempotent.set(`${logicalName}:${key}`, result);
          return clone(result);
        }
        case 'publicLookupTaisui': {
          assertOnly(payload, ['code', 'last4']);
          const code = text(payload, 'code', {required:true, max:80});
          const suffix = last4(payload);
          const row = repository.getTaisui().rows.find((item) => String(item.id) === code && String(item.phone || '').slice(-4) === suffix);
          return {record:row ? {code:row.id, target:row.target, birth:row.birth, status:row.status, lunar_status:'pending_review'} : null};
        }
        default:
          fail('RPC_NOT_MAPPED', `沒有對應的 RPC：${logicalName}`);
      }
    }

    return {execute};
  }

  function liveArgs(logicalName, payload) {
    switch (logicalName) {
      case 'publicListAnnouncements':
      case 'adminListAnnouncements':
        return {p_limit:payload.limit ?? 20, p_cursor:payload.cursor || null};
      case 'adminSaveAnnouncement':
        return {
          p_title:payload.title,
          p_content:payload.content,
          p_status:payload.status,
          p_is_pinned:payload.is_pinned,
          p_id:payload.id || null,
          p_expected_version:payload.expected_version ?? null
        };
      default:
        fail('FEATURE_DISABLED', '本候選只開放公告 3 支 RPC；其餘功能維持停用。');
    }
  }

  function supabaseAdapter() {
    async function execute(logicalName, payload) {
      if (!LIVE_RPC_CALLS.has(logicalName)) fail('FEATURE_DISABLED', '本候選只開放公告 3 支 RPC；其餘功能維持停用。');
      const rpcName = rpcMap[logicalName];
      if (!rpcName) fail('RPC_NOT_MAPPED', `沒有對應的 RPC：${logicalName}`);
      const controller = new AbortController();
      const timeoutMs = Math.max(250, Number(cfg.timeoutMs || DEFAULT_TIMEOUT_MS));
      const timer = root.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const query = getSupabaseClient().rpc(rpcName, liveArgs(logicalName, payload));
        const response = typeof query.abortSignal === 'function' ? await query.abortSignal(controller.signal) : await query;
        if (response.error) throw {...response.error, status:response.status};
        return response.data;
      } finally {
        root.clearTimeout(timer);
      }
    }
    return {execute};
  }

  class MzsmRpcClient {
    constructor() {
      const resolved = resolveMode();
      this.mode = resolved.mode;
      this.reason = resolved.reason;
      this.role = this.mode === 'rpcmock' ? (params.get('role') || 'anon') : (this.mode === 'rpc' ? 'server-enforced' : 'local-demo');
      this.scenario = this.mode === 'rpcmock' ? (params.get('scenario') || 'success') : 'success';
      this.timeoutMs = Math.max(250, Number(cfg.timeoutMs || DEFAULT_TIMEOUT_MS));
      this.log = [];
      if (this.mode === 'demo') this.adapter = localAdapter({repository:demoRepository(), mode:this.mode, role:this.role, scenario:this.scenario});
      else if (this.mode === 'rpcmock') this.adapter = localAdapter({repository:memoryRepository(), mode:this.mode, role:this.role, scenario:this.scenario});
      else if (this.mode === 'rpc') this.adapter = supabaseAdapter();
      else this.adapter = null;
    }

    describe() {
      return Object.freeze({mode:this.mode, reason:this.reason, role:this.role, scenario:this.scenario, timeoutMs:this.timeoutMs, candidateId:cfg.candidateId || ''});
    }

    getLog() {
      return clone(this.log);
    }

    async call(logicalName, rawPayload = {}) {
      if (!this.adapter) fail(this.reason || 'DISABLED', 'RPC 候選目前為停用狀態。');
      if (!rpcMap[logicalName]) fail('RPC_NOT_MAPPED', `沒有對應的 RPC：${logicalName}`);
      const payload = clone(asObject(rawPayload));
      const entry = {logical_name:logicalName, rpc_name:rpcMap[logicalName], payload:payloadForLog(payload), started_at:now(), outcome:'pending'};
      this.log.push(entry);
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = root.setTimeout(() => reject(new MzsmRpcError('TIMEOUT', 'RPC 請求逾時。', {retryable:true})), this.timeoutMs);
        });
        const data = await Promise.race([this.adapter.execute(logicalName, payload), timeout]);
        entry.outcome = 'success';
        entry.finished_at = now();
        return clone(data);
      } catch (error) {
        const normalized = normalizeError(error);
        entry.outcome = 'error';
        entry.error_code = normalized.code;
        entry.finished_at = now();
        throw normalized;
      } finally {
        root.clearTimeout(timer);
      }
    }

    publicListAnnouncements(payload) { return this.call('publicListAnnouncements', payload); }
    adminListAnnouncements(payload) { return this.call('adminListAnnouncements', payload); }
    adminSaveAnnouncement(payload) { return this.call('adminSaveAnnouncement', payload); }
    publicCreatePilgrimage(payload) { return this.call('publicCreatePilgrimage', payload); }
    publicLookupPilgrimage(payload) { return this.call('publicLookupPilgrimage', payload); }
    publicCreateLight(payload) { return this.call('publicCreateLight', payload); }
    publicLookupLight(payload) { return this.call('publicLookupLight', payload); }
    adminListLights(payload) { return this.call('adminListLights', payload); }
    adminUpdateLight(payload) { return this.call('adminUpdateLight', payload); }
    publicCreateTaisui(payload) { return this.call('publicCreateTaisui', payload); }
    publicLookupTaisui(payload) { return this.call('publicLookupTaisui', payload); }
  }

  root.MZSM_RPC_CLIENT = Object.freeze({
    create: () => new MzsmRpcClient(),
    getSupabaseClient,
    Error: MzsmRpcError,
    rpcMap
  });
})();
