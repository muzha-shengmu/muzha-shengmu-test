import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8140';
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
}

const browser = await chromium.launch({ ignoreHTTPSErrors: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });

async function open(path) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  return { page, errs };
}

const resultText = (page, sel) => page.locator(`${sel} .result`).first().innerText();

// ── 1. 南巡進香：報名 → 查詢 ────────────────────────────────────────────
{
  const { page, errs } = await open('pilgrimage.html');
  check('pilgrimage 載入無 JS 錯誤', errs.length === 0, errs[0] || '');
  check('pilgrimage 表單存在', await page.locator('#pilgrimageForm').count() === 1);

  await page.fill('#pName', '端對端測試甲');
  await page.fill('#pPhone', '0921000111');
  await page.fill('#pAdult', '2');
  await page.fill('#pChild', '1');
  await page.fill('#pNote', '端對端測試');
  await page.click('#pilgrimageForm button[type=submit]');
  await page.waitForSelector('#pCreated .result', { timeout: 10000 });
  const created = await resultText(page, '#pCreated');
  const code = (created.match(/MSM-\d{4}-\d{4}/) || [])[0];
  check('pilgrimage 報名成功並取得報名碼', Boolean(code), code || created.replace(/\n/g, ' '));

  // 正確末四碼
  await page.click('button[data-tab=pFind]');
  await page.fill('#pCode', code);
  await page.fill('#pLast', '0111');
  await page.click('#pLookup button[type=submit]');
  await page.waitForSelector('#pOut .result', { timeout: 10000 });
  const found = await resultText(page, '#pOut');
  check('pilgrimage 正確末四碼查得到', found.includes(code) && found.includes('成人 2'),
        found.replace(/\n/g, ' '));
  check('pilgrimage 查詢結果不含姓名', !found.includes('端對端測試甲'), found.replace(/\n/g, ' '));

  // 錯誤末四碼
  await page.fill('#pLast', '9999');
  await page.click('#pLookup button[type=submit]');
  await page.waitForTimeout(800);
  const miss = await resultText(page, '#pOut');
  check('pilgrimage 錯誤末四碼查無資料', miss.includes('查無'), miss.replace(/\n/g, ' '));

  // 伺服器端驗證確實生效（前端沒擋住也會被後端擋）
  await page.click('button[data-tab=pReg]');
  await page.fill('#pName', '格式測試');
  await page.fill('#pPhone', '12');
  await page.click('#pilgrimageForm button[type=submit]');
  await page.waitForTimeout(900);
  const bad = await resultText(page, '#pCreated');
  check('pilgrimage 錯誤手機被後端擋下', bad.includes('VALIDATION_ERROR'), bad.replace(/\n/g, ' '));
  await page.close();
}

// ── 2. 點燈：登記 → 查詢 ────────────────────────────────────────────────
let lightCode = '';
{
  const { page, errs } = await open('light.html');
  check('light 載入無 JS 錯誤', errs.length === 0, errs[0] || '');
  await page.fill('#lName', '端對端測試乙');
  await page.fill('#lPhone', '0933222444');
  await page.selectOption('#lType', '光明燈');
  await page.fill('#lTarget', '祈福對象乙');
  await page.fill('#lBirth', '1988-12-25');
  await page.click('#lightForm button[type=submit]');
  await page.waitForSelector('#lCreated .result', { timeout: 10000 });
  const created = await resultText(page, '#lCreated');
  lightCode = (created.match(/LMP-\d{4}-\d{4}/) || [])[0] || '';
  check('light 登記成功並取得點燈碼', Boolean(lightCode), lightCode || created.replace(/\n/g, ' '));

  await page.click('button[data-tab=lFind]');
  await page.fill('#lCode', lightCode);
  await page.fill('#lLast', '2444');
  await page.click('#lightQuery button[type=submit]');
  await page.waitForSelector('#lOut .result', { timeout: 10000 });
  const found = await resultText(page, '#lOut');
  check('light 查詢正確', found.includes('光明燈') && found.includes('祈福對象乙'), found.replace(/\n/g, ' '));
  check('light 查詢不含姓名/手機', !found.includes('端對端測試乙') && !found.includes('0933222444'));
  await page.close();
}

// ── 3. 點燈查詢單獨頁 ───────────────────────────────────────────────────
{
  const { page, errs } = await open('light-query.html');
  check('light-query 載入無 JS 錯誤', errs.length === 0, errs[0] || '');
  await page.fill('#cqCode', lightCode);
  await page.fill('#cqLast', '2444');
  await page.click('#completeQuery button[type=submit]');
  await page.waitForSelector('#cqOut .result', { timeout: 10000 });
  const found = await resultText(page, '#cqOut');
  check('light-query 查得到同一筆', found.includes(lightCode), found.replace(/\n/g, ' '));
  await page.close();
}

