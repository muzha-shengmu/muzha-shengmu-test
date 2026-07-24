(() => {
  'use strict';

  const page = document.currentScript?.dataset.page || '';
  const api = window.MZSM_RPC_CLIENT;
  if (!api) return;
  const client = api.create();
  const meta = client.describe();
  const $ = (id) => document.getElementById(id);
  document.querySelectorAll('.tabs button').forEach((button) => { button.style.minHeight = '44px'; });

  function clear(node) {
    if (node) node.replaceChildren();
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function setModeNote(title) {
    const note = document.querySelector('main .note');
    if (!note) return;
    clear(note);
    note.append(element('b', title));
    note.append(document.createElement('br'));
    if (meta.mode === 'demo') note.append(document.createTextNode('本機 localStorage Demo；只准使用假資料，不連線 Supabase。'));
    else if (meta.mode === 'rpcmock') note.append(document.createTextNode(`RPC Mock 記憶體候選；角色=${meta.role}、情境=${meta.scenario}，重新整理即重置，不連線 Supabase。`));
    else if (meta.mode === 'rpc') note.append(document.createTextNode('RPC 候選模式；正式啟用仍須後端契約、權限與人工驗證。'));
    else note.append(document.createTextNode(meta.reason === 'MODE_CONFLICT' ? 'demo 與 rpcmock 不可同時啟用；目前已停止。' : '預設停用。請由內部測試入口選擇 Demo 或 RPC Mock。'));
  }

  function disablePage() {
    document.querySelectorAll('form input,form textarea,form select,form button').forEach((node) => { node.disabled = true; });
  }

  function messageFor(error) {
    const code = error?.code || 'UNKNOWN_ERROR';
    const known = {
      VALIDATION_ERROR: '欄位內容不符合候選契約。',
      FIELD_NOT_ALLOWED: '送出的欄位超出候選契約。',
      FORBIDDEN: '目前角色沒有執行此操作的權限。',
      UNAUTHENTICATED: '尚未完成登入。',
      NOT_FOUND: '找不到指定資料。',
      CONFLICT: '資料版本衝突，請重新載入後再試。',
      TIMEOUT: 'RPC Mock 逾時，未重複送出。',
      NETWORK_ERROR: 'RPC Mock 網路錯誤，未重複送出。',
      DISABLED: 'RPC 候選目前停用。',
      MODE_CONFLICT: '測試模式互相衝突，已停止。'
    };
    return `${known[code] || error?.message || '操作失敗。'}（${code}）`;
  }

  function renderResult(container, {title, rows = [], badges = [], error = false}) {
    if (!container) return;
    clear(container);
    const box = element('div', null, `result${error ? ' error' : ''}`);
    if (title) box.append(element('b', title));
    rows.forEach(([label, value]) => {
      box.append(document.createElement('br'));
      box.append(document.createTextNode(`${label}：${value ?? '—'}`));
    });
    if (badges.length) {
      box.append(document.createElement('br'));
      badges.forEach((value) => box.append(element('span', value, 'badge')));
    }
    container.append(box);
  }

  function renderError(container, error) {
    renderResult(container, {title: messageFor(error), error: true});
  }

  async function locked(form, task) {
    const buttons = [...form.querySelectorAll('button[type="submit"]')];
    if (form.dataset.submitting === '1') return;
    form.dataset.submitting = '1';
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await task();
    } finally {
      delete form.dataset.submitting;
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function idempotencyKey(form) {
    if (!form.dataset.idempotencyKey) {
      const uuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      form.dataset.idempotencyKey = `mzsm-${uuid}`;
    }
    return form.dataset.idempotencyKey;
  }

  function clearIdempotencyOnChange(form) {
    form.addEventListener('input', () => { delete form.dataset.idempotencyKey; });
  }

  function setupTabs(tabBox, panels) {
    if (!tabBox) return;
    const buttons = [...tabBox.querySelectorAll(':scope > button[data-tab]')];
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        buttons.forEach((item) => item.classList.toggle('active', item === button));
        panels.forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tab));
      });
    });
  }

  function applyLimits(entries) {
    entries.forEach(([id, maxLength]) => {
      const node = $(id);
      if (node) node.maxLength = maxLength;
    });
  }

  function numericValue(id) {
    const value = Number($(id)?.value || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function initPilgrimage() {
    setModeNote('南巡進香內部候選頁。');
    setupTabs(document.querySelector('#action > .tabs'), [...document.querySelectorAll('#action > .panel')]);
    applyLimits([['pName',80],['pPhone',10],['pNote',500],['pCode',80],['pLast',4]]);
    const form = $('pilgrimageForm');
    const lookup = $('pLookup');
    const fare = $('pFare');
    clearIdempotencyOnChange(form);

    function showFare() {
      if (meta.mode === 'demo') {
        const adult = Math.max(0, numericValue('pAdult'));
        const child = Math.max(0, numericValue('pChild'));
        const total = adult * 3000 + child * 1500;
        fare.textContent = `Demo 試算：成人 ${adult} 位 × 3,000 元；孩童 ${child} 位 × 1,500 元；合計 ${total.toLocaleString('zh-TW')} 元。非正式價目。`;
      } else {
        fare.textContent = 'RPC 候選不在前端計算或提交正式金額；費用須由後端核定。';
      }
    }
    $('pAdult').addEventListener('input', showFare);
    $('pChild').addEventListener('input', showFare);
    showFare();

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      locked(form, async () => {
        try {
          const result = await client.publicCreatePilgrimage({
            name:$('pName').value.trim(),
            phone:$('pPhone').value.trim(),
            adult:numericValue('pAdult'),
            child:numericValue('pChild'),
            note:$('pNote').value.trim(),
            idempotency_key:idempotencyKey(form)
          });
          const rows = [['報名碼',result.code],['狀態',result.status]];
          if (meta.mode === 'demo' && result.demo_total != null) rows.push(['Demo 試算合計',`${Number(result.demo_total).toLocaleString('zh-TW')} 元（非正式）`]);
          renderResult($('pCreated'), {title:'候選報名建立完成', rows});
          delete form.dataset.idempotencyKey;
        } catch (error) {
          renderError($('pCreated'), error);
        }
      });
    });

    lookup.addEventListener('submit', (event) => {
      event.preventDefault();
      locked(lookup, async () => {
        try {
          const {record} = await client.publicLookupPilgrimage({code:$('pCode').value.trim(), last4:$('pLast').value.trim()});
          if (!record) return renderResult($('pOut'), {title:'查無符合的測試資料。', error:true});
          renderResult($('pOut'), {title:record.code, rows:[['人數',`成人 ${record.adult}、孩童 ${record.child}`]], badges:[record.status]});
        } catch (error) {
          renderError($('pOut'), error);
        }
      });
    });
    if (meta.mode === 'disabled') disablePage();
  }

  function initLight() {
    setModeNote('點燈祈福內部候選頁。');
    const birthLabel = document.querySelector('label[for="lBirth"]');
    if (birthLabel) birthLabel.textContent = '國曆生日（可留白）';
    setupTabs(document.querySelector('#action > .tabs'), [...document.querySelectorAll('#action > .panel')]);
    applyLimits([['lName',80],['lPhone',10],['lTarget',80],['lBirth',10],['lNote',500],['lCode',80],['lLast',4]]);
    const form = $('lightForm');
    const lookup = $('lightQuery');
    clearIdempotencyOnChange(form);
    $('lBirth').placeholder = '例如：2000-01-01（國曆）';

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      locked(form, async () => {
        try {
          const result = await client.publicCreateLight({
            name:$('lName').value.trim(),
            phone:$('lPhone').value.trim(),
            type:$('lType').value,
            target:$('lTarget').value.trim(),
            birth:$('lBirth').value.trim(),
            note:$('lNote').value.trim(),
            idempotency_key:idempotencyKey(form)
          });
          renderResult($('lCreated'), {title:'候選點燈登記完成', rows:[['點燈碼',result.code],['燈別',result.type]], badges:[result.status]});
          delete form.dataset.idempotencyKey;
        } catch (error) {
          renderError($('lCreated'), error);
        }
      });
    });

    lookup.addEventListener('submit', (event) => {
      event.preventDefault();
      locked(lookup, async () => {
        try {
          const {record} = await client.publicLookupLight({code:$('lCode').value.trim(), last4:$('lLast').value.trim()});
          if (!record) return renderResult($('lOut'), {title:'查無符合的測試資料。', error:true});
          renderResult($('lOut'), {title:record.code, rows:[['燈別',record.type],['祈福對象',record.target]], badges:[record.status]});
        } catch (error) {
          renderError($('lOut'), error);
        }
      });
    });
    if (meta.mode === 'disabled') disablePage();
  }

  function lightAdminRecord(row, refresh) {
    const article = element('article', null, 'record');
    article.append(element('h3', `${row.id}｜${row.name}`));
    const details = element('p');
    [['燈別',row.type],['祈福對象',row.target],['手機末四碼',row.phone_last4],['版本',row.version]].forEach(([label,value]) => {
      details.append(document.createTextNode(`${label}：${value}`));
      details.append(document.createElement('br'));
    });
    details.append(element('span', row.status, 'badge'));
    details.append(element('span', row.pay, 'badge'));
    article.append(details);
    const actions = element('div', null, 'row');
    actions.style.marginTop = '12px';
    const confirm = element('button', '確認資料', 'btn');
    const paid = element('button', '登錄現金已繳', 'btn');
    confirm.type = paid.type = 'button';
    const update = async (patch, button) => {
      button.disabled = true;
      try {
        await client.adminUpdateLight({id:row.id, expected_version:Number(row.version), ...patch});
        await refresh();
      } catch (error) {
        renderError($('adminRows'), error);
      } finally {
        button.disabled = false;
      }
    };
    confirm.addEventListener('click', () => update({status:'已確認'}, confirm));
    paid.addEventListener('click', () => update({pay:'已繳'}, paid));
    actions.append(confirm, paid);
    article.append(actions);
    return article;
  }

  function initLightAdmin() {
    setModeNote('點燈宮務後台 RPC 候選頁。');
    const rowsBox = $('adminRows');
    async function refresh() {
      clear(rowsBox);
      try {
        const result = await client.adminListLights({limit:50, cursor:null});
        if (!result.rows?.length) return rowsBox.append(element('div', '目前沒有測試資料。', 'record'));
        result.rows.forEach((row) => rowsBox.append(lightAdminRecord(row, refresh)));
      } catch (error) {
        renderError(rowsBox, error);
      }
    }
    if (meta.mode === 'disabled') {
      disablePage();
      renderResult(rowsBox, {title:'候選功能預設停用。', error:true});
      return;
    }
    refresh();
  }

  function initLightQuery() {
    setModeNote('點燈最小欄位查詢候選頁。');
    document.title = '點燈最小欄位查詢｜木柵聖母宮｜內部測試';
    const heroTitle = document.querySelector('.hero h1');
    const heroCopy = document.querySelector('.hero p');
    const heading = document.querySelector('#action .heading');
    if (heroTitle) heroTitle.textContent = '點燈最小欄位查詢';
    if (heroCopy) heroCopy.textContent = '只顯示候選契約允許的最小資料。';
    if (heading) heading.textContent = '候選查詢';
    applyLimits([['cqCode',80],['cqLast',4]]);
    const form = $('completeQuery');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      locked(form, async () => {
        try {
          const {record} = await client.publicLookupLight({code:$('cqCode').value.trim(), last4:$('cqLast').value.trim()});
          if (!record) return renderResult($('cqOut'), {title:'查無符合的測試資料。', error:true});
          renderResult($('cqOut'), {title:record.code, rows:[['燈別',record.type],['祈福對象',record.target]], badges:[record.status]});
        } catch (error) {
          renderError($('cqOut'), error);
        }
      });
    });
    if (meta.mode === 'disabled') disablePage();
  }

  function initTaisui() {
    setModeNote('安太歲內部 RPC 候選頁。');
    const heroCopy = document.querySelector('.hero p');
    const birthCard = $('birthModes')?.closest('.card');
    if (heroCopy) heroCopy.textContent = '前台測試登記與查詢；農曆、生肖及正式規範待後端或人工確認。';
    if (birthCard) {
      const title = birthCard.querySelector('h3');
      const copy = birthCard.querySelector('p');
      if (title) title.textContent = '生日輸入（不在前端換算）';
      if (copy) copy.textContent = '可輸入西元或民國年；候選版只提交原始國曆生日。';
    }
    setupTabs(document.querySelector('#action > .tabs'), [...document.querySelectorAll('#action > .panel')]);
    applyLimits([['tName',80],['tPhone',10],['tTarget',80],['tNote',500],['tCode',80],['tLast',4]]);
    const form = $('tsForm');
    const lookup = $('tsQuery');
    const preview = $('tPreview');
    const birthModes = $('birthModes');
    let mode = 'western';
    clearIdempotencyOnChange(form);

    function ymd() {
      let y = numericValue('tYear');
      const m = numericValue('tMonth');
      const d = numericValue('tDay');
      if (mode === 'roc') y += 1911;
      if (!y || !m || !d) return '';
      return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    function showBirth(value) {
      preview.textContent = value ? `國曆生日：${value}。農曆與生肖不由前端換算，須待後端或人工確認。` : '填寫國曆生日；本候選不在前端計算農曆與生肖。';
    }
    function syncFromParts() {
      const value = ymd();
      if (value) $('tPicker').value = value;
      showBirth(value);
    }
    birthModes.querySelectorAll('button[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        mode = button.dataset.mode;
        birthModes.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
        $('tYearLabel').textContent = mode === 'roc' ? '民國年' : '西元年';
        $('tYear').placeholder = mode === 'roc' ? '89' : '2000';
        syncFromParts();
      });
    });
    [$('tYear'),$('tMonth'),$('tDay')].forEach((node) => node.addEventListener('input', syncFromParts));
    $('tPicker').addEventListener('change', () => {
      if (!$('tPicker').value) return showBirth('');
      const parts = $('tPicker').value.split('-').map(Number);
      $('tYear').value = mode === 'roc' ? parts[0] - 1911 : parts[0];
      $('tMonth').value = parts[1];
      $('tDay').value = parts[2];
      showBirth($('tPicker').value);
    });
    showBirth('');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      locked(form, async () => {
        try {
          const birth = $('tPicker').value || ymd();
          const result = await client.publicCreateTaisui({
            name:$('tName').value.trim(),
            phone:$('tPhone').value.trim(),
            target:$('tTarget').value.trim(),
            birth,
            note:$('tNote').value.trim(),
            idempotency_key:idempotencyKey(form)
          });
          renderResult($('tCreated'), {title:'候選安太歲登記完成', rows:[['安太歲碼',result.code],['農曆／生肖','待後端或人工確認']], badges:[result.status]});
          delete form.dataset.idempotencyKey;
        } catch (error) {
          preview.classList.toggle('error', error?.code === 'VALIDATION_ERROR');
          renderError($('tCreated'), error);
        }
      });
    });

    lookup.addEventListener('submit', (event) => {
      event.preventDefault();
      locked(lookup, async () => {
        try {
          const {record} = await client.publicLookupTaisui({code:$('tCode').value.trim(), last4:$('tLast').value.trim()});
          if (!record) return renderResult($('tOut'), {title:'查無符合的測試資料。', error:true});
          renderResult($('tOut'), {title:record.code, rows:[['祈福對象',record.target],['國曆生日',record.birth],['農曆／生肖','待後端或人工確認']], badges:[record.status]});
        } catch (error) {
          renderError($('tOut'), error);
        }
      });
    });
    if (meta.mode === 'disabled') disablePage();
  }

  const initializers = {
    pilgrimage:initPilgrimage,
    light:initLight,
    'light-admin':initLightAdmin,
    'light-query':initLightQuery,
    taisui:initTaisui
  };
  initializers[page]?.();
})();
