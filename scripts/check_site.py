from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json
root=Path(__file__).resolve().parents[1]/'dist'
class Page(HTMLParser):
    def __init__(self):
        super().__init__();self.links=[];self.title='';self.description='';self.h1=0;self.canonical=False;self.og_title='';self.ids=set();self.noindex=False;self.body_style=None;self.in_title=False
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='title':self.in_title=True
        if tag=='body':self.body_style=a.get('data-ui')
        if tag=='meta':
            if a.get('name')=='description':self.description=a.get('content','')
            if a.get('name')=='robots':self.noindex='noindex' in a.get('content','')
            if a.get('property')=='og:title':self.og_title=a.get('content','')
        if tag=='h1':self.h1+=1
        if tag=='link' and a.get('rel')=='canonical':self.canonical=True
        if 'id' in a:
            assert a['id'] not in self.ids,('duplicate id',a['id'])
            self.ids.add(a['id'])
        for key in ['src','href']:
            value=a.get(key,'')
            if value.startswith(('/','#')) and not value.startswith('//'):self.links.append(value)
        if tag=='img':assert a.get('alt'),'Images need descriptive alt text'
    def handle_endtag(self,tag):
        if tag=='title':self.in_title=False
    def handle_data(self,data):
        if self.in_title:self.title+=data
parsed={}
for p in root.rglob('*.html'):
    info=Page();info.feed(p.read_text(encoding='utf8'));parsed[p]=info
links=fragments=0;titles=set();descriptions=set();search_pages=[]
for p,info in parsed.items():
    assert info.title and info.description and info.h1==1,p
    assert not info.canonical,'No production URL exists; do not fabricate canonical'
    if not info.noindex:
        assert info.title not in titles and info.description not in descriptions,('duplicate metadata',p)
        assert info.og_title==info.title,('Open Graph title mismatch',p)
        assert info.body_style=='github',('Selected E style missing from HTML',p)
        titles.add(info.title);descriptions.add(info.description)
        search_pages.append({'path':str(p.relative_to(root)),'title':info.title,'description':info.description})
    for url in info.links:
        parts=urlsplit(url);target=root/unquote(parts.path).lstrip('/') if parts.path else p
        if target.is_dir():target=target/'index.html'
        assert target.is_file(),(p,url)
        if parts.fragment:
            assert target in parsed and unquote(parts.fragment) in parsed[target].ids,('missing fragment',p,url)
            fragments+=1
        links+=1
report={'html_pages':len(parsed),'internal_asset_and_page_links':links,'checked_fragments':fragments,'missing_targets':0,'placeholder_canonical':0,'unique_search_pages':len(search_pages),'production_metadata':'pending actual deployment URL'}
out=root.parent/'output'/'verification'
(out/'site-checks.json').write_text(json.dumps(report,indent=2),encoding='utf8')
(out/'seo-pages.json').write_text(json.dumps(search_pages,indent=2),encoding='utf8')
print(json.dumps(report,indent=2))
