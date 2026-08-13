// Supabase 連不上時，網站應該給出明確錯誤，而不是壞掉或無聲失敗。
// 這個沙箱的代理擋掉 supabase.co，正好可以真實重現這個情境。
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = 'http://127.0.0.1:8145';
const b = await chromium.launch();
let bad = 0, n = 0;
const ck = (t, ok, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'PASS ' : 'FAIL '} ${t}${d ? '  → ' + d : ''}`); };

async function load(page) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 110)));
  await p.goto(`${B}/${page}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  return { p, errs };
}

{
  const { p, errs } = await load('announcements.html');
  ck('公告頁 無未攔截例外', errs.length === 0, errs[0] || '');
  const body = await p.innerText('body');
  ck('公告頁 仍顯示內容而非全白', body.length > 100, `${body.length} 字`);
  await p.close();
}

{
  const { p, errs } = await load('pilgrimage.html');
  ck('進香頁 無未攔截例外', errs.length === 0, errs[0] || '');
  await p.fill('#pName', '連線測試');
  await p.fill('#pPhone', '0912345678');
  await p.click('#pilgrimageForm button[type=submit]');
  await p.waitForTimeout(11000);
  const t = await p.locator('#pCreated').innerText().catch(() => '');
  ck('進香 連不上時有明確錯誤訊息', /失敗|錯誤|逾時|連線|再試/.test(t), t.replace(/\n/g, ' ').slice(0, 90));
  ck('進香 送出鍵已恢復可按（沒卡死）',
     !(await p.locator('#pilgrimageForm button[type=submit]').isDisabled()));
  await p.close();
}

{
  const { p, errs } = await load('light.html');
  ck('點燈頁 無未攔截例外', errs.length === 0, errs[0] || '');
  await p.fill('#lName', '連線測試');
  await p.fill('#lPhone', '0912345678');
  await p.fill('#lTarget', '對象');
  await p.click('#lightForm button[type=submit]');
  await p.waitForTimeout(11000);
  const t = await p.locator('#lCreated').innerText().catch(() => '');
  ck('點燈 連不上時有明確錯誤訊息', /失敗|錯誤|逾時|連線|再試/.test(t), t.replace(/\n/g, ' ').slice(0, 90));
  await p.close();
}

{
  const { p, errs } = await load('admin.html');
  ck('後台 無未攔截例外', errs.length === 0, errs[0] || '');
  await p.waitForTimeout(2000);
  const t = await p.innerText('#adminStatus');
  ck('後台 狀態不是停在「初始化中」', t.trim().length > 0 && !t.includes('初始化中'), t.slice(0, 80));
  const hidden = await p.locator('#consolePanel').evaluate(e => e.classList.contains('hidden'));
  ck('後台 連不上時不會誤顯示資料區', hidden);
  await p.close();
}

console.log(`\n${n - bad}/${n} passed`);
await b.close();
process.exit(bad ? 1 : 0);
