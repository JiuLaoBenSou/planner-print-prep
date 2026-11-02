"""Independent PDF reader/render checks. Run after npm run fixtures."""
import json, pathlib, hashlib
import pymupdf as fitz
ROOT=pathlib.Path(__file__).resolve().parents[1]
out=ROOT/'output'/'verification'
checks=[]
def check(name, value):
    if not value: raise AssertionError(name)
    checks.append(name)
d=fitz.open(out/'A-letter.pdf')
check('seven input pages -> eight Letter output pages',len(d)==8 and all(abs(p.rect.width-612)<.001 and abs(p.rect.height-792)<.001 for p in d))
check('source text is still selectable', all('WEEKLY NOTES' in d[i].get_text() for i in range(7)))
check('vector paths retained',len(d[0].get_drawings())>=13)
check('embedded font retained',any('DM' in str(f) or 'Dm' in str(f) for f in d[0].get_fonts(full=True)))
check('automatic trailing blank is empty',not d[7].get_text() and not d[7].get_drawings())
positions=d[0].search_for('TOP')[0]
check('A5 actual-size Letter text placement',abs(positions.x0-(33.95+8)*72/25.4)<.1)
rot=fitz.open(out/'B-rotations.pdf');base=fitz.open(out/'B-baseline.pdf')
check('A4 output page dimensions',abs(base[0].rect.width-210*72/25.4)<.001 and abs(base[0].rect.height-297*72/25.4)<.001)
check('A5 actual-size A4 text placement',abs(base[0].search_for('TOP')[0].x0-(31+8)*72/25.4)<.1)
half=fitz.open(out/'A-fit-half-letter.pdf')
full_word=d[0].search_for('WEEKLY NOTES')[0];half_word=half[0].search_for('WEEKLY NOTES')[0]
check('Half Letter uniform scale in actual PDF text',abs(half_word.width/full_word.width-139.7/148)<.00001)
clip=fitz.Rect(31*72/25.4,43.5*72/25.4,(31+148)*72/25.4,(43.5+210)*72/25.4)
reference=base[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=clip,alpha=False)
for i in range(4):
    pix=rot[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=clip,alpha=False)
    # Same visible design; floating raster boundaries may differ by one gray value.
    delta=sum(abs(a-b) for a,b in zip(reference.samples,pix.samples))/len(reference.samples)
    check(f'CropBox + rotation {i*90}: mean pixel delta {delta:.5f} < 0.2',delta<.2)
rot[1].get_pixmap(matrix=fitz.Matrix(1,1)).save(out/'rotation-90.png')
d[0].get_pixmap(matrix=fitz.Matrix(1,1)).save(out/'letter-first-page.png')
short=fitz.open(out/'A-short-offset.pdf')
f=d[1].search_for('TOP')[0];b=short[1].search_for('TOP')[0]
check('short-edge compensation rotates X vector once',abs(b.x0-(612-f.x1+2*72/25.4))<.1)
check('short-edge compensation rotates Y vector once',abs(b.y0-(792-f.y1+1*72/25.4))<.1)
blank=fitz.open(out/'C-blank.pdf');check('original blank retained',len(blank)==4 and not blank[1].get_text())
for name,expected in [('A-fronts.pdf',[1,3,5,7]),('A-backs.pdf',[None,6,4,2])]:
    pdf=fitz.open(out/name)
    for i,n in enumerate(expected):check(f'{name} output {i+1} source {n}',not pdf[i].get_text() if n is None else f'/ {n:02}' in pdf[i].get_text())
for name in ['F-test-letter.pdf','F-test-a4-short.pdf']:
    pdf=fitz.open(ROOT/'fixtures'/name)
    for i,p in enumerate(pdf):
        lines=p.get_drawings()
        lengths=[((item[1].x-item[2].x)**2+(item[1].y-item[2].y)**2)**.5 for path in lines for item in path['items'] if item[0]=='l']
        check(f'{name} side {i+1}: two 100mm rulers',sum(abs(v-100*72/25.4)<.01 for v in lengths)==2)
report={'reader':'PyMuPDF '+fitz.VersionBind,'checks':checks,'count':len(checks),'artifacts':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in out.glob('*.pdf')]}
(out/'independent-checks.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps({'independent_pdf_checks':len(checks),'reader':report['reader']},indent=2))
