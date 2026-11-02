import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFRawStream, PDFPage, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';
import { mm, type DocumentInfo, type LayoutPlan, type PrintSettings, type PlannedPage } from './core';
const key=(s:string)=>PDFName.of(s);
function readNumber(d:PDFDict,k:string,fallback:number) {const n=d.lookup(key(k));if(n===undefined)return fallback;if(!(n instanceof PDFNumber))throw Error(`Invalid ${k}.`);return n.asNumber();}
export async function preflight(bytes:Uint8Array):Promise<DocumentInfo> {
  if(bytes.byteLength>20*1024*1024)throw Error('PDF exceeds the 20 MiB product limit.');
  if(!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))throw Error('Choose a valid PDF file.');
  let d:PDFDocument;
  try {d=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});}
  catch(e){if(String(e).toLowerCase().includes('encrypt'))throw Error('Encrypted PDFs are not supported. Export a static, unencrypted print copy from the original app.');throw Error('This PDF is damaged or could not be parsed.');}
  if(d.isEncrypted)throw Error('Encrypted PDFs are not supported.');
  let sourcePages:PDFPage[];
  try {if(!(d.catalog instanceof PDFDict))throw Error();sourcePages=d.getPages();}catch {throw Error('This PDF is damaged or has an invalid page tree.');}
  if(sourcePages.length===0||sourcePages.length>120)throw Error('Choose a PDF with 1 to 120 pages.');
  const form=d.catalog.lookup(key('AcroForm'));
  if(form!==undefined) {
    if(!(form instanceof PDFDict))throw Error('Unrecognized form structure. Export a static print copy.');
    const fields=form.lookup(key('Fields'));
    if(form.has(key('XFA')) || (fields!==undefined&&(!(fields instanceof PDFArray)||fields.size()>0)))throw Error('Forms, XFA and signature fields are not supported. Export a static print copy.');
  }
  const warnings=new Set<string>();
  for(const [,obj] of d.context.enumerateIndirectObjects())if(obj instanceof PDFRawStream&&String(obj.dict.lookup(key('Subtype')))==='/Image') {
    const w=readNumber(obj.dict,'Width',0),h=readNumber(obj.dict,'Height',0);
    if(w<=0||h<=0||!Number.isFinite(w*h))throw Error('An image has invalid dimensions. Export a static print copy.');
    if(w*h>16_000_000)throw Error('An image exceeds the 16 megapixel preview safety limit. Export a lower-resolution static print copy.');
    warnings.add('This PDF contains raster images. Enlarging them cannot improve resolution or turn them into vectors.');
  }
  const pages=sourcePages.map((p,i)=>{
    const fail=(m:string):never=>{throw Error(`Source page ${i+1}: ${m}`);};
    if(readNumber(p.node,'UserUnit',1)!==1)fail('nonstandard UserUnit is not supported.');
    const rotation=((p.getRotation().angle%360)+360)%360;
    if(![0,90,180,270].includes(rotation))fail('only right-angle rotations are supported.');
    const media=p.getMediaBox(), raw=p.getCropBox();
    if(![media.x,media.y,media.width,media.height,raw.x,raw.y,raw.width,raw.height].every(Number.isFinite)||media.width<=0||media.height<=0||raw.width<=0||raw.height<=0)fail('invalid page boxes.');
    const x=Math.max(media.x,raw.x), y=Math.max(media.y,raw.y);
    const crop={x,y,width:Math.min(media.x+media.width,raw.x+raw.width)-x,height:Math.min(media.y+media.height,raw.y+raw.height)-y};
    if(crop.width<=0||crop.height<=0||crop.width>mm(5000)||crop.height>mm(5000))fail('invalid or excessive visible page size.');
    const annots=p.node.lookup(key('Annots'));
    if(annots!==undefined) {
      if(!(annots instanceof PDFArray))fail('unrecognized annotation structure.');
      for(let j=0;j<(annots as PDFArray).size();j++) {
        const a=(annots as PDFArray).lookup(j);
        if(!(a instanceof PDFDict)||String(a.lookup(key('Subtype')))!=='/Link'||a.has(key('AP')))fail('visible, form or unknown annotation. Export a static print copy.');
        warnings.add('Links are flattened to static print content; navigation is not preserved.');
      }
    }
    return {width:rotation%180?crop.height:crop.width,height:rotation%180?crop.width:crop.height,rotation,crop};
  });
  for(let i=1;i<pages.length;i++)if(Math.abs(pages[i].width-pages[0].width)>mm(.1)||Math.abs(pages[i].height-pages[0].height)>mm(.1))throw Error(`Source page ${i+1}: mixed visible page sizes are not supported.`);
  return {pages,warnings:[...warnings]};
}
function rotationMatrix(r:number,w:number,h:number):[number,number,number,number,number,number] {
  if(r===90)return [0,-1,1,0,0,w];
  if(r===180)return [-1,0,0,-1,w,h];
  if(r===270)return [0,1,-1,0,h,0];
  return [1,0,0,1,0,0];
}
function marks(page:PDFPage,p:PlannedPage,h:number,s:PrintSettings) {
  const t=p.trim,x=t.x-(p.side==='back'?mm(s.offsetX):0),y=t.y-(p.side==='back'?mm(s.offsetY):0),len=mm(2),gap=mm(1);
  for(const xx of [x,x+t.width])for(const yy of [y,y+t.height]) {
    const sx=xx===x?-1:1,sy=yy===y?-1:1;
    page.drawLine({start:{x:xx+sx*gap,y:h-yy},end:{x:xx+sx*(gap+len),y:h-yy},thickness:.35,color:rgb(.3,.3,.3)});
    page.drawLine({start:{x:xx,y:h-(yy+sy*gap)},end:{x:xx,y:h-(yy+sy*(gap+len))},thickness:.35,color:rgb(.3,.3,.3)});
  }
}
export async function buildPdf(bytes:Uint8Array,layout:LayoutPlan,kind:'full'|'fronts'|'backs'='full'):Promise<Uint8Array> {
  if(layout.errors.length)throw Error(layout.errors.join(' '));
  const info=await preflight(bytes),source=await PDFDocument.load(bytes,{updateMetadata:false}),out=await PDFDocument.create();
  out.setTitle('Planner print-ready');out.setAuthor('');out.setCreator('Planner Print Prep');
  const selected=kind==='fronts'?layout.fronts:kind==='backs'?layout.backs:layout.pages;
  for(const p of selected) {
    const page=out.addPage([layout.width,layout.height]);
    if(p.source===null)continue;
    const src=info.pages[p.source];const b=src.crop;
    const sourcePage=source.getPage(p.source);
    // An original blank is still a real source page. pdf-lib requires a Contents stream for embedding.
    if(!sourcePage.node.Contents())sourcePage.pushOperators(pushGraphicsState(),popGraphicsState());
    const embedded=await out.embedPage(sourcePage,{left:b.x,bottom:b.y,right:b.x+b.width,top:b.y+b.height});
    page.pushOperators(pushGraphicsState());
    if(p.outputRotation===180)page.pushOperators(concatTransformationMatrix(-1,0,0,-1,layout.width,layout.height));
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(p.scale,0,0,p.scale,p.content.x,layout.height-p.content.y-p.content.height),concatTransformationMatrix(...rotationMatrix(src.rotation,b.width,b.height)));
    page.drawPage(embedded,{x:0,y:0,width:b.width,height:b.height});
    page.pushOperators(popGraphicsState());
    if(layout.settings.marks)marks(page,p,layout.height,layout.settings);
    page.pushOperators(popGraphicsState());
  }
  return out.save();
}
export async function testPdf(s:PrintSettings):Promise<Uint8Array> {
  const d=await PDFDocument.create();const [w,h]=s.paper==='Letter'?[612,792]:[mm(210),mm(297)];
  for(let side=0;side<2;side++) {
    const p=d.addPage([w,h]);p.pushOperators(pushGraphicsState());
    if(side&&s.flip==='short')p.pushOperators(concatTransformationMatrix(-1,0,0,-1,w,h));
    if(side)p.pushOperators(concatTransformationMatrix(1,0,0,1,-mm(s.offsetX),mm(s.offsetY)));
    const line=(x:number,y:number,x2:number,y2:number)=>p.drawLine({start:{x,y},end:{x:x2,y:y2},thickness:.5});
    p.drawText(`${side?'BACK':'FRONT'} - TOP ^`,{x:mm(20),y:h-mm(25),size:20});
    p.drawText('Print at 100% / Actual size. Check paper and flip edge.',{x:mm(20),y:h-mm(35),size:10});
    p.drawText(`${s.paper} / ${s.flip}-edge / ${side?'B':'A'}`,{x:mm(20),y:h-mm(42),size:10});
    line(w/2-mm(15),h/2,w/2+mm(15),h/2);line(w/2,h/2-mm(15),w/2,h/2+mm(15));
    const x=mm(30),y=mm(40);line(x,y,x+mm(100),y);line(x,y,x,y+mm(100));
    for(let t=0;t<=100;t+=10){line(x+mm(t),y-mm(2),x+mm(t),y+mm(2));line(x-mm(2),y+mm(t),x+mm(2),y+mm(t));}
    p.drawText('100 mm horizontal',{x,y:y-mm(8),size:10});p.drawText('100 mm vertical',{x:x+mm(5),y:y+mm(95),size:10});
    for(const [label,cx,cy] of [['A / 1',mm(18),h-mm(16)],['B / 2',w-mm(40),h-mm(16)],['C / 3',mm(18),mm(18)],['D / 4',w-mm(40),mm(18)]] as const)p.drawText(`${side?'BACK':'FRONT'} ${label}`,{x:cx,y:cy,size:9});
    p.pushOperators(popGraphicsState());
  }
  return d.save();
}
