"""Verify downloaded bytes and physical PDF geometry independently of the layout planner."""
from pathlib import Path
import json,hashlib
import pymupdf as fitz
root=Path(__file__).resolve().parents[1]
out=root/'output'/'fix-review'
race=fitz.open(out/'latest-local-export.pdf')
assert len(race)==2, 'Delayed sample replaced one-page local input'
assert not race[1].get_text(), 'Expected padded back'
assert 'WEEKLY NOTES / 01' in race[0].get_text()
results=json.loads((out/'safe-area-results.json').read_text(encoding='utf8'))
physical=[]
for row in results:
    assert row['actualExportBlocked']==row['expectedBlocked']
    if row['expectedBlocked']:
        assert row['outputFile'] is None and 'safe area' in row['exportError']
        continue
    d=fitz.open(root/row['outputFile'])
    assert len(d)==2
    rect=d[1].get_drawings()[0]['rect'];page=d[1].rect
    actual={'left':rect.x0*25.4/72,'top':rect.y0*25.4/72,'right':(page.width-rect.x1)*25.4/72,'bottom':(page.height-rect.y1)*25.4/72}
    for edge,value in actual.items():assert value+.001>=row['settings']['margin'+edge.title()],(row['name'],edge,value)
    physical.append({'case':row['name'],'actualMarginsMm':actual})
browser=fitz.open(out/'safe-browser-export.pdf')
rect=browser[1].get_drawings()[0]['rect']
assert rect.x0*25.4/72>=19.999 and rect.y0*25.4/72>=19.999
safe=next(r for r in physical if r['case']=='short-safe-combination')['actualMarginsMm']
assert abs(safe['left']-24.95)<.001 and abs(safe['right']-.95)<.001
assert abs(safe['top']-20.7)<.001 and abs(safe['bottom']-18.7)<.001
paths=list(out.glob('*.pdf'))
proof={'reader':'PyMuPDF '+fitz.VersionBind,'latestLocalDownloadPages':len(race),'blockedCounterexamples':sum(r['actualExportBlocked'] for r in results),'physicalChecks':physical,'browserSafeDownloadPages':len(browser),'files':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]}
(out/'independent-fix-checks.json').write_text(json.dumps(proof,indent=2),encoding='utf8')
print(json.dumps(proof,indent=2))
