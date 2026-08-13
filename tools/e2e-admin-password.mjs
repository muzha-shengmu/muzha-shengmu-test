import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8140';
let bad=0,n=0;
const ck=(name,ok,d='')=>{n++;if(!ok)bad++;console.log(`${ok?'PASS ':'FAIL '} ${name}${d?'  → '+d:''}`)};
const br=await chromium.launch({ignoreHTTPSErrors:true});

async function open(){
  const ctx=await br.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  const p=await ctx.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(String(e)));
  p.on('console',m=>{if(m.type()==='error'&&!/status of (400|401|403)/.test(m.text()))errs.push('console: '+m.text())});
  await p.goto(`${B}/admin.html`,{waitUntil:'networkidle'}); await p.waitForTimeout(500);
  return {p,ctx,errs};
}

// 1. 欄位存在
{
  const {p,ctx,errs}=await open();
  ck('載入無 JS 錯誤',errs.length===0,errs[0]||'');
  ck('密碼欄存在',await p.locator('#adminPasswordInput').count()===1);
  ck('登入鍵存在',await p.locator('#signInPassword').count()===1);
  ck('寄信連結鍵仍在',await p.locator('#sendMagicLink').count()===1);
  await ctx.close();
}
// 2. 空白送出
{
  const {p,ctx}=await open();
  await p.click('#signInPassword'); await p.waitForTimeout(400);
  ck('空白欄位有提示',(await p.innerText('#adminStatus')).includes('請輸入'),await p.innerText('#adminStatus'));
  await ctx.close();
}
// 3. 密碼錯誤
{
  const {p,ctx}=await open();
  await p.fill('#adminEmailInput','admin@example.test');
  await p.fill('#adminPasswordInput','wrong-password');
  await p.click('#signInPassword'); await p.waitForTimeout(1200);
  const s=await p.innerText('#adminStatus');
  ck('密碼錯誤訊息清楚',s.includes('信箱或密碼不正確'),s);
  const hidden=await p.locator('#consolePanel').evaluate(e=>e.classList.contains('hidden'));
  ck('密碼錯誤時看不到資料',hidden);
  await ctx.close();
}
// 4. 密碼正確（管理者）
{
  const {p,ctx,errs}=await open();
  await p.fill('#adminEmailInput','admin@example.test');
  await p.fill('#adminPasswordInput','correct-horse');
  await p.click('#signInPassword'); await p.waitForTimeout(1600);
  const s=await p.innerText('#adminStatus');
  ck('密碼登入成功',s.includes('admin@example.test'),s);
  const shown=await p.locator('#consolePanel').evaluate(e=>!e.classList.contains('hidden'));
  ck('登入後看得到後台',shown);
  ck('密碼欄已清空',(await p.inputValue('#adminPasswordInput'))==='');
  ck('登入流程無 JS 錯誤',errs.length===0,errs[0]||'');
  await ctx.close();
}
// 5. 密碼正確但非管理者
{
  const {p,ctx}=await open();
  await p.fill('#adminEmailInput','user@example.test');
  await p.fill('#adminPasswordInput','correct-horse');
  await p.click('#signInPassword'); await p.waitForTimeout(1600);
  const s=await p.innerText('#adminStatus');
  ck('非管理者仍被拒',s.includes('不在宮務管理者名單'),s);
  const body=await p.innerText('body');
  ck('非管理者看不到任何編號',!/LMP-\d{4}|MSM-\d{4}|PEA-\d{4}/.test(body));
  await ctx.close();
}
// 6. Enter 鍵送出
{
  const {p,ctx}=await open();
  await p.fill('#adminEmailInput','admin@example.test');
  await p.fill('#adminPasswordInput','correct-horse');
  await p.press('#adminPasswordInput','Enter'); await p.waitForTimeout(1600);
  ck('密碼欄按 Enter 可登入',(await p.innerText('#adminStatus')).includes('admin@example.test'));
  await ctx.close();
}
console.log(`\n${n-bad}/${n} passed`);
await br.close(); process.exit(bad?1:0);
