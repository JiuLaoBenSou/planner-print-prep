"""Generate owned scan and restricted-feature samples using an independent tool."""
from pathlib import Path
import json, hashlib
import pymupdf as fitz
root=Path(__file__).resolve().parents[1]
source=fitz.open(root/'fixtures'/'C-one-page.pdf')
scan=fitz.open();p=scan.new_page(width=source[0].rect.width,height=source[0].rect.height)
p.insert_image(p.rect,stream=source[0].get_pixmap(matrix=fitz.Matrix(1,1)).tobytes('png'))
scan.save(root/'fixtures'/'D-scan.pdf')
source.save(root/'fixtures'/'E-encrypted.pdf',encryption=fitz.PDF_ENCRYPT_AES_256,owner_pw='owned-test-owner',user_pw='owned-test-user')
for name in ['E-xfa','E-signature','E-rotation','E-actions']:
    d=fitz.open(root/'fixtures'/'C-one-page.pdf');page=d[0]
    if name=='E-xfa':
        ref=d.get_new_xref();d.update_object(ref,'<< /XFA [] /Fields [] >>');d.xref_set_key(d.pdf_catalog(),'AcroForm',f'{ref} 0 R')
    elif name=='E-signature':
        ref=d.get_new_xref();d.update_object(ref,'<< /FT /Sig /T (test-signature) >>');form=d.get_new_xref();d.update_object(form,f'<< /Fields [{ref} 0 R] >>');d.xref_set_key(d.pdf_catalog(),'AcroForm',f'{form} 0 R')
    elif name=='E-rotation':d.xref_set_key(page.xref,'Rotate','45')
    else:
        ref=d.get_new_xref();d.update_object(ref,'<< /S /JavaScript /JS (app.alert\\(owned-test\\)) >>');d.xref_set_key(d.pdf_catalog(),'OpenAction',f'{ref} 0 R');d.embfile_add('owned.txt',b'owned attachment')
    d.save(root/'fixtures'/f'{name}.pdf')
manifest=[]
for p in sorted((root/'fixtures').glob('*.pdf')):manifest.append({'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(root/'fixtures'/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print('fixture_manifest_count='+str(len(manifest)))