// ── 4. 點燈登記單獨頁（沒有查詢區塊，不該壞掉）──────────────────────────
{
  const { page, errs } = await open('light-register.html');
  check('light-register 載入無 JS 錯誤（頁面沒有查詢表單）', errs.length === 0, errs[0] || '');
  await page.fill('#lName', '端對端測試丙');
  await page.fill('#lPhone', '0955666777');
  await page.fill('#lTarget', '祈福對象丙');
  await page.click('#lightForm button[type=submit]');
  await page.waitForSelector('#lCreated .result', { timeout: 10000 });
  const created = await resultText(page, '#lCreated');
  check('light-register 可獨立完成登記', /LMP-\d{4}-\d{4}/.test(created), created.replace(/\n/g, ' '));
  await page.close();
}

// ── 5. 安太歲：民國年換算 → 登記 → 查詢 ─────────────────────────────────
{
  const { page, errs } = await open('taisui.html');
  check('taisui 載入無 JS 錯誤', errs.length === 0, errs[0] || '');

  // 切到民國年，輸入 79/5/20 應等於西元 1990-05-20
  await page.click('#birthModes button[data-mode=roc]');
  await page.fill('#tYear', '79');
  await page.fill('#tMonth', '5');
  await page.fill('#tDay', '20');
  await page.waitForTimeout(200);
  const picker = await page.inputValue('#tPicker');
  check('taisui 民國年正確換算為西元', picker === '1990-05-20', `tPicker=${picker}`);

  await page.fill('#tName', '端對端測試丁');
  await page.fill('#tPhone', '0977888999');
  await page.fill('#tTarget', '祈福對象丁');
  await page.click('#tsForm button[type=submit]');
  await page.waitForSelector('#tCreated .result', { timeout: 10000 });
  const created = await resultText(page, '#tCreated');
  const code = (created.match(/PEA-\d{4}-\d{4}/) || [])[0] || '';
  check('taisui 登記成功並取得安太歲碼', Boolean(code), code || created.replace(/\n/g, ' '));

  await page.click('button[data-tab=tFind]');
  await page.fill('#tCode', code);
  await page.fill('#tLast', '8999');
  await page.click('#tsQuery button[type=submit]');
  await page.waitForSelector('#tOut .result', { timeout: 10000 });
  const found = await resultText(page, '#tOut');
  check('taisui 查詢回傳正確生日', found.includes('1990-05-20'), found.replace(/\n/g, ' '));
  check('taisui 農曆標示為由宮方人工核對', found.includes('由宮方人工核對'), found.replace(/\n/g, ' '));
  await page.close();
}

// ── 6. 冪等：同一份表單連按兩次不得產生兩筆 ─────────────────────────────
{
  const { page } = await open('light.html');
  await page.fill('#lName', '冪等測試');
  await page.fill('#lPhone', '0912888777');
  await page.fill('#lTarget', '冪等對象');
  // 直接呼叫 client 兩次，用同一把 idempotency key，模擬重送
  const codes = await page.evaluate(async () => {
    const c = window.MZSM_RPC_CLIENT.create();
    const payload = {
      name: '冪等測試', phone: '0912888777', type: '平安燈',
      target: '冪等對象', birth: '', note: '',
      idempotency_key: 'e2e-idem-' + Date.now()
    };
    const a = await c.publicCreateLight(payload);
    const b = await c.publicCreateLight(payload);
    return [a.code, b.code];
  });
  check('冪等重送回傳同一個點燈碼', codes[0] === codes[1], codes.join(' vs '));
  await page.close();
}

// ── 7. 公告：民眾端只看得到已發佈 ───────────────────────────────────────
{
  const { page, errs } = await open('announcements.html');
  check('announcements 載入無 JS 錯誤', errs.length === 0, errs[0] || '');
  const body = await page.innerText('body');
  check('公告頁顯示已發佈公告', body.includes('置頂公告'), body.slice(0, 200).replace(/\n/g, ' '));
  check('公告頁不顯示草稿', !body.includes('草稿公告'));
  await page.close();
}

// ── 8. 未登入者拿不到後台資料 ───────────────────────────────────────────
{
  // 首頁本來就不載入 RPC，要用有載入的服務頁測
  const { page } = await open('light.html');
  const outcome = await page.evaluate(async () => {
    const c = window.MZSM_RPC_CLIENT.create();
    try {
      await c.adminListLights({ limit: 50, cursor: null });
      return 'ALLOWED';
    } catch (e) { return e.code; }
  });
  check('未登入呼叫後台被拒', outcome === 'FORBIDDEN' || outcome === 'UNAUTHENTICATED', outcome);
  await page.close();
}

console.log(`\n${results.length - failures}/${results.length} passed`);
await browser.close();
process.exit(failures ? 1 : 0);
