// 全站回歸：每一頁 × 每一種尺寸，檢查載入、錯誤、破圖、溢出、觸控目標。
// 用法：node tools/regression.mjs [base-url]
//   預設 http://127.0.0.1:8145，需先在網站根目錄啟動靜態伺服器。
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8145';

// 設定檔啟用後，前端本來就會呼叫自己的 Supabase 專案，那是預期行為。
// 「外部請求」要抓的是「連到設定以外的第三方」——字型 CDN、分析服務之類，
// 那才是隱私與離線可用性的問題。所以先從設定檔讀出允許的主機。
let allowedHost = null;
try {
  const cfg = await (await fetch(`${BASE}/config/announcement-config.js`)).text();
  const m = cfg.match(/supabaseUrl:\s*'([^']+)'/);
  if (m && m[1]) allowedHost = new URL(m[1]).host;
} catch { /* 讀不到就維持零容忍 */ }
const PAGES = [
  'index.html', 'about.html', 'mazu.html', 'history.html', 'announcements.html',
  'announcement-admin.html', 'admin.html', 'pilgrimage.html', 'light.html',
  'light-register.html', 'light-query.html', 'taisui.html', 'contact.html',
  'home-about-top.html', '404.html',
];
const SIZES = [[360, 800], [390, 844], [768, 1024], [1440, 900], [1920, 1080]];

const browser = await chromium.launch();
const totals = {
  loads: 0, badStatus: 0, pageErrors: 0, consoleErrors: 0,
  externalRequests: 0, supabaseRequests: 0,
  brokenImages: 0, overflowPages: 0, smallTargets: 0,
};
const problems = [];

for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  for (const file of PAGES) {
    const p = await ctx.newPage();
    p.on('pageerror', e => {
      totals.pageErrors++;
      problems.push(`${file} ${w}x${h} pageerror: ${String(e).slice(0, 90)}`);
    });
    p.on('console', m => {
      if (m.type() !== 'error') return;
      // 資料庫連不到時瀏覽器一定會記網路錯誤，那是降級測試的範圍，不是版面缺陷
      if (/Failed to load resource|net::ERR|status of \d+/.test(m.text())) return;
      totals.consoleErrors++;
      problems.push(`${file} ${w}x${h} console: ${m.text().slice(0, 90)}`);
    });
    p.on('request', r => {
      const u = r.url();
      if (u.startsWith(BASE) || u.startsWith('data:')) return;
      let host = '';
      try { host = new URL(u).host; } catch { /* 非標準 URL 視為外部 */ }
      if (allowedHost && host === allowedHost) {
        totals.supabaseRequests++;   // 已設定的自家後端，預期之內
        return;
      }
      totals.externalRequests++;
      problems.push(`${file} 第三方請求: ${u.slice(0, 70)}`);
    });

    const res = await p.goto(`${BASE}/${file}`, { waitUntil: 'domcontentloaded' });
    totals.loads++;
    if (res.status() !== 200) {
      totals.badStatus++;
      problems.push(`${file} HTTP ${res.status()}`);
    }
    await p.waitForTimeout(250);

    const m = await p.evaluate(() => ({
      broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      small: [...document.querySelectorAll('a,button,input,select,textarea')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 43.5
          && getComputedStyle(e).display !== 'none';
      }).length,
    }));
    totals.brokenImages += m.broken;
    totals.smallTargets += m.small;
    if (m.overflow) {
      totals.overflowPages++;
      problems.push(`${file} ${w}x${h} 水平溢出`);
    }
    if (m.small) problems.push(`${file} ${w}x${h} ${m.small} 個觸控目標 <44px`);
    if (m.broken) problems.push(`${file} ${w}x${h} ${m.broken} 張破圖`);
    await p.close();
  }
  await ctx.close();
}

console.log(JSON.stringify(totals, null, 1));
console.log(allowedHost
  ? `（supabaseRequests 是打到設定中的 ${allowedHost}，屬預期行為）`
  : '（設定檔未指定 supabaseUrl，任何外部請求都算問題）');
if (problems.length) {
  console.log('\n--- 問題 ---');
  [...new Set(problems)].slice(0, 25).forEach(x => console.log(' ', x));
}
await browser.close();
const failed = totals.badStatus + totals.pageErrors + totals.consoleErrors
  + totals.externalRequests + totals.brokenImages + totals.overflowPages + totals.smallTargets;
process.exit(failed ? 1 : 0);
