import './style.css';
import './design-preview';
import {setupPlus} from './plus';
import {defaults,parseSettings,exportSettings,toMm,mm,rectOnOutput,type PrintSettings,type DocumentInfo,type LayoutPlan,type PlannedPage} from './core';
import type * as PDFJS from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
let pdfjs:typeof import('pdfjs-dist');
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let settings:PrintSettings={...defaults}, fileBytes:Uint8Array|null=null,info:DocumentInfo|null=null,layout:LayoutPlan|null=null;
let output:Uint8Array|null=null, pdf:PDFJS.PDFDocumentProxy|null=null, version=0, previewVersion=0;
let worker:Worker|null=null, rejectWorker:((reason:unknown)=>void)|null=null, timer:ReturnType<typeof setTimeout>|undefined;
let sampleController:AbortController|null=null;
let busy=false,invalidSettings=false, calibration:'none'|'reported'|'recheck'='none',previousOffset:[number,number]|null=null;
const urls=new Set<string>();
const message=(text:string)=>{$('status').textContent=text;};
function abortTask() {
  sampleController?.abort();sampleController=null;
  worker?.terminate();worker=null;
  const reject=rejectWorker;rejectWorker=null;reject?.(new DOMException('Cancelled','AbortError'));
}
function releaseOutput() {
  output=null;previewVersion++;const old=pdf;pdf=null;if(old)void old.loadingTask.destroy();
  for(const id of ['front-canvas','back-canvas']){const c=$<HTMLCanvasElement>(id);c.width=0;c.height=0;}
  document.querySelector('dialog')?.remove();
  for(const u of urls)URL.revokeObjectURL(u);urls.clear();
}
function setBusy(value:boolean) {
  busy=value;$('cancel').hidden=!value;
  $('sample').toggleAttribute('disabled',value);$('test-download').toggleAttribute('disabled',value||invalidSettings);
  $('settings-save').toggleAttribute('disabled',invalidSettings);
  updateButtons();
}
function updateButtons() {
  const ready=!!output&&!busy&&!invalidSettings&&!!layout&&!layout.errors.length&&$('source-confirm') instanceof HTMLInputElement&&($('source-confirm') as HTMLInputElement).checked;
  for(const id of ['export-full','export-fronts','export-backs','open-pdf','share','print-guide-button'])$(id).toggleAttribute('disabled',!ready);
  $('clear').toggleAttribute('disabled',!fileBytes&&!busy);
  const manual=settings.mode==='manual';$('export-fronts').hidden=!manual;$('export-backs').hidden=!manual;
}
function request(action:'generate'|'test',bytes:Uint8Array|null,s:PrintSettings,kind='full'):Promise<{output?:Uint8Array;info?:DocumentInfo;layout?:LayoutPlan}> {
  abortTask();const id=version;
  return new Promise((resolve,reject)=>{
    const local=new Worker(new URL('./pdf.worker.ts',import.meta.url),{type:'module'});worker=local;rejectWorker=reject;
    local.onerror=()=>{local.terminate();if(worker===local){worker=null;rejectWorker=null;}reject(Error('PDF processing stopped. Try a smaller static PDF or a desktop browser.'));};
    local.onmessage=e=>{
      if(id!==version)return;
      if(e.data.phase==='parsed') {setInfo(e.data.info);return;}
      local.terminate();if(worker===local){worker=null;rejectWorker=null;}
      if(e.data.error)reject(Error(e.data.error));else resolve(e.data);
    };
    const copy=bytes?.slice();local.postMessage({id,action,settings:s,kind,bytes:copy?.buffer},copy?[copy.buffer]:[]);
  });
}
function setInfo(next:DocumentInfo) {
  info=next;const first=next.pages[0];
  const display=(n:number)=>settings.unit==='mm'?`${toMm(n).toFixed(1)} mm`:`${(n/72).toFixed(3)} in`;
  $('document-status').textContent=`${next.pages.length} pages · ${display(first.width)} × ${display(first.height)} · ${next.pages.some(p=>p.rotation)?'source rotation normalized':'portrait reading order'}`;
}
function issueText(errors:string[],warnings:string[]=[]) {
  const box=$('issues');box.replaceChildren();
  for(const text of [...errors,...warnings]){const p=document.createElement('p');p.textContent=text;box.append(p);}
}
function syncFields() {
  for(const [name,value] of Object.entries(settings)) {
    const el=document.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${name}"]`);if(!el)continue;
    if(el instanceof HTMLInputElement&&el.type==='checkbox')el.checked=Boolean(value);
    else el.value=typeof value==='number'&&name.startsWith('custom')&&settings.unit==='in'?(value/25.4).toFixed(5):String(value);
  }
  for(const el of document.querySelectorAll('.dimension-unit'))el.textContent=settings.unit;
  for(const name of ['customWidth','customHeight']) {
    const el=$(name) as HTMLInputElement;
    el.min=String((name==='customWidth'?60:100)/(settings.unit==='in'?25.4:1));
    el.max=String((name==='customWidth'?210:260)/(settings.unit==='in'?25.4:1));el.step=settings.unit==='in'?'0.001':'0.1';
  }
  $('custom-fields').hidden=settings.trim!=='Custom';$('duplex-options').hidden=settings.mode==='single';$('reverse-label').hidden=settings.mode!=='manual';
  compensation();updateButtons();
}
function readFields():PrintSettings {
  const next={...settings} as unknown as Record<string,unknown>;
  for(const [name,value] of Object.entries(defaults)) {
    const el=document.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${name}"]`);if(!el)continue;
    next[name]=typeof value==='boolean'?(el as HTMLInputElement).checked:typeof value==='number'?(el as HTMLInputElement).valueAsNumber:el.value;
    if(typeof value==='number'&&name.startsWith('custom')&&settings.unit==='in')next[name]=Math.round((next[name] as number)*25.4*1e6)/1e6;
  }
  return parseSettings(JSON.stringify(next));
}
function calibrationLabel() {
  $('calibration-status').textContent=calibration==='reported'?'User-reported test check for these settings. The app cannot verify physical printing.':calibration==='recheck'?'Recheck your test print: print settings changed.':'Not test-printed.';
  $('preview-badge').textContent=calibration==='reported'?'USER-REPORTED TEST':calibration==='recheck'?'RECHECK TEST PRINT':'NOT TEST-PRINTED';
}
function compensation() {
  const move=(n:number,pos:string,neg:string)=>`${Math.abs(n)} mm ${n>=0?pos:neg}`;
  $('compensation').textContent=settings.mode==='single'?'Single-sided: no back-side compensation.':settings.offsetX||settings.offsetY?`Move the back ${move(settings.offsetX,'left','right')} and ${move(settings.offsetY,'up','down')}.`:'No back-side compensation.';
}
function printSummary() {
  return `${settings.paper} paper · 100% / Actual size in the printer dialog · ${settings.mode==='single'?'single-sided':settings.flip+'-edge duplex'}. ${layout?`${layout.pages.length} output sides / ${layout.sheets} sheets. `:''}${calibration==='reported'?'Test checked by you.':'Not test-printed for current settings.'} Start with a test sheet. ${layout?.pages.some(p=>p.source===null)?'Added blank sides are included; do not skip blanks. ':''}${settings.mode==='manual'?'Print Fronts first, then Backs using your tested feed direction. '+(settings.reverseBacks?'Back stack is reversed.':'Back stack is in sheet order.'):''}`;
}
function updatePlan() {
  if(!layout)return;
  $('sheet-summary').textContent=`${layout.sheets} sheets · ${layout.pages.length} output sides`;
  const ids=(p:PlannedPage[])=>p.map(v=>v.source===null?'blank':String(v.source+1)).join(', ');
  $('page-order').textContent=layout.pages.map(p=>`Sheet ${p.sheet} ${p.side}: ${p.source===null?'added blank':'source '+(p.source+1)}`).join(' · ');
  $('fronts-order').textContent='Fronts: '+ids(layout.fronts);$('backs-order').textContent='Backs: '+ids(layout.backs);
  $('scale-summary').textContent=`Design scale ${(layout.pages[0].scale*100).toFixed(2)}% · whole design, unchanged proportions.`;
  const select=$<HTMLSelectElement>('sheet'),old=Number(select.value)||1;select.replaceChildren();
  for(let i=1;i<=layout.sheets;i++){const o=document.createElement('option');o.value=String(i);o.textContent=String(i);select.append(o);}select.value=String(Math.min(old,layout.sheets));
  $('print-guide').textContent=printSummary();issueText(layout.errors,layout.warnings);
}
async function rebuild() {
  clearTimeout(timer);const mine=++version;abortTask();releaseOutput();layout=null;setBusy(false);updateButtons();
  if(!fileBytes)return;
  if(invalidSettings){message('Correct the invalid print settings before generating a PDF.');return;}
  if(!$<HTMLInputElement>('source-confirm').checked){issueText(['This tool expects one insert per source page. It cannot split an already imposed spread.']);return;}
  setBusy(true);message('Reading pages and preparing your paper view…');
  try {
    const result=await request('generate',fileBytes,settings);
    if(mine!==version)return;
    layout=result.layout!;setInfo(result.info!);updatePlan();
    if(result.output){
      output=result.output;
      pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
      const loading=pdfjs.getDocument({data:result.output.slice(),enableXfa:false,stopAtErrors:true,maxImageSize:16_000_000,disableFontFace:false,standardFontDataUrl:import.meta.env.BASE_URL+'pdfjs/standard_fonts/',cMapUrl:import.meta.env.BASE_URL+'pdfjs/cmaps/',cMapPacked:true,wasmUrl:import.meta.env.BASE_URL+'pdfjs/wasm/'});
      const loaded=await loading.promise;
      if(mine!==version){await loaded.loadingTask.destroy();return;}pdf=loaded;
      $('preview-live').hidden=false;$('preview-empty').hidden=true;
      await renderPreview();
      if(!output)throw Error('The preview could not be rendered. Export is disabled to avoid a misleading result.');
      message('Print-ready file generated. Check every sheet and test before printing.');
      $('export-status').textContent='Current PDF generated for these settings. Saving and physical printing remain separate steps.';
    }else{message('Change the settings below to resolve the layout conflict.');$('preview-live').hidden=true;$('preview-empty').hidden=false;}
  }catch(e){
    if(mine!==version||e instanceof DOMException&&e.name==='AbortError')return;
    releaseOutput();message(e instanceof Error?e.message:'Could not process this PDF.');issueText([String(e instanceof Error?e.message:e)]);
  }finally{if(mine===version)setBusy(false);}
}
async function choose(bytes:Uint8Array) {
  ++version;abortTask();releaseOutput();fileBytes=bytes;info=null;layout=null;calibration='none';calibrationLabel();
  $('document-status').textContent='Checking local PDF…';
  await rebuild();
}
async function renderPage(index:number,canvas:HTMLCanvasElement,upright:boolean,decorate=true) {
  const current=pdf,lp=layout;if(!current||!lp)return;
  const item=lp.pages[index];const page=await current.getPage(index+1);
  const viewport=page.getViewport({scale:1.2});
  const temp=document.createElement('canvas');temp.width=Math.ceil(viewport.width);temp.height=Math.ceil(viewport.height);
  await page.render({canvas:temp,viewport,annotationMode:pdfjs.AnnotationMode.DISABLE}).promise;
  const ctx=canvas.getContext('2d')!;canvas.width=temp.width;canvas.height=temp.height;
  ctx.save();if(upright&&item.outputRotation===180){ctx.translate(canvas.width,canvas.height);ctx.rotate(Math.PI);}ctx.drawImage(temp,0,0);ctx.restore();
  if(decorate) {
    const k=1.2;ctx.save();if(!upright&&item.outputRotation===180){ctx.translate(canvas.width,canvas.height);ctx.rotate(Math.PI);}
    ctx.strokeStyle='rgba(28,28,28,.6)';ctx.lineWidth=.7;
    const t=item.trim;ctx.strokeRect(t.x*k,t.y*k,t.width*k,t.height*k);
    const s=lp.settings;
    if(s.band){ctx.fillStyle='rgba(28,28,28,.06)';ctx.fillRect((t.x+(item.side==='back'?t.width-mm(s.band):0))*k,t.y*k,mm(s.band)*k,t.height*k);}
    ctx.setLineDash([1,3]);const c=item.content;ctx.strokeRect(c.x*k,c.y*k,c.width*k,c.height*k);ctx.restore();
    // Safe margins belong to raw output paper edges. Turn the guide only when the preview is upright.
    const safe={x:mm(s.marginLeft),y:mm(s.marginTop),width:lp.width-mm(s.marginLeft+s.marginRight),height:lp.height-mm(s.marginTop+s.marginBottom)};
    const visibleSafe=rectOnOutput(safe,lp.width,lp.height,upright?item.outputRotation:0);
    ctx.save();ctx.lineWidth=.7;ctx.strokeStyle='rgba(28,28,28,.4)';ctx.setLineDash([5,4]);
    ctx.strokeRect(visibleSafe.x*k,visibleSafe.y*k,visibleSafe.width*k,visibleSafe.height*k);ctx.restore();
  }
  temp.width=0;temp.height=0;page.cleanup();
}
async function renderPreview() {
  if(!pdf||!layout)return;const mine=++previewVersion;
  const sheet=Number($<HTMLSelectElement>('sheet').value)||1,mode=$<HTMLSelectElement>('preview-mode').value;
  const frontIndex=layout.pages.findIndex(p=>p.sheet===sheet&&p.side==='front'),backIndex=layout.pages.findIndex(p=>p.sheet===sheet&&p.side==='back');
  const front=document.createElement('canvas'),back=document.createElement('canvas');
  try {
    await renderPage(frontIndex,front,mode!=='output');
    if(backIndex>=0)await renderPage(backIndex,back,mode!=='output',mode!=='overlay');
    if(mine!==previewVersion)return;
    const dest=$<HTMLCanvasElement>('front-canvas');dest.width=front.width;dest.height=front.height;const ctx=dest.getContext('2d')!;ctx.drawImage(front,0,0);
    if(mode==='overlay'&&backIndex>=0){ctx.save();ctx.globalAlpha=.4;ctx.translate(dest.width,0);ctx.scale(-1,1);ctx.globalCompositeOperation='multiply';ctx.drawImage(back,0,0);ctx.restore();}
    const bd=$<HTMLCanvasElement>('back-canvas');bd.width=back.width||1;bd.height=back.height||1;if(backIndex>=0)bd.getContext('2d')!.drawImage(back,0,0);
    const label=(p:PlannedPage)=>p.source===null?'ADDED BLANK':`SOURCE ${p.source+1}`;
    $('front-caption').textContent=`SHEET ${sheet} / FRONT · ${label(layout.pages[frontIndex])}`;
    $('back-caption').textContent=backIndex>=0?`SHEET ${sheet} / BACK · ${label(layout.pages[backIndex])}`:'';
    $('back-figure').hidden=backIndex<0||mode==='overlay';
    $('preview-description').textContent=mode==='overlay'?'View through the front: the upright back is reflected horizontally, as when turning the insert on its left edge. The back appears mirrored.':mode==='output'?'Actual PDF output direction. Short-edge backs are intentionally upside down. Guides shown here are preview-only.':'Both sides shown upright. Safe-area, binding and content guides are preview-only; only selected trim marks go into the PDF.';
  }catch(e){if(mine===previewVersion){releaseOutput();updateButtons();message('Could not render the paper view. Try a smaller static PDF.');}}
}
function fileUrl(bytes:Uint8Array,type='application/pdf') {const url=URL.createObjectURL(new Blob([bytes.slice().buffer],{type}));urls.add(url);return url;}
function save(bytes:Uint8Array,name:string,type='application/pdf') {const a=document.createElement('a');a.href=fileUrl(bytes,type);a.download=name;a.click();}
function changed() {
  document.dispatchEvent(new Event('ppp-settings-changed'));
  const old={...settings};
  try {
    const next=readFields();
    if(next.offsetX!==old.offsetX||next.offsetY!==old.offsetY){previousOffset=[old.offsetX,old.offsetY];$('offset-undo').removeAttribute('disabled');}
    settings=next;invalidSettings=false;
    if(calibration==='reported')calibration='recheck';calibrationLabel();syncFields();
    if(info)setInfo(info);
    ++version;abortTask();releaseOutput();setBusy(false);$('export-status').textContent='Settings changed. Previous generated files are no longer current.';
    clearTimeout(timer);timer=setTimeout(()=>void rebuild(),200);
  }catch(e){clearTimeout(timer);invalidSettings=true;++version;abortTask();releaseOutput();setBusy(false);message(e instanceof Error?e.message:'Invalid settings.');issueText([e instanceof Error?e.message:'Invalid settings.']);}
}
$('settings-form').addEventListener('submit',e=>e.preventDefault());
$('settings-form').addEventListener('input',e=>{if((e.target as HTMLElement).id!=='test-result')changed();});
$<HTMLInputElement>('pdf-input').addEventListener('change',async e=>{
  const input=e.target as HTMLInputElement;const f=input.files?.[0];if(!f)return;
  if(f.size>20*1024*1024){++version;abortTask();releaseOutput();fileBytes=null;info=null;layout=null;setBusy(false);message('PDF exceeds the 20 MiB product limit.');input.value='';return;}
  const readVersion=++version;abortTask();releaseOutput();setBusy(false);
  const bytes=new Uint8Array(await f.arrayBuffer());if(readVersion!==version)return;
  await choose(bytes);input.value='';
});
$('sample').addEventListener('click',async()=>{
  const mine=++version;clearTimeout(timer);abortTask();releaseOutput();setBusy(true);message('Loading the example PDF…');
  const controller=new AbortController();sampleController=controller;
  try {
    const response=await fetch(import.meta.env.BASE_URL+'samples/planner-sample.pdf',{signal:controller.signal});
    if(mine!==version)return;
    if(!response.ok)throw Error('Sample could not be loaded.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(mine!==version)return;
    sampleController=null;await choose(bytes);
  }catch(e){if(mine===version&&!(e instanceof DOMException&&e.name==='AbortError'))message(e instanceof Error?e.message:'Sample could not be loaded.');}
  finally{if(sampleController===controller)sampleController=null;if(mine===version)setBusy(false);}
});
$('clear').addEventListener('click',()=>{
  ++version;clearTimeout(timer);abortTask();releaseOutput();fileBytes=null;info=null;layout=null;calibration='none';calibrationLabel();setBusy(false);
  $('document-status').textContent='No PDF selected';$('preview-live').hidden=true;$('preview-empty').hidden=false;$('sheet-summary').textContent='Your paper, at a glance.';issueText([]);message('File cleared from this page. Refreshing will not restore it.');
  $('page-order').textContent='Choose a PDF to see its page pairs.';$('fronts-order').textContent='';$('backs-order').textContent='';$('print-guide').textContent='Choose a PDF to prepare your print guide.';
});
$('cancel').addEventListener('click',()=>{++version;clearTimeout(timer);abortTask();releaseOutput();setBusy(false);message('Processing cancelled. Choose a PDF or change a setting to try again.');});
$('source-confirm').addEventListener('change',()=>void rebuild());
$('sheet').addEventListener('change',()=>void renderPreview());$('preview-mode').addEventListener('change',()=>void renderPreview());
for(const kind of ['full','fronts','backs'] as const)$('export-'+kind).addEventListener('click',async()=>{
  if(!output||!fileBytes)return;
  const mine=version;
  try {
    let bytes=output;
    if(kind!=='full'){setBusy(true);const result=await request('generate',fileBytes,settings,kind);if(mine!==version)return;bytes=result.output!;}
    save(bytes,kind==='full'?'planner-print-ready.pdf':`planner-${kind}.pdf`);
    $('export-status').textContent='Download requested. Check that your browser saved the file; printing has not been verified.';
  }catch(e){if(mine===version)$('export-status').textContent=String(e);}finally{if(mine===version)setBusy(false);}
});
$('open-pdf').addEventListener('click',()=>{if(output){const opened=window.open(fileUrl(output),'_blank','noopener,noreferrer');$('export-status').textContent='Opening the PDF in a new tab was requested. If blocked, use Download.';void opened;}});
$('test-download').addEventListener('click',async()=>{
  const mine=version;setBusy(true);
  try {const result=await request('test',null,settings);if(mine===version){save(result.output!,'planner-test-print.pdf');message('Test PDF generated. Print at 100% and match the selected flip edge.');}}
  catch(e){if(mine===version)message(String(e));}finally{if(mine===version)setBusy(false);}
});
$('test-result').addEventListener('change',()=>{
  const result=$<HTMLSelectElement>('test-result').value;
  const advice:Record<string,string>={skip:'You can export now and test later. Your result remains marked as not test-printed.',scale:'Check 100% / Actual size, paper size and print path first. A ruler that is not 100 mm indicates scaling; do not hide it with an offset.',shift:'Repeat a test to check stability, then enter the observed shift while viewing the back upright. The compensation is opposite.',random:'A fixed offset cannot repair skew or random feeding. Check the paper, duplex specifications and feed path.'};
  $('test-advice').textContent=advice[result];if(result==='scale'||result==='random'){calibration='recheck';calibrationLabel();}
});
$('confirm-test').addEventListener('click',()=>{
  const r=$<HTMLSelectElement>('test-result').value;
  if(r==='scale'||r==='random'){message('Resolve the size / unstable-feed issue before marking a test checked.');return;}
  calibration='reported';calibrationLabel();$('print-guide').textContent=printSummary();
});
$('skip-test').addEventListener('click',()=>{calibration='none';calibrationLabel();$('print-guide').textContent=printSummary();});
$('offset-reset').addEventListener('click',()=>{$<HTMLInputElement>('offsetX').value='0';$<HTMLInputElement>('offsetY').value='0';changed();});
$('offset-undo').addEventListener('click',()=>{if(!previousOffset)return;const old=previousOffset;$<HTMLInputElement>('offsetX').value=String(old[0]);$<HTMLInputElement>('offsetY').value=String(old[1]);changed();});
$('settings-save').addEventListener('click',()=>{save(new TextEncoder().encode(exportSettings(settings)),'planner-print-settings.json','application/json');$('settings-status').textContent='Settings download requested. No PDF information included.';});
$('settings-input').addEventListener('change',async e=>{
  const input=e.target as HTMLInputElement,f=input.files?.[0];if(!f)return;
  try {if(f.size>16*1024)throw Error('Settings file is too large.');settings=parseSettings(await f.text());invalidSettings=false;syncFields();calibration='recheck';calibrationLabel();$('settings-status').textContent='Settings loaded. Recheck a test print.';await rebuild();}
  catch(e){$('settings-status').textContent='Could not load settings: '+(e instanceof Error?e.message:'Invalid JSON.');}input.value='';
});
$('diagnostic').addEventListener('click',()=>{
  const text=$<HTMLTextAreaElement>('diagnostic-text');text.hidden=false;
  text.value=JSON.stringify({appVersion:'0.1.0',feedback:$<HTMLSelectElement>('feedback').value,paper:settings.paper,trim:settings.trim,mode:settings.mode,flip:settings.flip,scale:settings.scale,calibration},null,2);text.focus();text.select();
});
$('print-guide-button').addEventListener('click',()=>{
  let summary=$('print-summary');if(!summary){summary=document.createElement('section');summary.id='print-summary';summary.hidden=true;document.body.append(summary);}
  summary.replaceChildren();const heading=document.createElement('h1');heading.textContent='Planner Print Prep — Print guide';summary.append(heading);
  for(const text of [printSummary(),$('fronts-order').textContent??'',$('backs-order').textContent??'','Use the A/B two-sheet test to establish manual feed direction. PDF generation does not prove printer accuracy.']){const p=document.createElement('p');p.textContent=text;summary.append(p);}window.print();
});
if(navigator.canShare&&navigator.share){$('share').hidden=false;$('share').addEventListener('click',async()=>{
  if(!output)return;
  const f=new File([output.slice().buffer],'planner-print-ready.pdf',{type:'application/pdf'});
  if(!navigator.canShare({files:[f]})){$('export-status').textContent='File sharing is unavailable. Use Download or Open PDF.';return;}
  try{await navigator.share({files:[f]});$('export-status').textContent='Share action completed. Saving or printing is not verified.';}
  catch(e){$('export-status').textContent=e instanceof DOMException&&e.name==='AbortError'?'Share cancelled. Your generated PDF is still available.':'Sharing unavailable. Your PDF is ready to download or open.';}
});}
window.addEventListener('pagehide',()=>{abortTask();releaseOutput();fileBytes=null;});
syncFields();calibrationLabel();
setupPlus({getSettings:()=>{if(invalidSettings)throw Error('Correct the invalid workspace settings first.');return structuredClone(settings);},applySettings:next=>{settings=next;invalidSettings=false;calibration='recheck';calibrationLabel();syncFields();void rebuild();}});
const zoom=document.createElement('button');zoom.id='enlarge';zoom.type='button';zoom.textContent='Enlarge this sheet';$('preview-live').append(zoom);
zoom.addEventListener('click',()=>{
  const dialog=document.createElement('dialog');dialog.className='enlarged';
  const close=document.createElement('button');close.textContent='Close enlarged preview';close.addEventListener('click',()=>dialog.close());dialog.append(close);
  const note=document.createElement('p');note.textContent='Scroll to inspect the current preview at full resolution. This view does not alter the PDF.';dialog.append(note);
  const area=document.createElement('div');area.className='zoom-area';
  for(const id of ['front-canvas','back-canvas']){
    if(id==='back-canvas'&&$('back-figure').hidden)continue;
    const src=$<HTMLCanvasElement>(id),copy=document.createElement('canvas');copy.width=src.width;copy.height=src.height;copy.getContext('2d')!.drawImage(src,0,0);area.append(copy);
  }
  dialog.append(area);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
});
