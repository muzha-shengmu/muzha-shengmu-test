import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const BASE = 'http://127.0.0.1:8140';
let failures = 0, total = 0;
function check(name, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
}

const browser = await chromium.launch({ ignoreHTTPSErrors: true });

async function adminPage(email) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 權限被拒時瀏覽器一定會記一筆 403 resource error，那是預期行為而非缺陷。
    // 未攔截的 JS 例外走 pageerror，仍然零容忍。
    if (/status of (401|403)/.test(t)) return;
    errs.push('console: ' + t);
  });
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  if (email) {
    // 走真正的 supabase-js 登入流程，不是偽造 localStorage
    await page.evaluate(async (mail) => {
      const sb = window.MZSM_RPC_CLIENT.getSupabaseClient();
      const { error } = await sb.auth.signInWithPassword({ email: mail, password: 'x' });
      if (error) throw error;
    }, email);
    await page.waitForTimeout(1200);
  }
  return { page, ctx, errs };
}

// ── 1. 未登入 ───────────────────────────────────────────────────────────
{
  const { page, ctx, errs } = await adminPage(null);
  check('admin 未登入時無 JS 錯誤', errs.length === 0, errs[0] || '');
  const status = await page.innerText('#adminStatus');
  check('admin 未登入顯示需登入', status.includes('尚未登入'), status);
  const consoleHidden = await page.locator('#consolePanel').evaluate(e => e.classList.contains('hidden'));
  check('admin 未登入時後台區塊隱藏', consoleHidden);
  const loginShown = await page.locator('#loginPanel').evaluate(e => !e.classList.contains('hidden'));
  check('admin 未登入時顯示登入區塊', loginShown);
  await ctx.close();
}

// ── 2. 登入但不在管理者名單 ─────────────────────────────────────────────
{
  const { page, ctx, errs } = await adminPage('user@example.test');
  check('admin 非管理者登入無 JS 錯誤', errs.length === 0, errs[0] || '');
  const status = await page.innerText('#adminStatus');
  check('admin 非管理者被明確拒絕', status.includes('不在宮務管理者名單'), status);
  const consoleHidden = await page.locator('#consolePanel').evaluate(e => e.classList.contains('hidden'));
  check('admin 非管理者看不到後台資料', consoleHidden);
  const bodyText = await page.innerText('body');
  check('admin 非管理者頁面不含任何登記編號',
        !/LMP-\d{4}|MSM-\d{4}|PEA-\d{4}/.test(bodyText));
  await ctx.close();
}

// ── 3. 管理者登入：三個分頁都有資料 ─────────────────────────────────────
{
  const { page, ctx, errs } = await adminPage('admin@example.test');
  check('admin 管理者登入無 JS 錯誤', errs.length === 0, errs[0] || '');
  const status = await page.innerText('#adminStatus');
  check('admin 管理者登入成功', status.includes('admin@example.test'), status);

  const lightText = await page.innerText('#lightRows');
  check('點燈分頁有資料', /LMP-\d{4}-\d{4}/.test(lightText), lightText.slice(0, 80).replace(/\n/g, ' '));
  check('點燈分頁只顯示末四碼，不顯示完整手機',
        lightText.includes('手機末四碼') && !/09\d{8}/.test(lightText));

  await page.click('#consoleTabs button[data-tab=tabPilgrimage]');
  await page.waitForTimeout(200);
  const pilText = await page.innerText('#pilgrimageRows');
  check('進香分頁有資料', /MSM-\d{4}-\d{4}/.test(pilText), pilText.slice(0, 80).replace(/\n/g, ' '));

  await page.click('#consoleTabs button[data-tab=tabTaisui]');
  await page.waitForTimeout(200);
  const taiText = await page.innerText('#taisuiRows');
  check('安太歲分頁有資料', /PEA-\d{4}-\d{4}/.test(taiText), taiText.slice(0, 80).replace(/\n/g, ' '));
  check('安太歲顯示農曆核對狀態', taiText.includes('農曆待核對') || taiText.includes('農曆已核對'));

  // ── 4. 實際更新一筆狀態 ───────────────────────────────────────────────
  // 先自己造一筆全新的「待確認」報名，測試才不會受前次執行留下的狀態影響
  const firstId = await page.evaluate(async () => {
    const c = window.MZSM_RPC_CLIENT.create();
    const r = await c.publicCreatePilgrimage({
      name: '後台更新測試', phone: '0900111222', adult: 1, child: 0, note: '',
      idempotency_key: 'e2e-admin-' + Date.now()
    });
    return r.code;
  });
  await page.click('#refreshAll');
  await page.waitForTimeout(1000);
  await page.click('#consoleTabs button[data-tab=tabPilgrimage]');
  await page.waitForTimeout(300);
  const confirmBtn = page.locator('#pilgrimageRows .record').first().locator('button', { hasText: '標為已確認' });
  await confirmBtn.click();
  await page.waitForTimeout(1200);
  const afterStatus = await page.innerText('#adminStatus');
  check('進香狀態更新成功', afterStatus.includes('標為已確認 完成'), afterStatus);
  const afterText = await page.innerText('#pilgrimageRows');
  const block = afterText.split(firstId)[1] || '';
  check('更新後該筆顯示已確認', block.split('MSM-')[0].includes('已確認'),
        block.slice(0, 140).replace(/\n/g, ' '));

  // ── 5. 版本衝突：用過期版本更新應被擋且自動重載 ───────────────────────
  const conflict = await page.evaluate(async (id) => {
    const c = window.MZSM_RPC_CLIENT.create();
    try {
      await c.adminUpdatePilgrimage({ id, expected_version: 1, status: '已取消' });
      return 'ALLOWED';
    } catch (e) { return e.code; }
  }, firstId);
  check('過期版本更新被擋（樂觀鎖）', conflict === 'CONFLICT', conflict);

  // ── 6. 登出後資料立即消失 ─────────────────────────────────────────────
  await page.click('#signOut');
  await page.waitForTimeout(900);
  const outStatus = await page.innerText('#adminStatus');
  check('登出後狀態正確', outStatus.includes('已登出'), outStatus);
  const hiddenAfter = await page.locator('#consolePanel').evaluate(e => e.classList.contains('hidden'));
  check('登出後後台資料隱藏', hiddenAfter);
  await ctx.close();
}

console.log(`\n${total - failures}/${total} passed`);
await browser.close();
process.exit(failures ? 1 : 0);
