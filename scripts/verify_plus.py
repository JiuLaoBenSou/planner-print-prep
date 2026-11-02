from pathlib import Path
from zipfile import ZipFile
import hashlib,json
import fitz
root=Path(__file__).resolve().parents[1]
checks=[]
def check(name,result):
    assert result,name
    checks.append(name)
for name in ['unit-batch.zip','browser-batch.zip']:
    path=root/'output'/'plus'/name
    with ZipFile(path) as z:
        check(name+' CRC32',z.testzip() is None)
        check(name+' safe paths',all(not p.startswith('/') and '..' not in p.split('/') for p in z.namelist()))
        report=json.loads(z.read('batch-report.json'))
        records=report if isinstance(report,list) else report['records']
        check(name+' per-file isolation',[r['status'] for r in records]==['ready','error','ready'])
        pdfs=[n for n in z.namelist() if n.endswith('.pdf')]
        check(name+' only successful PDF folders',all(n.startswith(('01-','03-')) for n in pdfs))
        for pdf in pdfs:
            d=fitz.open(stream=z.read(pdf),filetype='pdf')
            first=pdf.startswith('01-') or name=='unit-batch.zip'
            expected=(8 if first else 2) if pdf.endswith('/full.pdf') else (4 if first else 1)
            check(pdf+' page count',len(d)==expected)
            if first:
                ids=list(range(1,8)) if pdf.endswith('/full.pdf') else [1,3,5,7] if pdf.endswith('/fronts.pdf') else [2,4,6]
                for i,source in enumerate(ids):check(pdf+f' source {source}',f'/ {source:02}' in d[i].get_text())
                if not pdf.endswith('/fronts.pdf'):check(pdf+' added blank',not d[-1].get_text())
            d.close()
        if name=='browser-batch.zip':
            check('manual batch six actual PDFs',len(pdfs)==6)
            check('manual settings snapshot',report['settings']['paper']=='A4' and report['settings']['mode']=='manual')
            check('not physically test printed',report['testPrinted'] is False)
            check('no failed PDF included',not any('broken' in p for p in pdfs))
with ZipFile(root/'output'/'plus'/'errors-only.zip') as z:
    check('all-error archive CRC32',z.testzip() is None)
    check('all-error archive contains no PDFs',not any(n.endswith('.pdf') for n in z.namelist()))
    check('all-error archive lists the error',[r['status'] for r in json.loads(z.read('batch-report.json'))['records']]==['error'])
    check('all-error archive includes print instructions','PRINT-FIRST.txt' in z.namelist())
result={'reader':'PyMuPDF '+fitz.VersionBind,'checks':checks,'passed':len(checks),'artifacts':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in (root/'output'/'plus').glob('*.zip')]}
(root/'output'/'plus'/'independent-checks.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps({'passed':len(checks),'reader':result['reader']},indent=2))
