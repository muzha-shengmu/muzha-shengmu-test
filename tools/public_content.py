"""Omit unapproved blocks from public HTML, without reserializing the retained markup."""
from html.parser import HTMLParser
import re

VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
SERVICE={'pilgrimage.html','light.html','light-register.html','light-query.html','taisui.html'}

class Document(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.source=source; self.nodes=[]; self.stack=[]
        self.lines=[0]
        self.lines.extend(m.end() for m in re.finditer('\n',source))
        self.feed(source)
    def source_position(self):
        line,col=self.getpos(); return self.lines[line-1]+col
    def handle_starttag(self,tag,attrs):
        start=self.source_position(); n={'tag':tag,'attrs':dict(attrs),'start':start,'open_end':start+len(self.get_starttag_text()),'end':None,'parent':self.stack[-1] if self.stack else None}
        self.nodes.append(n)
        if tag in VOID:n['end']=n['open_end']
        else:self.stack.append(n)
    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
        if tag not in VOID:
            n=self.stack.pop();n['end']=n['open_end']
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i]['tag']==tag:
                self.stack[i]['end']=self.source.find('>',self.source_position())+1
                del self.stack[i:];return
    def inside(self,n,tag=None,cls=None,ident=None):
        p=n['parent']
        while p:
            a=p['attrs']
            if (not tag or p['tag']==tag) and (not cls or cls in a.get('class','').split()) and (not ident or a.get('id')==ident):return True
            p=p['parent']
        return False
    def text(self,n):
        return re.sub('<[^>]+>','',self.source[n['open_end']:n['end'] or n['open_end']]).strip()


def prepare_public(name, html):
    doc=Document(html); cuts=[]; held=[]
    def cut(n,reason):
        if n['end'] is None:raise ValueError('Unclosed selected element')
        cuts.append((n['start'],n['end']));held.append({'tag':n['tag'],'id':n['attrs'].get('id'),'reason':reason})
    for n in doc.nodes:
        tag=n['tag'];a=n['attrs'];classes=a.get('class','').split();parent=n['parent'];txt=doc.text(n) if tag in {'p','h2','h3','div'} else ''
        direct_main=parent and parent['tag']=='main'
        if name in {'contact.html','history.html'} and direct_main and tag!='footer':cut(n,'宮方聯絡或宮史來源未提供')
        elif name in SERVICE and direct_main and tag!='footer':cut(n,'服務規格及個資告知未核准，未開放收件')
        elif name=='announcements.html' and direct_main and tag!='footer':cut(n,'公告來源及正式後端未驗證')
        elif name=='index.html' and a.get('id') in {'notice','visit'}:cut(n,'公告或聯絡資料未核准')
        elif name in {'about.html','mazu.html'} and direct_main and 'note' in classes:cut(n,'不公開施工補件訊息')
        elif name=='about.html' and direct_main and tag=='section' and '主祀神明' in doc.text(n):cut(n,'宮史與分靈敘述未獲 Owner 提供來源')
        elif name=='mazu.html' and direct_main and tag=='section' and ('本宮奉祀特色' in doc.text(n) or 'THE SPIRIT OF MAZU' in doc.text(n)):cut(n,'本宮歷史與日期未獲 Owner 提供來源')
        elif name=='index.html' and tag=='p' and doc.inside(n,ident='culture') and '鎮福宮' in txt:cut(n,'本宮歷史與日期未獲 Owner 提供來源')
        elif name in SERVICE and tag=='p' and doc.inside(n,cls='hero-copy'):cut(n,'不顯示尚未開放的收件承諾')
        elif name in SERVICE and tag=='a' and a.get('href')=='#action':cut(n,'服務尚未開放，隱藏失效操作入口')
        elif name in SERVICE and tag=='script' and a.get('src')=='assets/js/mzsm-rpc-pages.js':cut(n,'不初始化已移除的收件表單')
    # Prefer full outer blocks; do not leave their content in hidden HTML.
    merged=[]
    for start,end in sorted(cuts):
        if merged and start<=merged[-1][1]:merged[-1]=(merged[-1][0],max(end,merged[-1][1]))
        else:merged.append((start,end))
    for start,end in reversed(merged):html=html[:start]+html[end:]
    if name in SERVICE or name=='announcements.html':
        msg='公告服務尚未開放。' if name=='announcements.html' else '線上服務尚未開放。'
        html=re.sub(r'(<main\b[^>]*>)',lambda m:m[0]+'<section class="section"><p class="intro">'+msg+'</p></section>',html,count=1)
    # Input examples are not approved contact details. Labels remain intact.
    html=re.sub(r'\splaceholder=(?:"[^"]*"|\x27[^\x27]*\x27)','',html)
    # Existing metadata containing unverified historical descriptions is withheld.
    if name in {'contact.html','history.html','about.html','mazu.html'}:
        html=re.sub(r'<meta\b(?=[^>]*name="description")[^>]*>','',html)
    return html,held
