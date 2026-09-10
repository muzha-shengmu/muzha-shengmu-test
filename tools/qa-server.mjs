// 本機 QA 專用。GET-only、不提供資料庫代理、不提供 SQL 或開發工具下載。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = fs.readFileSync(path.join(root, 'config/announcement-config.js'), 'utf8');
if (!/mode:\s*'disabled'/.test(config) || !/supabaseUrl:\s*''/.test(config)
    || !/supabasePublishableKey:\s*''/.test(config)) throw new Error('只允許停用且無正式連線設定的候選');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp',
  '.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8',
  '.webmanifest':'application/manifest+json'};
const server = http.createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  let url,pathname;
  try {url=new URL(req.url,'http://local.invalid');pathname=decodeURIComponent(url.pathname);}
  catch {res.writeHead(400);res.end();return;}
  const qa = pathname === '/__qa';
  if (!qa && (pathname.split('/').some(x=>x.startsWith('.')) ||
      /^\/(tools|supabase|qa-results|node_modules|dist)(\/|$)/.test(pathname))) {
    res.writeHead(404);res.end('找不到頁面');return;
  }
  let file = qa ? path.join(root,'tools/qa-harness.html') : path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if (!file.startsWith(root+path.sep)) {res.writeHead(404);res.end();return;}
  let status=200;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {file=path.join(root,'404.html');status=404;}
  const ext=path.extname(file);let data=fs.readFileSync(file);
  if (ext==='.html' && !qa) {
    let html=data.toString('utf8');
    const styles=[];
    if (url.searchParams.get('__qa_text')==='200') styles.push('html{font-size:200%!important}');
    if (url.searchParams.get('__qa_reduce')==='1') styles.push('*,*::before,*::after{animation:none!important;transition:none!important}');
    if(styles.length) html=html.replace('</head>',`<style>${styles.join('')}</style></head>`);
    data=Buffer.from(html);
  }
  res.writeHead(status,{'Content-Type':mime[ext]||'application/octet-stream',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'X-Robots-Tag':'noindex, nofollow, noarchive',
    'Content-Security-Policy':"default-src 'self'; connect-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'"});
  res.end(req.method==='HEAD'?undefined:data);
});
server.listen(Number(process.env.PORT||4173),'0.0.0.0',()=>console.log('MZSM isolated QA ready'));
