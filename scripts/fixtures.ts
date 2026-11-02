import {PDFDocument, PDFName, PDFNumber, degrees, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mm, defaults, plan, type PrintSettings} from '../src/core';
import {preflight,buildPdf,testPdf} from '../src/pdf';
await mkdir('fixtures',{recursive:true});await mkdir('public/samples',{recursive:true});await mkdir('output/verification',{recursive:true});
const fontBytes=await readFile('node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff');
async function vector(count:number,rotated=false,blank=false) {
  const d=await PDFDocument.create();d.registerFontkit(fontkit);const f=await d.embedFont(fontBytes,{subset:true});
  for(let i=0;i<count;i++) {
    const r=rotated?[0,90,180,270][i%4]:0;
    const w=mm(r%180?210:148),h=mm(r%180?148:210),cx=rotated?20:0,cy=rotated?30:0;
    const p=d.addPage(rotated?[800,800]:[w,h]);p.setCropBox(cx,cy,w,h);p.setRotation(degrees(r));
    if(blank&&i===1)continue;
    p.pushOperators(pushGraphicsState(),concatTransformationMatrix(1,0,0,1,cx,cy));
    const inverse:Record<number,[number,number,number,number,number,number]>={0:[1,0,0,1,0,0],90:[0,1,-1,0,w,0],180:[-1,0,0,-1,w,h],270:[0,-1,1,0,0,h]};
    p.pushOperators(concatTransformationMatrix(...inverse[r]));
    const W=mm(148),H=mm(210);
    p.drawRectangle({x:mm(1),y:mm(1),width:W-mm(2),height:H-mm(2),borderWidth:.4,borderColor:rgb(.1,.1,.1)});
    p.drawText('TOP ^ / A - LEFT',{font:f,x:mm(8),y:H-mm(10),size:11});
    p.drawText(rotated?'ROTATION CHECK':`WEEKLY NOTES / ${String(i+1).padStart(2,'0')}`,{font:f,x:mm(10),y:H-mm(30),size:18});
    p.drawText('A little space to make a plan.',{font:f,x:mm(10),y:H-mm(40),size:10});
    for(let row=0;row<12;row++)p.drawLine({start:{x:mm(10),y:H-mm(55+row*10)},end:{x:W-mm(10),y:H-mm(55+row*10)},thickness:.35,color:rgb(.6,.6,.6)});
    p.drawText('C / bottom left',{font:f,x:mm(8),y:mm(8),size:9});p.drawText('D / RIGHT',{font:f,x:W-mm(35),y:mm(8),size:9});
    p.pushOperators(popGraphicsState());
  }
  return d;
}
const files:Record<string,Uint8Array>={};
files['A-seven-page.pdf']=await (await vector(7)).save();
files['A-ten-page.pdf']=await (await vector(10)).save();
files['A-120-page.pdf']=await (await vector(120)).save();
files['B-rotations-crop.pdf']=await (await vector(4,true)).save();
files['B-baseline.pdf']=await (await vector(1,true)).save();
files['C-original-blank.pdf']=await (await vector(3,false,true)).save();
files['C-one-page.pdf']=await (await vector(1)).save();
const mixed=await vector(1);mixed.addPage([100,100]);files['D-mixed.pdf']=await mixed.save();
const form=await vector(1);form.getForm().createTextField('filled').setText('Do not lose this');files['E-form.pdf']=await form.save();
const annotation=await vector(1);annotation.getPage(0).node.set(PDFName.of('Annots'),annotation.context.obj([annotation.context.register(annotation.context.obj({Type:'Annot',Subtype:'Text',Rect:[0,0,40,40],Contents:'Visible comment'}))]));files['E-annotation.pdf']=await annotation.save();
const link=await vector(1);link.getPage(0).node.set(PDFName.of('Annots'),link.context.obj([link.context.register(link.context.obj({Type:'Annot',Subtype:'Link',Rect:[0,0,40,40]}))]));files['E-link.pdf']=await link.save();
const unit=await vector(1);unit.getPage(0).node.set(PDFName.of('UserUnit'),PDFNumber.of(2));files['E-userunit.pdf']=await unit.save();
files['E-broken.pdf']=new TextEncoder().encode('%PDF-1.7\nbroken file');
files['F-test-letter.pdf']=await testPdf(defaults);
files['F-test-a4-short.pdf']=await testPdf({...defaults,paper:'A4',flip:'short'});
const safeArea=await PDFDocument.create();const safePage=safeArea.addPage([mm(190),mm(240)]);
safePage.drawRectangle({x:0,y:0,width:mm(190),height:mm(240),color:rgb(.8,.2,.4)});
safePage.drawText('VISIBLE EDGES',{x:12,y:20,size:18});files['G-review-safe-area.pdf']=await safeArea.save();
for(const [name,bytes] of Object.entries(files))await writeFile(`fixtures/${name}`,bytes);
await writeFile('public/samples/planner-sample.pdf',files['A-seven-page.pdf']);
for(const [name,input,s] of [
  ['A-letter',files['A-seven-page.pdf'],defaults],
  ['B-rotations',files['B-rotations-crop.pdf'],{...defaults,paper:'A4'}],
  ['B-baseline',files['B-baseline.pdf'],{...defaults,paper:'A4'}],
  ['A-short-offset',files['A-seven-page.pdf'],{...defaults,flip:'short',offsetX:2,offsetY:1}],
  ['C-blank',files['C-original-blank.pdf'],defaults],
  ['A-fit-half-letter',files['A-seven-page.pdf'],{...defaults,trim:'Half Letter',scale:'fit'}],
] as [string,Uint8Array,PrintSettings][]) {
  const layout=plan(await preflight(input),s);
  await writeFile(`output/verification/${name}.pdf`,await buildPdf(input,layout));
  await writeFile(`output/verification/${name}-plan.json`,JSON.stringify(layout,null,2));
}
const input=files['A-seven-page.pdf'];const manual=plan(await preflight(input),{...defaults,mode:'manual',reverseBacks:true});
for(const kind of ['fronts','backs'] as const)await writeFile(`output/verification/A-${kind}.pdf`,await buildPdf(input,manual,kind));
const manifest=Object.entries(files).map(([name,b])=>({path:`fixtures/${name}`,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}));
await writeFile('fixtures/manifest.json',JSON.stringify(manifest,null,2));
console.log(`Created ${manifest.length} self-authored fixtures and 8 verification PDFs.`);
