(() => {
  'use strict';

  // 宮務後台：點燈／南巡進香／安太歲三類登記的檢視與狀態更新。
  // 公告有自己的編輯器（announcement-admin.js），這裡不重複。
  //
  // 權限一律由資料庫端決定：本檔只負責把 RPC 丟出去、把錯誤顯示出來。
  // 前端「看起來像管理者」不代表拿得到資料——後端每一支都會先驗管理者名單。

  const cfg = window.MZSM_RPC_CONFIG || window.MZSM_ANNOUNCEMENT_CONFIG || {};
  const api = window.MZSM_RPC_CLIENT;
  if (!api) return;
  const client = api.create();
  const meta = client.describe();
  const $ = (id) => document.getElementById(id);

  const statusBox = $('adminStatus');
  const loginPanel = $('loginPanel');
  const consolePanel = $('consolePanel');
  const emailInput = $('adminEmailInput');
  const sendMagicLink = $('sendMagicLink');
  const loginSignOut = $('loginSignOut');
  const signOut = $('signOut');

  let authClient = null;
  let authSubscription = null;
  let authSequence = 0;
  // 按下登出後，onAuthStateChange 會緊接著以 session=null 再跑一次 applySession。
  // 若兩邊各自寫狀態訊息，確認訊息會被預設訊息蓋掉，使用者就看不到「已登出」。
  // 因此登出訊息只留一份在這裡，由後續那次 showSignedOut 取用一次。
  let signedOutNotice = '';

  const SECTIONS = [
    {
      key: 'light',
      label: '點燈',
      box: 'lightRows',
      list: (p) => client.adminListLights(p),
      update: (p) => client.adminUpdateLight(p),
      title: (r) => `${r.id}｜${r.name}`,
      details: (r) => [
        ['燈別', r.type], ['祈福對象', r.target], ['國曆生日', r.birth || '—'],
        ['手機末四碼', r.phone_last4], ['登記日', r.created_at], ['備註', r.note || '—']
      ],
      badges: (r) => [r.status, r.pay],
      actions: [
        { label: '標為已確認', patch: { status: '已確認' }, hide: (r) => r.status === '已確認' },
        { label: '登錄已繳費', patch: { pay: '已繳' }, hide: (r) => r.pay === '已繳' },
        { label: '取消登記', patch: { status: '已取消' }, hide: (r) => r.status === '已取消' }
      ]
    },
    {
      key: 'pilgrimage',
      label: '南巡進香',
      box: 'pilgrimageRows',
      list: (p) => client.adminListPilgrimage(p),
      update: (p) => client.adminUpdatePilgrimage(p),
      title: (r) => `${r.id}｜${r.name}`,
      details: (r) => [
        ['人數', `成人 ${r.adult}、孩童 ${r.child}`],
        ['手機末四碼', r.phone_last4], ['報名日', r.created_at], ['備註', r.note || '—']
      ],
      badges: (r) => [r.status],
      actions: [
        { label: '標為已確認', patch: { status: '已確認' }, hide: (r) => r.status === '已確認' },
        { label: '取消報名', patch: { status: '已取消' }, hide: (r) => r.status === '已取消' }
      ]
    },
    {
      key: 'taisui',
      label: '安太歲',
      box: 'taisuiRows',
      list: (p) => client.adminListTaisui(p),
      update: (p) => client.adminUpdateTaisui(p),
      title: (r) => `${r.id}｜${r.name}`,
      details: (r) => [
        ['祈福對象', r.target], ['國曆生日', r.birth],
        ['手機末四碼', r.phone_last4], ['登記日', r.created_at], ['備註', r.note || '—']
      ],
      badges: (r) => [r.status, r.lunar_status === 'confirmed' ? '農曆已核對' : '農曆待核對'],
      actions: [
        { label: '標為已確認', patch: { status: '已確認' }, hide: (r) => r.status === '已確認' },
        { label: '農曆已核對', patch: { lunar_status: 'confirmed' }, hide: (r) => r.lunar_status === 'confirmed' },
        { label: '取消登記', patch: { status: '已取消' }, hide: (r) => r.status === '已取消' }
      ]
    }
  ];

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function setStatus(message) {
    statusBox.textContent = message;
  }

  function messageFor(error) {
    const code = error?.code || 'UNKNOWN_ERROR';
    const known = {
      FORBIDDEN: '目前帳號沒有宮務管理權限。',
      UNAUTHENTICATED: '請先登入管理者帳號。',
      CONFLICT: '這筆資料已被其他人更新，已重新載入最新狀態。',
      NOT_FOUND: '查無此筆資料，可能已被刪除。',
      VALIDATION_ERROR: '送出的內容不正確。',
      TIMEOUT: '連線逾時，狀態未變更，請再試一次。',
      NETWORK_ERROR: '網路連線失敗，狀態未變更，請再試一次。'
    };
    return `${known[code] || error?.message || '操作失敗。'}（${code}）`;
  }

  function renderSection(section, rows) {
    const box = $(section.box);
    box.replaceChildren();
    if (!rows.length) {
      box.append(element('p', `目前沒有${section.label}登記資料。`, 'muted'));
      return;
    }
    rows.forEach((row) => {
      const article = element('article', null, 'record');
      article.append(element('h3', section.title(row)));
      const details = element('p');
      section.details(row).forEach(([label, value]) => {
        details.append(document.createTextNode(`${label}：${value ?? '—'}`));
        details.append(document.createElement('br'));
      });
      section.badges(row).forEach((value) => details.append(element('span', value, 'badge')));
      article.append(details);

      const visible = section.actions.filter((action) => !action.hide(row));
      if (visible.length) {
        const bar = element('div', null, 'row');
        bar.style.marginTop = '12px';
        visible.forEach((action) => {
          const button = element('button', action.label, 'btn');
          button.type = 'button';
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await section.update({
                id: row.id,
                expected_version: Number(row.version),
                ...action.patch
              });
              setStatus(`${row.id}：${action.label} 完成。`);
              await load(section);
            } catch (error) {
              setStatus(messageFor(error));
              // 版本衝突代表別人剛改過，重新載入才看得到真實狀態
              if (error?.code === 'CONFLICT') await load(section);
            } finally {
              button.disabled = false;
            }
          });
          bar.append(button);
        });
        article.append(bar);
      }
      box.append(article);
    });
  }

  async function load(section) {
    const box = $(section.box);
    try {
      const result = await section.list({ limit: 100, cursor: null });
      renderSection(section, result.rows || []);
      return true;
    } catch (error) {
      box.replaceChildren(element('p', messageFor(error), 'muted'));
      throw error;
    }
  }

  async function loadAll() {
    for (const section of SECTIONS) await load(section);
  }

  function setupTabs() {
    const buttons = [...document.querySelectorAll('#consoleTabs button[data-tab]')];
    const panels = [...document.querySelectorAll('#consolePanel .panel')];
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        buttons.forEach((item) => item.classList.toggle('active', item === button));
        panels.forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tab));
      });
    });
  }

  function showSignedOut(message) {
    const text = message || signedOutNotice || '尚未登入。宮務資料需要登入且通過資料庫管理者名單驗證。';
    signedOutNotice = '';
    loginPanel.classList.remove('hidden');
    consolePanel.classList.add('hidden');
    sendMagicLink.classList.remove('hidden');
    loginSignOut.classList.add('hidden');
    signOut.classList.add('hidden');
    emailInput.disabled = false;
    setStatus(text);
  }

  function showUnauthorized(email) {
    loginPanel.classList.remove('hidden');
    consolePanel.classList.add('hidden');
    sendMagicLink.classList.add('hidden');
    loginSignOut.classList.remove('hidden');
    // 沒有權限也還是「已登入」狀態，上方的登出鍵必須可用，
    // 否則使用者會卡在無權限畫面換不了帳號。
    signOut.classList.remove('hidden');
    emailInput.value = String(email || '');
    emailInput.disabled = true;
    setStatus('已登入，但這個帳號不在宮務管理者名單內；請登出後改用已授權帳號。');
  }

  async function applySession(session) {
    const sequence = ++authSequence;
    if (!session) return showSignedOut();
    try {
      await loadAll();
      if (sequence !== authSequence) return;
      loginPanel.classList.add('hidden');
      consolePanel.classList.remove('hidden');
      signOut.classList.remove('hidden');
      setStatus(`已登入：${session.user?.email || ''}`);
    } catch (error) {
      if (sequence !== authSequence) return;
      if (error?.code === 'FORBIDDEN' || error?.code === 'UNAUTHENTICATED') {
        return showUnauthorized(session.user?.email);
      }
      setStatus(messageFor(error));
    }
  }

  // Magic Link 回跳網址必須是與本站同源的精確 https 網址，避免變成開放轉址。
  function exactRedirectUrl() {
    let redirect;
    try { redirect = new URL(String(cfg.authRedirectUrl || '')); } catch (_) {}
    if (!redirect || redirect.protocol !== 'https:' || redirect.username || redirect.password
        || redirect.origin !== window.location.origin || redirect.search || redirect.hash) {
      throw new api.Error('CONFIG_INCOMPLETE',
        'Magic Link 回跳網址必須是與目前網站同源的精確 HTTPS 網址，且不可含查詢參數或片段。');
    }
    return redirect.href;
  }

  sendMagicLink?.addEventListener('click', async () => {
    sendMagicLink.disabled = true;
    try {
      const email = String(emailInput.value || '').trim();
      if (!email) return setStatus('請先輸入管理者信箱。');
      const redirect = exactRedirectUrl();
      const { error } = await api.getSupabaseClient().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirect, shouldCreateUser: false }
      });
      if (error) throw error;
      setStatus('若這個信箱是預先建立的管理帳號，登入連結已寄出；實際權限仍由資料庫驗證。');
    } catch (error) {
      setStatus(`寄送失敗：${error?.message || '未知錯誤'}（${error?.code || 'UNKNOWN_ERROR'}）`);
    } finally {
      sendMagicLink.disabled = false;
    }
  });

  [signOut, loginSignOut].forEach((button) => button?.addEventListener('click', async () => {
    button.disabled = true;
    try {
      signedOutNotice = '已登出。';
      await api.getSupabaseClient().auth.signOut();
      emailInput.disabled = false;
      emailInput.value = '';
      // 這裡刻意不呼叫 showSignedOut()：onAuthStateChange 會以 session=null
      // 在稍後（setTimeout 0）觸發它，而且一定跑在這行之後。若兩邊都畫一次，
      // 後跑的那次會拿不到 signedOutNotice，反而把「已登出」蓋回預設訊息。
      // 登出後的畫面狀態一律交給 auth 事件這條唯一路徑。
    } catch (error) {
      setStatus(`登出失敗：${error?.message || '未知錯誤'}`);
    } finally {
      button.disabled = false;
    }
  }));

  $('refreshAll')?.addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await loadAll();
      setStatus('已重新載入。');
    } catch (error) {
      setStatus(messageFor(error));
    } finally {
      event.target.disabled = false;
    }
  });

  async function init() {
    setupTabs();

    if (meta.mode === 'disabled') {
      loginPanel.classList.add('hidden');
      setStatus('線上服務目前停用中；尚未設定 Supabase 連線。');
      SECTIONS.forEach((section) =>
        $(section.box).replaceChildren(element('p', '尚未連線資料庫。', 'muted')));
      return;
    }

    // 本機開發模式（demo / rpcmock）沒有真的登入流程，直接載入。
    if (meta.mode === 'demo' || meta.mode === 'rpcmock') {
      loginPanel.classList.add('hidden');
      consolePanel.classList.remove('hidden');
      setStatus(`本機 ${meta.mode} 模式；資料為假資料，不連線 Supabase。`);
      try { await loadAll(); } catch (error) { setStatus(messageFor(error)); }
      return;
    }

    try {
      authClient = api.getSupabaseClient();
      const authState = authClient.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => applySession(session), 0);
      });
      authSubscription = authState.data.subscription;
      const { data: { session }, error } = await authClient.auth.getSession();
      if (error) throw error;
      await applySession(session);
    } catch (error) {
      setStatus(`初始化失敗：${error?.message || '未知錯誤'}`);
    }
  }

  window.addEventListener('pagehide', () => authSubscription?.unsubscribe(), { once: true });
  init().catch((error) => setStatus(`初始化失敗：${error?.message || '未知錯誤'}`));
})();
