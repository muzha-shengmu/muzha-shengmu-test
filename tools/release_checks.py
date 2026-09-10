"""Static release guards; never claims actual DB or browser execution."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import hashlib,json,re,subprocess
from public_content import Document
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'dist'
results=[]
def check(name,ok,detail=None):results.append({'check':name,'status':'PASS' if ok else 'FAIL','detail':detail})
pages=sorted(OUT.glob('*.html'))
check('15 existing HTML routes preserved',len(pages)==15)
refs=0;broken=[];ids_bad=[];placeholder_hits=[];form_hits=[]
class Visible(HTMLParser):
 def __init__(self):super().__init__();self.hidden=0;self.text=[]
 def handle_starttag(self,t,a):
  if t in ['script','style']:self.hidden+=1
 def handle_endtag(self,t):
  if t in ['script','style']:self.hidden-=1
 def handle_data(self,s):
  if not self.hidden:self.text.append(s)
for p in pages:
 html=p.read_text();d=Document(html);ids=[n['attrs']['id'] for n in d.nodes if n['attrs'].get('id')]
 if len(ids)!=len(set(ids)):ids_bad.append(p.name)
 v=Visible();v.feed(html);text=' '.join(v.text)
 if re.search(r'待確認|待宮方|待填入|placeholder|lorem ipsum|example\.com|[\w.+-]+@example\.(?:com|invalid)|0912345678|王小明|王大明|鎮福宮|六百|2025',text,re.I):placeholder_hits.append(p.name)
 for n in d.nodes:
  for k in ['href','src']:
   value=n['attrs'].get(k)
   if not value:continue
   u=urlsplit(value)
   if u.scheme or u.netloc:continue
   refs+=1;target=(p.parent/unquote(u.path)) if u.path else p
   if not target.is_file():broken.append(p.name+':'+value)
   elif u.fragment and target.suffix=='.html':
    td=Document(target.read_text())
    if not any(x['attrs'].get('id')==unquote(u.fragment) for x in td.nodes):broken.append(p.name+':'+value)
 if p.name in ['pilgrimage.html','light.html','light-register.html','light-query.html','taisui.html']:
  if any(n['tag']=='form' for n in d.nodes):form_hits.append(p.name)
check('public page placeholder and unapproved factual content scan',not placeholder_hits,placeholder_hits)
check('unapproved collection forms omitted from public HTML',not form_hits,form_hits)
check('local resources and anchors',not broken,{'checked':refs,'broken':broken})
check('unique HTML ids',not ids_bad,ids_bad)
forbidden=[p.name for p in OUT.rglob('*') if p.is_file() and (p.suffix=='.sql' or p.name.startswith('.env') or '.git' in p.parts or 'tools' in p.parts)]
check('public-only export excludes SQL and development files',not forbidden,forbidden)
secret_patterns=[r'sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}',r'gh[pousr]_[A-Za-z0-9]{20,}',r'github_pat_[A-Za-z0-9_]{20,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}']
secret_files=[]
for p in ROOT.rglob('*'):
 if p.is_file() and not any(x in p.parts for x in ['.git','qa-results','__pycache__']):
  try:s=p.read_text()
  except UnicodeError:continue
  if any(re.search(pattern,s) for pattern in secret_patterns):secret_files.append(str(p.relative_to(ROOT)))
check('secret value scan of candidate text files',not secret_files,secret_files)
env=(ROOT/'.env.example').read_text().splitlines()
check('env template names only, values empty',env==['SUPABASE_URL=','SUPABASE_PUBLISHABLE_KEY=','SUPABASE_SECRET_KEY='])
sql=(ROOT/'supabase/migrations/20260910000001_mzsm_deny_direct.sql').read_text().lower()
tables=['mzsm_counters','mzsm_admins','mzsm_announcements','mzsm_pilgrimage','mzsm_lights','mzsm_taisui','mzsm_idempotency','mzsm_lookup_attempts']
for table in tables:
 check('SQL source RLS enable and explicit restrictive policy: '+table,f'alter table public.{table} enable row level security;' in sql and f'create policy mzsm_deny_direct on public.{table}\n  as restrictive for all to public using (false) with check (false);' in sql)
negative=(ROOT/'supabase/tests/rls_negative_test.sql').read_text()
check('negative DB test source covers 8 tables and 2 roles',all("'"+t+"'" in negative for t in tables) and "array['anon','authenticated']" in negative and 'when insufficient_privilege' in negative and 'rollback;' in negative)
syntax=[]
for p in ROOT.rglob('*'):
 if p.suffix in ['.js','.mjs'] and 'dist' not in p.parts:
  q=subprocess.run(['node','--check',str(p)],capture_output=True,text=True);syntax.append({'file':str(p.relative_to(ROOT)),'status':'PASS' if q.returncode==0 else 'FAIL'})
check('JavaScript syntax',all(x['status']=='PASS' for x in syntax),syntax)
report={'kind':'static-release-guards','status':'PASS' if all(x['status']=='PASS' for x in results) else 'FAIL','results':results,'RLS negative DB test':'NOT RUN','Supabase RLS enabled':'NOT RUN','Browser E2E':'NOT RUN','Lighthouse':'NOT RUN','Production':'NOT RUN'}
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(report['status']!='PASS')
