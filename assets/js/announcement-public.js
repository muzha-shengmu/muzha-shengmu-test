(() => {
  'use strict';

  const api = window.MZSM_RPC_CLIENT;
  if (!api) return;
  const client = api.create();
  const meta = client.describe();
  if (meta.mode === 'disabled') return; // 預設不改動 r5 公開畫面。

  const section = document.querySelector('main .section');
  const note = document.querySelector('main .note');
  if (!section || !note) return;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-TW', {year:'numeric', month:'2-digit', day:'2-digit'});
  }

  function setNote(title, message) {
    note.replaceChildren();
    note.append(element('b', title), document.createElement('br'), document.createTextNode(message));
  }

  function announcementRecord(row) {
    const details = element('details', null, 'record');
    details.style.margin = '12px 0';
    details.style.padding = '15px';
    details.style.background = '#fffaf1';
    details.style.border = '1px solid #dac4a1';
    details.style.borderRadius = '8px';
    const summary = document.createElement('summary');
    summary.style.cursor = 'pointer';
    summary.append(element('b', row.title));
    const badges = document.createElement('div');
    badges.style.marginTop = '8px';
    if (row.is_pinned) badges.append(element('span', '置頂公告', 'badge is-pinned'));
    const date = formatDate(row.published_at);
    if (date) badges.append(element('span', date, 'badge'));
    summary.append(badges);
    const content = element('p', row.content);
    content.style.whiteSpace = 'pre-wrap';
    details.append(summary, content);
    return details;
  }

  function render(rows) {
    section.replaceChildren();
    section.append(element('h2', '最新公告', 'heading'));
    const list = element('div', null, 'table-list');
    list.id = 'announcementList';
    if (rows.length) rows.forEach((row) => list.append(announcementRecord(row)));
    else {
      const empty = element('article', null, 'feature');
      empty.append(element('h3', '目前尚無已發布公告'), element('p', '最新訊息以宮方正式公告為準。'));
      list.append(empty);
    }
    section.append(list);
    if (meta.mode === 'demo') setNote('本機公告 Demo', '資料只存在目前瀏覽器；請勿視為正式公告。');
    else if (meta.mode === 'rpcmock') setNote('公告 RPC Mock 候選', `記憶體假資料；情境=${meta.scenario}，未連線 Supabase。`);
    else setNote('木柵聖母宮最新公告', '只透過公開 RPC 讀取已發布資料；管理入口未置於公開導覽。');
  }

  client.publicListAnnouncements({limit:50, cursor:null})
    .then((result) => render(Array.isArray(result?.rows) ? result.rows : []))
    .catch((error) => setNote('公告暫時無法同步。', `請稍後重新整理；最新訊息以宮方正式公告為準。（${error?.code || 'UNKNOWN_ERROR'}）`));
})();
