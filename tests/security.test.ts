import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName} from 'pdf-lib';
import {preflight,buildPdf} from '../src/pdf';
import {plan,defaults} from '../src/core';
const bytes=async(name:string)=>new Uint8Array(await readFile('fixtures/'+name+'.pdf'));
it.each([['E-encrypted','Encrypted'],['E-xfa','XFA'],['E-signature','signature'],['E-rotation','right-angle']])('rejects owned restricted fixture %s',async(name,message)=>{
  await expect(preflight(await bytes(name))).rejects.toThrow(message);
});
it('keeps scan pixels as an image rather than claiming vector conversion',async()=>{
  const b=await bytes('D-scan');const info=await preflight(b);const o=await PDFDocument.load(await buildPdf(b,plan(info,defaults)));
  expect(info.warnings.join(' ')).toMatch(/raster/);
  const objects=o.context.enumerateIndirectObjects();expect(objects.some(([,v])=>String(v).includes('/Subtype /Image'))).toBe(true);
});
it('does not copy catalog actions, embedded files or form fields',async()=>{
  const b=await bytes('E-actions');const info=await preflight(b);const o=await PDFDocument.load(await buildPdf(b,plan(info,defaults)));
  for(const key of ['OpenAction','AA','Names','AcroForm'])expect(o.catalog.has(PDFName.of(key))).toBe(false);
  expect(o.context.enumerateIndirectObjects().some(([,v])=>String(v).includes('/JavaScript'))).toBe(false);
});
