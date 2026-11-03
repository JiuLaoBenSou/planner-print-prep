import './plus.css';
import {setupAccess} from './plus-access';
import {parseProfiles,saveProfile,runBatch,validateQueue,type Profile,type BatchInput,type BatchOutput,type OutputFile} from './plus-core';
import type {PrintSettings} from './core';
export function setupPlus(bridge:{getSettings:()=>PrintSettings;applySettings:(settings:PrintSettings)=>void}){
 const section=document.querySelector<HTMLElement>('#plus')!;
 section.innerHTML=`<details><summary id="plus-open">Plus · batch PDFs &amp; saved print profiles <span>US$9 once</span></summary>
 <div class="plus-body"><p>Prepare up to 10 PDFs in one queue, reuse saved print settings, and download one ZIP with a report for each file. US$9 once, plus applicable taxes. No subscription. Individual PDFs stay free. Files stay on your device.</p><p>Request a full refund within 7 days of payment, for any reason. <a href="${import.meta.env.BASE_URL}refunds/">Refund policy</a>.</p>
 <div class="plus-license"></div>
 <div class="plus-grid"><div><h2>Named print profiles</h2><p>Save up to 20 print setups, such as A5 on Letter or a manual-duplex path. Profiles contain settings only. Recheck a test print when you switch setups.</p>
 <label>Profile name<input id="profile-name" maxlength="48" placeholder="e.g. A5 on Letter · long edge"></label>
 <label>Saved profile<select id="profile-select" size="3"></select></label>
 <div class="actions"><button id="profile-save" type="button" disabled>Save current settings</button><button id="profile-replace" type="button" disabled>Replace selected</button><button id="profile-apply" type="button" disabled>Apply selected</button><button id="profile-delete" type="button" disabled>Delete selected</button></div>
 <label class="check"><input id="profiles-remember" type="checkbox"> Remember profiles in this browser</label>
 <div class="actions"><button id="profiles-export" type="button">Download profile backup</button><label class="button" for="profiles-input">Import profile backup</label><input id="profiles-input" class="visually-hidden" type="file" accept=".json,application/json"><button id="profiles-clear" type="button">Clear all saved profiles</button></div><p id="profile-status" role="status">Profiles stay in page memory unless you choose to remember them.</p></div>
 <div><h2>Batch PDF queue</h2><p>Apply the current settings to every file. Each PDF is checked and paired separately, so its front/back order and blank pages stay together. Print each document as its own stack.</p>
 <label>Batch PDFs<input id="batch-input" type="file" accept=".pdf,application/pdf" multiple disabled></label><p class="field-note">Up to 10 PDFs · 20 MiB each · 80 MiB total · 64 MiB output. Manual duplex includes Full, Fronts and Backs for each file.</p>
 <label class="check"><input id="batch-confirm" type="checkbox"> Each source page contains one insert, and I have permission to process these PDFs.</label>
 <ol id="batch-queue"></ol><div class="actions"><button id="batch-run" type="button" disabled>Check &amp; prepare batch</button><button id="batch-cancel" type="button" disabled>Cancel batch</button><button id="batch-download" type="button" disabled>Download batch ZIP</button><button id="batch-clear" type="button">Clear queue</button></div><p id="batch-status" role="status">Choose PDFs after activating Plus. Print one test sheet before a full batch.</p></div></div>
 <p class="field-note">Print one test sheet before a full batch. Plus saves preparation time; it cannot control your printer or grant rights to third-party templates.</p>
 <p><a href="${import.meta.env.BASE_URL}pricing/">Pricing &amp; delivery</a> · <a href="${import.meta.env.BASE_URL}terms/">Terms</a> · <a href="${import.meta.env.BASE_URL}refunds/">Refund policy</a></p></div></details>`;
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>section.querySelector<T>('#'+id)!;
 const status=(id:string,message:string)=>{el(id).textContent=message;};
 let profiles:Profile[]=[],files:BatchInput[]=[],archive:Uint8Array|null=null;
 let active=false,running=false,jobVersion=0,controller:AbortController|null=null,loaded=false,profileVersion=0;
 const profilesName='ppp-plus-profiles-v1';
 const checked=(id:string)=>el<HTMLInputElement>(id).checked;
 function update(){
  for(const id of ['profile-save','profile-replace','profile-apply','profile-delete','batch-input'])el(id).toggleAttribute('disabled',!active||running);
  el('batch-run').toggleAttribute('disabled',!active||running||!files.length);
  el('batch-cancel').toggleAttribute('disabled',!running);
  el('batch-download').toggleAttribute('disabled',!active||running||!archive);
 }
 function invalidate(message:string){jobVersion++;controller?.abort();controller=null;archive=null;running=false;status('batch-status',message);update();}
 function persistProfiles(){try{if(checked('profiles-remember'))localStorage.setItem(profilesName,JSON.stringify({schemaVersion:1,profiles}));else localStorage.removeItem(profilesName);}catch{status('profile-status','Could not save to browser storage. Download a profile backup.');}}
 function renderProfiles(selected?:string){el('profile-select').replaceChildren();for(const p of profiles){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;el('profile-select').append(option);}if(selected)el<HTMLSelectElement>('profile-select').value=selected;persistProfiles();}
 const access=setupAccess(section,isActive=>{active=isActive;invalidate(isActive?'Plus is ready. Choose PDFs and check your settings.':'Plus access is unavailable. The free workspace remains available.');});
 const guard=()=>access.guard();
 el('plus-open').addEventListener('click',()=>{void access.open();if(loaded)return;loaded=true;
  try{const saved=localStorage.getItem(profilesName);if(saved){profiles=parseProfiles(saved);el<HTMLInputElement>('profiles-remember').checked=true;renderProfiles();}}catch{status('profile-status','Stored profiles could not be loaded. Clear them or import a backup.');}
 });
 el('profiles-remember').addEventListener('change',persistProfiles);
 async function profileAction(action:()=>void){try{await guard();profileVersion++;action();}catch(error){status('profile-status',error instanceof Error?error.message:'Profile action failed.');}}
 const selected=()=>{const id=el<HTMLSelectElement>('profile-select').value;const profile=profiles.find(p=>p.id===id);if(!profile)throw Error('Select a saved profile.');return profile;};
 for(const replace of [false,true])el(replace?'profile-replace':'profile-save').addEventListener('click',()=>void profileAction(()=>{const id=replace?selected().id:undefined;profiles=saveProfile(profiles,el<HTMLInputElement>('profile-name').value,bridge.getSettings(),id);renderProfiles(id??profiles.at(-1)!.id);status('profile-status','Saved settings profile. No PDF information was stored.');}));
 el('profile-apply').addEventListener('click',()=>void profileAction(()=>{bridge.applySettings(structuredClone(selected().settings));invalidate('Profile applied. Run the batch again and recheck your test print.');status('profile-status','Profile applied. Recheck a physical test print for this path.');}));
 el('profile-delete').addEventListener('click',()=>void profileAction(()=>{const id=selected().id;profiles=profiles.filter(p=>p.id!==id);renderProfiles();status('profile-status','Selected profile deleted.');}));
 function download(bytes:Uint8Array,name:string,type:string){const url=URL.createObjectURL(new Blob([bytes.slice().buffer],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);}
 el('profiles-export').addEventListener('click',()=>download(new TextEncoder().encode(JSON.stringify({schemaVersion:1,profiles},null,2)),'planner-print-profiles.json','application/json'));
 el('profiles-clear').addEventListener('click',()=>{profileVersion++;profiles=[];el<HTMLInputElement>('profiles-remember').checked=false;renderProfiles();status('profile-status','All profiles cleared from this page and browser storage.');});
 el<HTMLInputElement>('profiles-input').addEventListener('change',async event=>{const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;const mine=++profileVersion;try{await guard();if(file.size>100000)throw Error('Profile file is too large.');const next=parseProfiles(await file.text());if(mine!==profileVersion)return;profiles=next;renderProfiles();status('profile-status','Profile collection imported.');}catch(error){status('profile-status','Could not import profiles: '+(error instanceof Error?error.message:''));}finally{input.value='';}});
 function showQueue(){el('batch-queue').replaceChildren();for(const f of files){const li=document.createElement('li');li.textContent=f.name+' · queued';el('batch-queue').append(li);}update();}
 el<HTMLInputElement>('batch-input').addEventListener('change',event=>{invalidate('Queue changed. Ready to check files.');files=Array.from((event.target as HTMLInputElement).files??[]).map(file=>({file,name:file.name,size:file.size}));try{validateQueue(files);}catch(error){status('batch-status',(error as Error).message);files=[];}showQueue();});
 el('batch-clear').addEventListener('click',()=>{invalidate('Queue cleared. PDF files and results released.');files=[];el<HTMLInputElement>('batch-input').value='';showQueue();});
 el('batch-cancel').addEventListener('click',()=>invalidate('Cancelled. No batch download is available; you can run the queue again.'));
 document.addEventListener('ppp-settings-changed',()=>invalidate('Settings changed. Previous batch results are no longer current.'));
 el('batch-run').addEventListener('click',async()=>{
  invalidate('Checking license…');const mine=jobVersion;
  try{
   await guard();if(mine!==jobVersion)return;
   if(!checked('batch-confirm'))throw Error('Confirm the one-insert-per-page source format and file permissions first.');
   const settings=bridge.getSettings();controller=new AbortController();const signal=controller.signal;running=true;showQueue();status('batch-status','Processing files in order…');
   const result=await runBatch([...files],settings,processFile,signal,(i,record)=>{const row=el('batch-queue').children[i];if(row)row.textContent=record.name+' · '+record.status+(record.error?' · '+record.error:' · '+record.sheets+' sheets'+(record.warnings?.length?' · '+record.warnings.join(' '):''));});
   if(mine!==jobVersion)return;const ready=result.records.filter(r=>r.status==='ready').length;
   {status('batch-status','Packing PDFs and report…');const encode=(value:unknown)=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value,null,2));const packed=await pack([...result.files,{name:'batch-report.json',bytes:encode({schemaVersion:1,settings:result.settings,records:result.records,testPrinted:false})},{name:'PRINT-FIRST.txt',bytes:encode(`Print each document separately at 100% / Actual size on ${settings.paper}. ${settings.mode==='manual'?'Use its own fronts and backs; follow your tested feed order.':''} Do not skip added blanks. Print a test sheet first. Batch preparation does not verify a physical printer. Errors are listed in batch-report.json; those files were not exported.`)}],signal);if(mine!==jobVersion)return;archive=packed;}
   status('batch-status',`${ready} ready · ${result.records.length-ready} error. ${ready?'Review the per-file report before printing.':'No PDFs exported. The ZIP contains the error report; fix the errors and run again.'}`);
  }catch(error){if(mine===jobVersion)status('batch-status',error instanceof Error?error.message:'Batch failed.');}
  finally{if(mine===jobVersion){running=false;controller=null;update();}}
 });
 el('batch-download').addEventListener('click',async()=>{const mine=jobVersion;try{await guard();if(mine===jobVersion&&archive)download(archive,'planner-print-batch.zip','application/zip');}catch{/* guard updates the visible status */}});
 async function processFile(file:BatchInput,settings:PrintSettings,signal:AbortSignal):Promise<BatchOutput>{
  signal.throwIfAborted();const bytes=await file.file!.arrayBuffer();signal.throwIfAborted();
  return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./batch.worker.ts',import.meta.url),{type:'module'});
   const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort);};const abort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});
   worker.onerror=()=>{cleanup();reject(Error('PDF processing stopped. Try a smaller static PDF.'));};worker.onmessage=event=>{cleanup();event.data.error?reject(Error(event.data.error)):resolve(event.data);};worker.postMessage({bytes,settings},[bytes]);
  });
 }
 function pack(files:OutputFile[],signal:AbortSignal):Promise<Uint8Array>{
  signal.throwIfAborted();return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./zip.worker.ts',import.meta.url),{type:'module'});const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort);};const abort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});worker.onerror=()=>{cleanup();reject(Error('Could not package output. Try a smaller batch.'));};worker.onmessage=event=>{cleanup();event.data.error?reject(Error(event.data.error)):resolve(event.data.bytes);};worker.postMessage(files,files.map(f=>f.bytes.buffer as ArrayBuffer));});
 }
 window.addEventListener('pagehide',()=>{controller?.abort();archive=null;files=[];access.dispose();});update();
 if(access.hasReturn)el('plus-open').click();
}
