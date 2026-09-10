#!/usr/bin/env python3
"""Export only browser assets. This never deploys or connects to a backend."""
from pathlib import Path
import shutil
import re
import json
import hashlib
from public_content import prepare_public

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist'
config = (ROOT / 'config/announcement-config.js').read_text()
for pattern in [r"mode:\s*'disabled'", r"supabaseUrl:\s*''", r"supabasePublishableKey:\s*''",
                r"authRedirectUrl:\s*''", r"developmentBuild:\s*false"]:
    if not re.search(pattern, config):
        raise SystemExit('拒絕匯出：候選必須停用，且不得含正式連線設定或開發模式。')
# The output is wholly generated, inside this isolated checkout only.
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir()
content_holds = {}
for file in ROOT.glob('*.html'):
    html, holds = prepare_public(file.name, file.read_text())
    (OUT / file.name).write_text(html)
    if holds: content_holds[file.name] = holds
for name in ['site-shell.css', 'robots.txt', 'manifest.webmanifest']:
    shutil.copy2(ROOT / name, OUT / name)
for name in ['assets', 'config']:
    shutil.copytree(ROOT / name, OUT / name)
(OUT / '_headers').write_text('''/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow, noarchive
  Content-Security-Policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'none'
''')
files = [p for p in sorted(OUT.rglob('*')) if p.is_file()]
print(json.dumps({'status':'local-export-only','files':len(files),'html':len(list(OUT.glob('*.html'))),
                  'backend':'disabled','content_holds':content_holds,'excluded':['supabase','tools','.git','audit'],
                  'manifest':[{'path':str(p.relative_to(OUT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]},ensure_ascii=False))
