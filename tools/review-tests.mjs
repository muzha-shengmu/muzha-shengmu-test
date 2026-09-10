// 無真實連線的本機候選驗證；不取代 PostgreSQL 或正式 Supabase 驗收。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const code=fs.readFileSync(path.join(root,'assets/js/mzsm-rpc-client.js'),'utf8');
const configCode=fs.readFileSync(path.join(root,'config/announcement-config.js'),'utf8');
const results=[];let requests=0;
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
function context(host='127.0.0.1',query='',patch={}){
  const ctx={URL,URLSearchParams,AbortController,Headers,Request,setTimeout,clearTimeout,
    location:{hostname:host,search:query,href:`http://${host||'file.invalid'}/${query}`},
    fetch(){requests++;throw Error('禁止任何外部請求');}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(configCode,ctx);
  ctx.MZSM_RPC_CONFIG={...ctx.MZSM_RPC_CONFIG,...patch};vm.runInContext(code,ctx);
  return ctx.MZSM_RPC_CLIENT;
}
const mock=(role='anon',query='')=>context('127.0.0.1',`?rpcmock=1&role=${role}${query}`,{developmentBuild:true}).create();
const admin=mock('admin');
await test('交付設定停用且三個連線欄位為空',()=>{const c={window:{}};vm.runInNewContext(configCode,c);const v=c.window.MZSM_RPC_CONFIG;assert.equal(v.mode,'disabled');for(const k of ['supabaseUrl','supabasePublishableKey','authRedirectUrl'])assert.equal(v[k],'');assert.equal(v.developmentBuild,false);});
for(const host of ['127.0.0.1','localhost','[::1]','terminal.local','review.example.invalid','localhost.example.invalid','']){
  await test(`出貨候選拒絕網址測試模式：${host||'file'}`,()=>assert.equal(context(host,'?rpcmock=1&role=admin').create().describe().mode,'disabled'));
}
for(const host of ['terminal.local','review.example.invalid','127.0.0.1.example.invalid','']){
  await test(`開發旗標不能在非本機開啟假管理者：${host||'file'}`,()=>assert.equal(context(host,'?rpcmock=1&role=admin',{developmentBuild:true}).create().describe().mode,'disabled'));
}
await test('demo 與 rpcmock 同時要求時停用',()=>assert.equal(context('localhost','?demo=1&rpcmock=1',{developmentBuild:true}).create().describe().reason,'MODE_CONFLICT'));
const api=context();
await test('15 個前後端呼叫名稱有對應 SQL',()=>{const sql=fs.readFileSync(path.join(root,'supabase/RUN_ALL.sql'),'utf8');assert.equal(Object.keys(api.rpcMap).length,15);for(const name of Object.values(api.rpcMap))assert.ok(sql.includes('function public.'+name+'('),name);});
for(const method of Object.keys(api.rpcMap))await test(`停用時拒絕 ${method}`,()=>assert.rejects(api.create()[method]({}),e=>e.code==='DISABLED'));
for(const method of Object.keys(api.rpcMap).filter(k=>k.startsWith('admin')))await test(`未授權本機角色拒絕 ${method}`,()=>assert.rejects(mock()[method]({}),e=>e.code==='FORBIDDEN'));
let ann;
await test('公告草稿不出現在公開列表',async()=>{ann=(await admin.adminSaveAnnouncement({title:'本機查核草稿',content:'合成資料',status:'draft',is_pinned:false})).row;const pub=await admin.publicListAnnouncements({});assert.ok(!pub.rows.some(x=>x.id===ann.id));});
await test('公告發布後可讀取',async()=>{ann=(await admin.adminSaveAnnouncement({id:ann.id,title:ann.title,content:ann.content,status:'published',is_pinned:true,expected_version:1})).row;assert.ok((await admin.publicListAnnouncements({})).rows.some(x=>x.id===ann.id));});
await test('舊公告版本不得覆蓋新內容',()=>assert.rejects(admin.adminSaveAnnouncement({id:ann.id,title:'舊版',content:'合成資料',status:'published',is_pinned:false,expected_version:1}),e=>e.code==='CONFLICT'));
for(const [create,lookup,prefix,extra] of [
 ['publicCreatePilgrimage','publicLookupPilgrimage','MSM',{adult:1,child:0}],
 ['publicCreateLight','publicLookupLight','LMP',{type:'平安燈',target:'合成對象',birth:'2000-01-01'}],
 ['publicCreateTaisui','publicLookupTaisui','PEA',{target:'合成對象',birth:'2000-01-01'}]]){
 const client=mock();let created;const payload={name:'本機合成測試',phone:'0000001234',note:'合成資料',idempotency_key:`test-${prefix}-0001`,...extra};
 await test(`${prefix} 本機合成登記及同鍵重送不新增`,async()=>{created=await client[create](payload);assert.ok(created.code.startsWith(prefix+'-'));assert.equal((await client[create](payload)).code,created.code);});
 await test(`${prefix} 查詢保留編號且不回傳個人欄位`,async()=>{const {record}=await client[lookup]({code:created.code,last4:'1234'});assert.equal(record.code,created.code);for(const k of ['name','phone','target','birth','note'])assert.ok(!(k in record),k);});
 await test(`${prefix} 錯誤末四碼查無資料`,async()=>assert.equal((await client[lookup]({code:created.code,last4:'9999'})).record,null));
}
await test('未知欄位驗證失敗也不得記錄秘密值',async()=>{const c=mock();await assert.rejects(c.publicListAnnouncements({password:'synthetic-sensitive-sentinel'}));assert.ok(!JSON.stringify(c.getLog()).includes('synthetic-sensitive-sentinel'));});
await test('診斷紀錄有數量上限',async()=>{const c=mock();for(let i=0;i<105;i++)await c.publicListAnnouncements({});assert.equal(c.getLog().length,100);});
await test('逾時錯誤可辨識',()=>assert.rejects(mock('anon','&scenario=timeout').publicListAnnouncements({}),e=>e.code==='TIMEOUT'));
await test('公開 SQL 查詢不回傳生日與祈福對象',()=>{const sql=fs.readFileSync(path.join(root,'supabase/RUN_ALL.sql'),'utf8');for(const name of ['mzsm_public_lookup_light','mzsm_public_lookup_taisui']){const start=sql.indexOf('function public.'+name+'(');const chunk=sql.slice(start,sql.indexOf('\n$$;',start));assert.ok(!/'(?:name|phone|target|birth)'\s*,/.test(chunk),name);}});
await test('逾時提示不斷言資料未送出',()=>{const s=fs.readFileSync(path.join(root,'assets/js/mzsm-rpc-pages.js'),'utf8');assert.ok(!s.includes('資料未送出'));assert.ok(s.includes('送出結果未確認'));});
await test('五個服務頁在程式未載入時表單仍停用',()=>{for(const name of ['pilgrimage.html','light.html','light-register.html','light-query.html','taisui.html']){const s=fs.readFileSync(path.join(root,name),'utf8');const forms=[...s.matchAll(/<form\b[\s\S]*?<\/form>/g)];assert.ok(forms.length>0);for(const [form] of forms)for(const [tag] of form.matchAll(/<(?:input|textarea|select|button)\b[^>]*>/g))assert.match(tag,/\sdisabled(?:[\s=>/])/);assert.ok(!s.includes('線上登記已開放')&&!s.includes('線上報名已開放'));}});
await test('表單外的四個生日輸入預設停用',()=>{const s=fs.readFileSync(path.join(root,'taisui.html'),'utf8');for(const id of ['tYear','tMonth','tDay','tPicker']){const tag=[...s.matchAll(/<input\b[^>]*>/g)].map(x=>x[0]).find(x=>x.includes(`id="${id}"`));assert.ok(tag);assert.match(tag,/\sdisabled(?:[\s=>/])/);}});
await test('所有測試的真實網路請求為零',()=>assert.equal(requests,0));
const summary={kind:'node-vm-and-static-contracts',passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,externalRequests:requests,sqlExecuted:false,results};
console.log(JSON.stringify(summary,null,2));process.exitCode=summary.failed?1:0;
