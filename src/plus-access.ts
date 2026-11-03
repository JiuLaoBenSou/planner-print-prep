type Access={token:string;mode:string};
type Pending={requestId:string;claimSecret:string;created:number;remember:boolean};
const accessKey='ppp-plus-access-v1',pendingKey='ppp-plus-checkout-v1';
export function setupAccess(section:HTMLElement,onChange:(active:boolean)=>void){
 const panel=section.querySelector<HTMLElement>('.plus-license')!;
 panel.innerHTML=`<h2>Planner Print Prep Plus · One payment, no subscription</h2><p>Batch your PDFs and reuse saved print settings. Plus opens here after payment is confirmed. Use your purchase email to restore access on another device.</p>
 <label class="check"><input id="access-remember" type="checkbox" checked> Keep Plus signed in on this device. Uncheck on shared computers.</label>
 <div class="actions"><button id="plus-buy" type="button" disabled>Checkout unavailable</button><button id="plus-signout" type="button" disabled>Sign out on this device</button><button id="plus-demo" type="button" hidden>Try Plus locally · no charge</button><button id="access-check" type="button" hidden>Check payment again</button><button id="access-retry" type="button" hidden>Retry opening checkout</button></div>
 <p id="plus-status" role="status">No registration form or password. Individual PDFs remain free.</p>
 <h3>Already have Plus?</h3><label>Purchase email<input id="access-email" disabled type="email" autocomplete="email" maxlength="254" placeholder="you@example.com"></label><div class="actions"><button id="access-request" disabled type="button">Send sign-in link</button></div><p id="access-mail-status" role="status">Use the email entered at checkout. Links work once and expire after 15 minutes.</p><p id="restore-demo" hidden>Local demo inbox — no email was sent: <a id="restore-demo-link">Open the demo sign-in link</a></p>`;
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>panel.querySelector<T>('#'+id)!;
 const say=(message:string)=>{el('plus-status').textContent=message;};
 const remember=()=>el<HTMLInputElement>('access-remember').checked;
 let current:Access|null=null,version=0,opened=false,enabled=false,pending:Pending|null=null,controller:AbortController|null=null;
 const hash=location.hash,restore=/^#restore=([a-f0-9]{64})$/.exec(hash)?.[1];
 const hasReturn=hash==='#plus'||hash.startsWith('#restore=');
 if(hash.startsWith('#restore='))history.replaceState(null,'',location.pathname+location.search+'#plus');
 function store(){try{if(current&&remember())localStorage.setItem(accessKey,JSON.stringify(current));else localStorage.removeItem(accessKey);}catch{say('Browser storage is unavailable. Use your purchase email to restore access next time.');}}
 function buttons(){el('plus-signout').toggleAttribute('disabled',!current);el('plus-buy').toggleAttribute('disabled',!enabled||!!current||!!pending);el('access-check').hidden=!pending;el('access-retry').hidden=!pending||!!current||!enabled;}
 async function api(path:string,body:unknown={},bearer?:string){
  const base=import.meta.env.VITE_BILLING_API_URL??import.meta.env.BASE_URL+'api/billing/';
  const target=path==='config'&&import.meta.env.PROD&&!import.meta.env.VITE_BILLING_API_URL?import.meta.env.BASE_URL+'billing-status.json':base+path;
  const response=await fetch(target,{method:path==='config'?'GET':'POST',headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},body:path==='config'?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({error:'Access service is unavailable. The free workspace is still available.'}));
  if(!response.ok)throw Error(data.error??'Plus access could not be confirmed.');return data;
 }
 function accept(data:Access&{active:boolean},mine:number){if(mine!==version)return;if(data.active!==true||!/^[a-f0-9]{64}$/.test(data.token)||!['mock','test','prod'].includes(data.mode))throw Error('Access could not be confirmed.');current={token:data.token,mode:data.mode};pending=null;try{sessionStorage.removeItem(pendingKey);}catch{}store();onChange(true);say(data.mode==='mock'?'Local simulation active · no payment was made.':data.mode==='test'?'Plus test access active · no live payment.':'Plus is ready on this device.');buttons();}
 function clear(message:string){version++;controller?.abort();controller=null;current=null;try{localStorage.removeItem(accessKey);sessionStorage.removeItem(pendingKey);}catch{/* local state is still cleared */}pending=null;onChange(false);say(message);buttons();}
 async function guard(){const mine=version,value=current;if(!value)throw Error('Restore your purchase to use Plus.');try{const result=await api('access/validate',{},value.token);if(mine!==version)throw Error('Access changed. Please retry.');if(result.active!==true||result.mode!==value.mode)throw Error('Plus access could not be confirmed.');return true;}catch(error){if(mine===version){onChange(false);say(error instanceof Error?error.message:'Plus access is unavailable.');}throw error;}}
 async function checkPayment(){
  if(!pending)return;controller?.abort();controller=new AbortController();const signal=controller.signal,mine=++version,claim=pending;
  say('Confirming your payment. Please do not pay again.');el('access-check').setAttribute('disabled','');
  try{for(let i=0;i<20;i++){
   if(signal.aborted||mine!==version)return;const result=await api('access/claim',{requestId:claim.requestId,claimSecret:claim.claimSecret});if(signal.aborted||mine!==version)return;
   if(result.pending){await new Promise<void>(resolve=>{const id=setTimeout(done,1000);function done(){clearTimeout(id);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});continue;}
   el<HTMLInputElement>('access-remember').checked=claim.remember;pending=null;try{sessionStorage.removeItem(pendingKey);}catch{}accept(result,mine);return;
  }say('Payment confirmation is still pending. Check again or restore by email. Please do not pay again.');
  }catch(error){if(mine===version)say(error instanceof Error?error.message:'Could not confirm payment. Restore by email or retry.');}
  finally{if(mine===version){el('access-check').removeAttribute('disabled');buttons();}}
 }
 el('plus-demo').addEventListener('click',async()=>{const mine=++version;controller?.abort();el('plus-demo').setAttribute('disabled','');try{const data=await api('access/demo',{});accept(data,mine);if(mine===version)el<HTMLInputElement>('access-email').value=data.demoEmail;}catch(error){if(mine===version)say((error as Error).message);}finally{if(mine===version)el('plus-demo').removeAttribute('disabled');}});
 el('plus-signout').addEventListener('click',()=>{const old=current;clear('Signed out on this device. Restore by email whenever you need Plus.');const mine=version;if(old)void api('access/logout',{},old.token).then(result=>{if(mine===version&&result.slotReleased===false)say('Signed out. Device release could not be confirmed; contact support if you reach an activation limit.');}).catch(()=>{if(mine===version)say('Signed out locally. Server sign-out could not be confirmed; remembered access expires after 30 days without use.');});});
 el('access-remember').addEventListener('change',store);
 async function checkout(){
  const mine=++version;controller?.abort();el('plus-buy').setAttribute('disabled','');el('access-retry').setAttribute('disabled','');
  try{pending??={requestId:crypto.randomUUID(),claimSecret:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),created:Date.now(),remember:remember()};sessionStorage.setItem(pendingKey,JSON.stringify(pending));
   const result=await api('checkout',{requestId:pending.requestId,claimSecret:pending.claimSecret});if(mine!==version)return;const url=new URL(result.url);if(url.protocol!=='https:'||!(url.hostname==='creem.io'||url.hostname.endsWith('.creem.io')))throw Error('Unexpected checkout address.');location.assign(url.href);
  }catch(error){if(mine===version){say((error as Error).message+' If checkout opened, do not pay twice; check payment, retry the same checkout or restore by email.');buttons();}}
  finally{if(mine===version)el('access-retry').removeAttribute('disabled');}
 }
 el('plus-buy').addEventListener('click',()=>void checkout());el('access-retry').addEventListener('click',()=>void checkout());
 el('access-check').addEventListener('click',()=>void checkPayment());
 el('access-request').addEventListener('click',async()=>{
  const input=el<HTMLInputElement>('access-email');if(!input.reportValidity()||!input.value.trim()){el('access-mail-status').textContent='Enter your purchase email address.';return;}
  el('access-request').setAttribute('disabled','');el('restore-demo').hidden=true;
  try{const result=await api('access/request',{email:input.value.trim()});el('access-mail-status').textContent=result.message;
   if(result.demoUrl){const url=new URL(result.demoUrl);if(url.origin===location.origin&&/^#restore=[a-f0-9]{64}$/.test(url.hash)){el<HTMLAnchorElement>('restore-demo-link').href=url.href;el('restore-demo').hidden=false;}}
  }catch(error){el('access-mail-status').textContent=(error as Error).message;}finally{el('access-request').removeAttribute('disabled');}
 });
 async function consume(value:string){
  const mine=++version;controller?.abort();onChange(false);say('Verifying your email link…');
  try{accept(await api('access/consume',{token:value}),mine);}
  catch(error){if(mine!==version)return;const message=(error as Error).message;
   if(current){try{await guard();if(mine===version){onChange(true);say(message+' Your saved Plus access is still active.');}}catch{if(mine===version)say(message);}}
   else{store();say(message);}buttons();
  }
 }
 function hashChanged(){const value=/^#restore=([a-f0-9]{64})$/.exec(location.hash)?.[1];if(!value)return;history.replaceState(null,'',location.pathname+location.search+'#plus');const details=section.querySelector('details')!;if(!details.open)section.querySelector<HTMLElement>('#plus-open')!.click();void consume(value);}
 window.addEventListener('hashchange',hashChanged);
 async function open(){
  if(opened)return;opened=true;
  try{localStorage.removeItem('ppp-plus-license-v1');const saved=localStorage.getItem(accessKey);if(saved){const data=JSON.parse(saved);if(/^[a-f0-9]{64}$/.test(data.token)&&['mock','test','prod'].includes(data.mode))current=data;}
   const savedPending=sessionStorage.getItem(pendingKey);if(savedPending){const data=JSON.parse(savedPending);if(typeof data.requestId==='string'&&/^[a-f0-9]{64}$/.test(data.claimSecret)&&typeof data.remember==='boolean'&&Date.now()-data.created<86400000&&data.created<=Date.now())pending=data;else sessionStorage.removeItem(pendingKey);}
  }catch{say('Saved access could not be loaded. Restore with your purchase email.');}
  void api('config').then(config=>{enabled=config.canPurchase&&config.mode!=='mock';el('access-email').toggleAttribute('disabled',!config.accessEnabled);el('access-request').toggleAttribute('disabled',!config.accessEnabled);if(!config.canPurchase&&!current&&!pending)say(config.accessEnabled?'Purchases are not open yet. Already have Plus? Restore access below.':'Plus checkout is not available yet. Individual PDFs remain free.');el('plus-demo').hidden=config.mode!=='mock';el('plus-buy').textContent=config.mode==='test'?'Test checkout · US$9':config.mode==='mock'?'Local demo · no checkout':enabled?'Buy Plus · US$9 once':'Checkout unavailable';buttons();}).catch(()=>say('Plus checkout is not available yet. You can still use the free workspace.'));
  if(restore)await consume(restore);
  else if(pending&&hasReturn)void checkPayment();
  else if(current){const mine=version;say('Checking saved Plus access…');try{await guard();if(mine===version){onChange(true);say(current.mode==='mock'?'Local simulation active · no payment was made.':current.mode==='test'?'Plus test access active · no live payment.':'Plus is ready on this device.');buttons();}}catch{/* guard updates status */}}
  buttons();
 }
 return {guard,open,hasReturn,dispose:()=>{version++;controller?.abort();current=null;window.removeEventListener('hashchange',hashChanged);}};
}
