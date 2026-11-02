import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { preflight, buildPdf, testPdf } from '../src/pdf';
import { plan, defaults, mm } from '../src/core';
async function sample(count=2) {
  const d=await PDFDocument.create();
  for(let i=0;i<count;i++) {const p=d.addPage([mm(148),mm(210)]);p.drawText(`TOP page ${i+1}`,{x:20,y:mm(210)-40});p.drawLine({start:{x:20,y:20},end:{x:100,y:100}});}
  return d;
}
describe('static PDF input and output',()=>{
  it('reads all visible dimensions and writes real PDF pages',async()=>{
    const bytes=await (await sample(7)).save(); const info=await preflight(bytes);
    expect(info.pages).toHaveLength(7);
    const output=await buildPdf(bytes,plan(info,defaults),'full');
    const pdf=await PDFDocument.load(output); expect(pdf.getPageCount()).toBe(8);
    expect(pdf.getPage(0).getSize()).toEqual({width:612,height:792});
    const xobjects=pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'));
    expect(String(xobjects)).toContain('EmbeddedPdfPage');
  });
  it('normalizes crop origins and right-angle rotations',async()=>{
    const d=await PDFDocument.create();
    for(const r of [0,90,180,270]) {const p=d.addPage([800,800]);p.setCropBox(20,30,r%180?mm(210):mm(148),r%180?mm(148):mm(210));p.setRotation(degrees(r));}
    const info=await preflight(await d.save());
    for(const p of info.pages) {expect(p.width).toBeCloseTo(mm(148),7);expect(p.height).toBeCloseTo(mm(210),7);expect(p.crop.x).toBe(20);}
  });
  it('rejects mixed page sizes with the offending page number',async()=>{
    const d=await sample();d.addPage([100,100]);
    await expect(preflight(await d.save())).rejects.toThrow(/page 3/i);
  });
  it('rejects non-PDF, broken PDF, zero pages and too many pages',async()=>{
    await expect(preflight(new TextEncoder().encode('hello'))).rejects.toThrow(/PDF/);
    await expect(preflight(new TextEncoder().encode('%PDF-broken'))).rejects.toThrow();
    await expect(preflight(await (await PDFDocument.create()).save({addDefaultPage:false}))).rejects.toThrow(/page/i);
    await expect(preflight(await (await sample(121)).save())).rejects.toThrow(/120/);
  });
  it('rejects bytes over the product limit before parsing',async()=>{
    await expect(preflight(new Uint8Array(20*1024*1024+1))).rejects.toThrow(/20 MiB/);
  });
  it('explains malformed missing catalogs without exposing an internal TypeError',async()=>{
    await expect(preflight(new TextEncoder().encode('%PDF-1.7\nbroken file'))).rejects.toThrow(/damaged/);
  });
  it('rejects forms rather than dropping filled content',async()=>{
    const d=await sample(); d.getForm().createTextField('name').setText('Keep me');
    await expect(preflight(await d.save())).rejects.toThrow(/form/i);
  });
  it('rejects nonstandard UserUnit',async()=>{
    const d=await sample();d.getPage(1).node.set(PDFName.of('UserUnit'),PDFNumber.of(2));
    await expect(preflight(await d.save())).rejects.toThrow(/UserUnit/);
  });
  it.each(['Text','Widget','Stamp','Unknown'])('rejects annotation subtype %s',async type=>{
    const d=await sample();const a=d.context.obj({Type:'Annot',Subtype:type,Rect:[0,0,50,50]});
    d.getPage(0).node.set(PDFName.of('Annots'),d.context.obj([d.context.register(a)]));
    await expect(preflight(await d.save())).rejects.toThrow(/annotation|form/i);
  });
  it('allows ordinary links with a navigation warning',async()=>{
    const d=await sample();const a=d.context.obj({Type:'Annot',Subtype:'Link',Rect:[0,0,50,50]});
    d.getPage(0).node.set(PDFName.of('Annots'),d.context.obj([d.context.register(a)]));
    expect((await preflight(await d.save())).warnings.join(' ')).toMatch(/navigation/i);
  });
  it('creates a two-sided test page without an input document',async()=>{
    const bytes=await testPdf(defaults);const d=await PDFDocument.load(bytes);
    expect(d.getPageCount()).toBe(2);expect(d.getPage(0).getSize()).toEqual({width:612,height:792});
  });
  it('exports both manual sides retaining the blank',async()=>{
    const bytes=await (await sample(7)).save(); const p=plan(await preflight(bytes),{...defaults,mode:'manual',reverseBacks:true});
    expect((await PDFDocument.load(await buildPdf(bytes,p,'fronts'))).getPageCount()).toBe(4);
    expect((await PDFDocument.load(await buildPdf(bytes,p,'backs'))).getPageCount()).toBe(4);
  });
  it('keeps real source blanks without an embedding failure',async()=>{
    const d=await sample(1);d.addPage([mm(148),mm(210)]);
    const bytes=await d.save(),info=await preflight(bytes);
    const out=await buildPdf(bytes,plan(info,defaults));
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
  it('rejects an excessive image resource instead of silently omitting it from preview',async()=>{
    const d=await sample(1);const stream=d.context.flateStream(new Uint8Array([0]),{Type:'XObject',Subtype:'Image',Width:5000,Height:5000,BitsPerComponent:8,ColorSpace:'DeviceGray'});
    d.getPage(0).node.Resources()!.set(PDFName.of('XObject'),d.context.obj({Large:d.context.register(stream)}));
    await expect(preflight(await d.save())).rejects.toThrow(/16 megapixel/);
  });
});
