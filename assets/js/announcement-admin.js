(() => {
  'use strict';

  const cfg = window.MZSM_RPC_CONFIG || window.MZSM_ANNOUNCEMENT_CONFIG || {};
  const api = window.MZSM_RPC_CLIENT;
  if (!api) return;
  const rpc = api.create();
  const meta = rpc.describe();
  const $ = (id) => document.getElementById(id);
  const statusBox = $('adminStatus');
  const loginPanel = $('loginPanel');
  const editorPanel = $('editorPanel');
  const rowsBox = $('announcementRows');
  const form = $('announcementForm');
  const emailInput = $('adminEmailInput');
  const sendMagicLink = $('sendMagicLink');
  const loginSignOut = $('loginSignOut');
  let authClient = null;
  let authSubscription = null;
  let authSequence = 0;
  let rows = [];

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function setStatus(message) {
    statusBox.textContent = message;
  }

  function showSignedOut(message = '尚未登入；宮務權限必須由資料庫端驗證。') {
    loginPanel.classList.remove('hidden');
    editorPanel.classList.add('hidden');
    sendMagicLink.classList.remove('hidden');
    loginSignOut.classList.add('hidden');
    emailInput.disabled = false;
    rows = [];
    rowsBox.replaceChildren(element('p', '登入並通過資料庫管理者名單驗證後才會載入公告。', 'muted'));
    setStatus(message);
  }

  function showUnauthorized(email) {
    loginPanel.classList.remove('hidden');
    editorPanel.classList.add('hidden');
    sendMagicLink.classList.add('hidden');
    loginSignOut.classList.remove('hidden');
    emailInput.value = String(email || '');
    emailInput.disabled = true;
    rows = [];
    rowsBox.replaceChildren(element('p', '目前登入帳號不在資料庫管理者名單內。', 'muted'));
    setStatus('已登入，但目前帳號沒有宮務管理權限；請登出後改用已授權帳號。');
  }

  async function applySession(session) {
    const sequence = ++authSequence;
    if (!session) {
      showSignedOut();
      return;
    }
    try {
      await refresh();
      if (sequence !== authSequence) return;
      loginPanel.classList.add('hidden');
      editorPanel.classList.remove('hidden');
      setStatus('已登入並通過資料庫管理者權限驗證。');
    } catch (error) {
      if (sequence !== authSequence) return;
      if (error?.code === 'FORBIDDEN' || error?.code === 'UNAUTHENTICATED') {
        showUnauthorized(session.user?.email);
        return;
      }
      throw error;
    }
  }

  function exactRedirectUrl() {
    let redirect;
    try { redirect = new URL(String(cfg.authRedirectUrl || '')); } catch (_) {}
    if (!redirect || redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.origin !== window.location.origin || redirect.search || redirect.hash) {
      throw new api.Error('CONFIG_INCOMPLETE', 'Magic Link 回跳網址必須是與目前網站同源的精確 HTTPS 網址，且不可含查詢參數或片段。');
    }
    return redirect.href;
  }

  function resetForm() {
    $('announcementId').value = '';
    $('announcementTitle').value = '';
    $('announcementContent').value = '';
    $('announcementStatusField').value = 'draft';
    $('announcementPinned').checked = false;
    $('editorTitle').textContent = '新增公告';
    delete form.dataset.expectedVersion;
  }

  async function action(button, task) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      await task();
    } catch (error) {
      setStatus(`操作失敗：${error?.message || '未知錯誤'}（${error?.code || 'UNKNOWN_ERROR'}）`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function edit(id) {
    const row = rows.find((item) => String(item.id) === String(id));
    if (!row) return;
    $('announcementId').value = row.id;
    $('announcementTitle').value = row.title;
    $('announcementContent').value = row.content;
    $('announcementStatusField').value = row.status;
    $('announcementPinned').checked = Boolean(row.is_pinned);
    $('editorTitle').textContent = '編輯公告';
    form.dataset.expectedVersion = String(row.version || 1);
    window.scrollTo({top:editorPanel.offsetTop - 10, behavior:'smooth'});
  }

  function record(row) {
    const article = element('article', null, 'admin-record');
    article.append(element('h3', row.title));
    const content = element('p', row.content);
    content.style.whiteSpace = 'pre-wrap';
    article.append(content);
    const badges = document.createElement('div');
    badges.append(element('span', row.status === 'published' ? '已發布' : '草稿', 'badge'));
    if (row.is_pinned) badges.append(element('span', '置頂', 'badge is-pinned'));
    article.append(badges);
    const actions = element('div', null, 'admin-actions');
    actions.style.marginTop = '12px';
    const editButton = element('button', '編輯');
    const publishButton = element('button', row.status === 'published' ? '下架' : '發布', 'secondary');
    const pinButton = element('button', row.is_pinned ? '取消置頂' : '置頂', 'secondary');
    [editButton,publishButton,pinButton].forEach((button) => { button.type = 'button'; });
    editButton.addEventListener('click', () => edit(row.id));
    publishButton.addEventListener('click', () => action(publishButton, async () => {
      const published = row.status !== 'published';
      await save({...row, status:published ? 'published' : 'draft'});
      setStatus(published ? '公告已發布。' : '公告已下架為草稿。');
    }));
    pinButton.addEventListener('click', () => action(pinButton, async () => {
      await save({...row, is_pinned:!row.is_pinned});
      setStatus(row.is_pinned ? '已取消置頂。' : '已設為置頂。');
    }));
    actions.append(editButton, publishButton, pinButton);
    article.append(actions);
    return article;
  }

  function render() {
    rowsBox.replaceChildren();
    if (!rows.length) {
      rowsBox.append(element('p', '目前沒有公告。', 'muted'));
      return;
    }
    rows.forEach((row) => rowsBox.append(record(row)));
  }

  async function refresh() {
    const result = await rpc.adminListAnnouncements({limit:50, cursor:null});
    rows = Array.isArray(result?.rows) ? result.rows : [];
    render();
  }

  async function save(row) {
    const payload = {
      title:String(row.title || '').trim(),
      content:String(row.content || '').trim(),
      status:row.status === 'published' ? 'published' : 'draft',
      is_pinned:Boolean(row.is_pinned)
    };
    if (row.id) {
      payload.id = row.id;
      payload.expected_version = Number(row.version || 1);
    }
    await rpc.adminSaveAnnouncement(payload);
    await refresh();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    action(submit, async () => {
      const id = $('announcementId').value;
      const payload = {
        title:$('announcementTitle').value.trim(),
        content:$('announcementContent').value.trim(),
        status:$('announcementStatusField').value === 'published' ? 'published' : 'draft',
        is_pinned:$('announcementPinned').checked
      };
      if (id) {
        payload.id = id;
        payload.version = Number(form.dataset.expectedVersion || 1);
      }
      await save(payload);
      resetForm();
      setStatus(id ? '公告已更新。' : '公告已新增。');
    });
  });

  $('cancelEdit').addEventListener('click', resetForm);
  async function signOut() {
    if (meta.mode === 'demo' || meta.mode === 'rpcmock') {
      setStatus('本機候選沒有真實登入狀態。');
      return;
    }
    const {error} = await authClient?.auth.signOut({scope:'local'});
    if (error) throw error;
    showSignedOut('已登出目前裝置。');
  }

  $('signOut').addEventListener('click', () => action($('signOut'), signOut));
  loginSignOut.addEventListener('click', () => action(loginSignOut, signOut));

  sendMagicLink.addEventListener('click', () => action(sendMagicLink, async () => {
    if (meta.mode !== 'rpc' || !authClient) throw new api.Error('DISABLED', 'Magic Link 只在公告 RPC 候選完整設定後可用。');
    if (!emailInput.value.trim() || !emailInput.checkValidity()) {
      emailInput.reportValidity();
      throw new api.Error('VALIDATION_ERROR', '請輸入有效的管理員信箱。');
    }
    const {error} = await authClient.auth.signInWithOtp({
      email:emailInput.value.trim(),
      options:{emailRedirectTo:exactRedirectUrl(), shouldCreateUser:false}
    });
    if (error) throw error;
    setStatus('若此信箱為預先建立的管理帳號，系統會寄出登入連結；真正權限仍由資料庫驗證。');
  }));

  // 統一的受控錯誤呈現（獨立驗收 m-03）：任何 refresh／init 失敗都必須讓測試者
  // 在畫面上看到錯誤碼與訊息，不得只留在 console，也不得產生未處理的 page error。
  function showFailure(context, error) {
    const normalized = error || {};
    const code = normalized.code || 'UNKNOWN_ERROR';
    const message = normalized.message || '未知錯誤。';
    setStatus(`${context}失敗：${code}`);
    rowsBox.replaceChildren(
      element('p', `錯誤碼：${code}`, 'muted'),
      element('p', `說明：${message}`, 'muted'),
      element('p', '資料未載入。請更正情境或重新整理後再試。', 'muted')
    );
  }

  async function init() {
    if (meta.mode === 'disabled') {
      if (meta.reason === 'MODE_CONFLICT') {
        setStatus('測試模式衝突，已停止。');
      } else if (meta.reason === 'TEST_MODE_BLOCKED') {
        setStatus('測試模式已封鎖：本組建非開發版本，或目前網址不是本機 loopback。');
      } else {
        setStatus('候選設定預設停用；未連線 Supabase。');
      }
      rowsBox.replaceChildren(element('p',
        meta.reason === 'TEST_MODE_BLOCKED'
          ? 'Demo 與 RPC Mock 僅能在開發組建且網址為 localhost／127.0.0.1／[::1] 時啟用。'
          : '請由內部測試入口選擇 Demo 或 RPC Mock。', 'muted'));
      return;
    }
    if (meta.mode === 'demo') {
      editorPanel.classList.remove('hidden');
      try { await refresh(); } catch (error) { showFailure('Demo 載入', error); return; }
      // 儲存是否被封鎖，要在實際存取過之後才知道，因此在 refresh 之後重新查詢。
      const blocked = api.create().describe().storageBlocked;
      setStatus(blocked
        ? '本機 Demo 已啟用；瀏覽器封鎖 localStorage，已改用記憶體暫存（重新整理後不保留）。'
        : '本機 localStorage Demo 已啟用；只准使用假資料。');
      return;
    }
    if (meta.mode === 'rpcmock') {
      if (meta.role !== 'admin') {
        setStatus(`RPC Mock 權限拒絕：角色 ${meta.role} 不是管理者。`);
        try { await refresh(); } catch (error) { rowsBox.replaceChildren(element('p', `拒絕原因：${error.code}`, 'muted')); }
        return;
      }
      editorPanel.classList.remove('hidden');
      setStatus(`RPC Mock 管理者候選已啟用；情境=${meta.scenario}，只用記憶體假資料。`);
      try { await refresh(); } catch (error) { showFailure('RPC Mock 載入', error); }
      return;
    }
    try {
      authClient = api.getSupabaseClient();
      const authState = authClient.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => action(null, () => applySession(session)), 0);
      });
      authSubscription = authState.data.subscription;
      const {data:{session}, error} = await authClient.auth.getSession();
      if (error) throw error;
      await applySession(session);
    } catch (error) {
      setStatus(`初始化失敗：${error?.message || '未知錯誤'}`);
    }
  }

  window.addEventListener('pagehide', () => authSubscription?.unsubscribe(), {once:true});
  // 最外層保護（獨立驗收 m-03）：init() 任何未預期的失敗都轉為受控錯誤 UI，
  // 不得逸出成 unhandled promise rejection / page error。
  init().catch((error) => showFailure('初始化', error));
})();
