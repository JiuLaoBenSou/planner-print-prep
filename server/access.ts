import type {SyncDatabase} from './sql-store';
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export class AccessError extends Error{constructor(readonly status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new AccessError(status,message);};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const opaque=()=>randomBytes(32).toString('hex');
const token=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))return fail(400,'Invalid access request.');return v;};
const email=(v:unknown)=>{if(typeof v!=='string'||v.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v.trim()))return fail(400,'Enter your purchase email address.');return v.trim().toLowerCase();};
export type AccessConfig={mode:string;origin:string;accessSecret?:string;sendRestoreMail?:(message:{to:string;url:string})=>Promise<void>;now?:()=>number};
type Row=Record<string,any>;
export function createAccess(config:AccessConfig,db:SyncDatabase,paid:(key:string)=>boolean,grant:(key:string,order:string)=>void,api:(path:string,body?:unknown)=>Promise<Row|undefined>){
 const mock=config.mode==='mock',secret=mock?randomBytes(32):/^[a-f0-9]{64}$/i.test(config.accessSecret??'')?Buffer.from(config.accessSecret!,'hex'):null;
 const enabled=!!secret&&(mock||!!config.sendRestoreMail),mode=config.mode,now=config.now??Date.now;
 const hashEmail=(value:string)=>createHmac('sha256',secret!).update(mode+'\0'+value).digest('hex');
 const app=config.origin.replace(/\/$/,'')+'/';
 db.exec(`CREATE TABLE IF NOT EXISTS access_orders(mode TEXT,id TEXT,email TEXT,cipher TEXT,PRIMARY KEY(mode,id));
 CREATE TABLE IF NOT EXISTS access_claims(mode TEXT,id TEXT,proof TEXT,order_id TEXT,instance TEXT,state TEXT DEFAULT 'new',PRIMARY KEY(mode,id));
 CREATE TABLE IF NOT EXISTS access_links(mode TEXT,hash TEXT,order_id TEXT,expires INTEGER,PRIMARY KEY(mode,hash));
 CREATE TABLE IF NOT EXISTS access_sessions(mode TEXT,hash TEXT,order_id TEXT,instance TEXT,expires INTEGER,PRIMARY KEY(mode,hash));
 CREATE TABLE IF NOT EXISTS access_rates(mode TEXT,email TEXT,started INTEGER,count INTEGER,PRIMARY KEY(mode,email));`);
 db.exec('CREATE TABLE IF NOT EXISTS access_outbox(mode TEXT,hash TEXT,cipher TEXT,expires INTEGER,attempts INTEGER,send_after INTEGER,PRIMARY KEY(mode,hash));');
 function encrypt(key:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',secret!,iv);const bytes=Buffer.concat([c.update(key,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');}
 function decrypt(cipher:string){const b=Buffer.from(cipher,'base64'),d=createDecipheriv('aes-256-gcm',secret!,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');}
 function cleanup(){db.prepare('DELETE FROM access_links WHERE mode=? AND expires<=?').run(mode,now());db.prepare('DELETE FROM access_outbox WHERE mode=? AND expires<=?').run(mode,now());db.prepare('DELETE FROM access_sessions WHERE mode=? AND expires<=?').run(mode,now());db.prepare('DELETE FROM access_rates WHERE mode=? AND started<?').run(mode,now()-86400000);}
 function entitlement(order:string){const r=db.prepare('SELECT * FROM access_orders WHERE mode=? AND id=?').get(mode,order) as Row|undefined;if(!r)return fail(401,'Access has expired or was revoked. Restore your purchase to continue.');const key=decrypt(r.cipher);if(!paid(key))return fail(401,'This purchase is no longer active.');return {key,order};}
 async function native(key:string,instance?:string){
  if(mock)return instance??opaque();
  const name='web-'+opaque(),r=(await api('licenses/'+(instance?'validate':'activate'),{key,...(instance?{instance_id:instance}:{instance_name:name})}))!;
  const match=(Array.isArray(r.instance)?r.instance:[r.instance]).find((v:Row)=>v&&v.status==='active'&&(instance?v.id===instance:v.name===name));
  if(r.mode!==mode||r.key!==key||r.status!=='active'||!match||typeof match.id!=='string'||r.expires_at&&(!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=now()))fail(401,'Plus access could not be verified. Restore your purchase or contact support.');
  if(!paid(key))fail(401,'This purchase is no longer active.');return String(match.id);
 }
 function issue(order:string,instance:string){entitlement(order);const value=opaque();db.prepare('INSERT INTO access_sessions VALUES (?,?,?,?,?)').run(mode,digest(value),order,instance,now()+30*86400000);return {active:true,token:value,mode};}
 function getSession(request:Request){const match=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')??'');if(!match)fail(401,'Restore your purchase to use Plus.');const row=db.prepare('SELECT * FROM access_sessions WHERE mode=? AND hash=? AND expires>?').get(mode,digest(match![1]),now()) as Row|undefined;if(!row)fail(401,'This browser session has expired. Restore your purchase.');return row!;}
 function requireEnabled(){if(!enabled)fail(503,'Purchase access is not configured yet. The free workspace remains available.');}
 function startClaim(id:string,value:string){requireEnabled();token(value);const old=db.prepare('SELECT proof FROM access_claims WHERE mode=? AND id=?').get(mode,id);if(old&&old.proof!==digest(value))fail(403,'Checkout belongs to another browser request.');db.prepare('INSERT OR IGNORE INTO access_claims(mode,id,proof) VALUES (?,?,?)').run(mode,id,digest(value));}
 function recordPaid(order:string,key:string,buyer:unknown,requestId?:string){
  if(!enabled||!paid(key))return;
  const address=email(buyer);db.prepare('INSERT OR IGNORE INTO access_orders VALUES (?,?,?,?)').run(mode,order,hashEmail(address),encrypt(key));
  if(requestId){const old=db.prepare('SELECT order_id FROM access_claims WHERE mode=? AND id=?').get(mode,requestId);if(old?.order_id&&old.order_id!==order)fail(422,'Checkout order does not match.');db.prepare('UPDATE access_claims SET order_id=? WHERE mode=? AND id=?').run(order,mode,requestId);}
 }
 function revoke(order:string){db.prepare('DELETE FROM access_outbox WHERE mode=? AND hash IN (SELECT hash FROM access_links WHERE mode=? AND order_id=?)').run(mode,mode,order);for(const table of ['access_links','access_sessions'])db.prepare(`DELETE FROM ${table} WHERE mode=? AND order_id=?`).run(mode,order);db.prepare('DELETE FROM access_orders WHERE mode=? AND id=?').run(mode,order);}
 let sending=false;
 async function flushMail(){
  if(!enabled||mock||sending)return;sending=true;
  try{cleanup();for(let i=0;i<10;i++){
   const row=db.prepare('SELECT * FROM access_outbox WHERE mode=? AND send_after<=? AND expires>? ORDER BY rowid LIMIT 1').get(mode,now(),now()) as Row|undefined;if(!row)break;
   const claimed=db.prepare('UPDATE access_outbox SET send_after=?,attempts=attempts+1 WHERE mode=? AND hash=? AND send_after<=?').run(now()+20000,mode,row.hash,now());if(claimed.changes!==1)continue;
   try{await config.sendRestoreMail!(JSON.parse(decrypt(row.cipher)));db.prepare('DELETE FROM access_outbox WHERE mode=? AND hash=?').run(mode,row.hash);}
   catch{if(Number(row.attempts)>=2){db.prepare('DELETE FROM access_outbox WHERE mode=? AND hash=?').run(mode,row.hash);db.prepare('DELETE FROM access_links WHERE mode=? AND hash=?').run(mode,row.hash);}else db.prepare('UPDATE access_outbox SET send_after=? WHERE mode=? AND hash=?').run(now()+30000,mode,row.hash);}
  }}finally{sending=false;}
 }
 async function handle(path:string,body:Row,request:Request):Promise<{data:Row;status?:number}>{
  requireEnabled();cleanup();
  if(path==='access/claim'){
   const value=token(body.claimSecret);if(typeof body.requestId!=='string'||body.requestId.length>80)fail(400,'Invalid checkout request.');
   const row=db.prepare('SELECT * FROM access_claims WHERE mode=? AND id=?').get(mode,body.requestId) as Row|undefined;
   const actual=Buffer.from(row?String(row.proof):digest('unknown'),'hex'),expected=Buffer.from(digest(value),'hex');
   if(!row||!timingSafeEqual(actual,expected))fail(403,'Checkout belongs to another browser request.');
   if(!row!.order_id)return {data:{pending:true},status:202};
   const item=entitlement(row!.order_id);let instance=row!.instance as string;
   if(!instance){if(row!.state==='pending')fail(409,'Activation is awaiting confirmation. Use Restore purchase or contact support; do not pay again.');
    if(db.prepare("UPDATE access_claims SET state='pending' WHERE mode=? AND id=? AND state='new'").run(mode,body.requestId).changes!==1)fail(409,'Activation is already in progress.');
    instance=await native(item.key);entitlement(item.order);db.prepare("UPDATE access_claims SET instance=?,state='ready' WHERE mode=? AND id=?").run(instance,mode,body.requestId);
   }else await native(item.key,instance);
   return {data:issue(item.order,instance)};
  }
  if(path==='access/request'){
   const address=email(body.email),addressHash=hashEmail(address);let rate=db.prepare('SELECT * FROM access_rates WHERE mode=? AND email=?').get(mode,addressHash) as Row|undefined;
   if(!rate||Number(rate.started)<=now()-15*60000){db.prepare('INSERT INTO access_rates VALUES (?,?,?,1) ON CONFLICT(mode,email) DO UPDATE SET started=excluded.started,count=1').run(mode,addressHash,now());}else{if(Number(rate.count)>=3)fail(429,'Too many recovery requests. Please wait 15 minutes.');db.prepare('UPDATE access_rates SET count=count+1 WHERE mode=? AND email=?').run(mode,addressHash);}
   const result:Row={message:'If an active purchase matches this email, a sign-in link will arrive shortly. Check spam too.'};
   const rows=db.prepare('SELECT * FROM access_orders WHERE mode=? AND email=? ORDER BY rowid DESC').all(mode,addressHash) as Row[];
   const order=rows.find(row=>paid(decrypt(row.cipher)));if(!order)return {data:result};
   const value=opaque(),url=app+'#restore='+value;db.prepare('INSERT INTO access_links VALUES (?,?,?,?)').run(mode,digest(value),order.id,now()+15*60000);
   if(mock)result.demoUrl=url;
   else db.prepare('INSERT INTO access_outbox VALUES (?,?,?,?,0,?)').run(mode,digest(value),encrypt(JSON.stringify({to:address,url})),now()+15*60000,now());
   return {data:result};
  }
  if(path==='access/consume'){
   const value=token(body.token),row=db.prepare('DELETE FROM access_links WHERE mode=? AND hash=? RETURNING *').get(mode,digest(value)) as Row|undefined;
   if(!row||Number(row.expires)<=now())fail(401,'This email link has expired or was already used. Request a new link.');
   const item=entitlement(row!.order_id),instance=await native(item.key);return {data:issue(item.order,instance)};
  }
  if(path==='access/validate'){
   const row=getSession(request),item=entitlement(row.order_id);await native(item.key,row.instance);entitlement(item.order);
   db.prepare('UPDATE access_sessions SET expires=? WHERE mode=? AND hash=?').run(now()+30*86400000,mode,row.hash);return {data:{active:true,mode}};
  }
  if(path==='access/logout'){
   const row=getSession(request);db.prepare('DELETE FROM access_sessions WHERE mode=? AND hash=?').run(mode,row.hash);let released=true;
   if(!mock)try{const item=entitlement(row.order_id);const result=await api('licenses/deactivate',{key:item.key,instance_id:row.instance});released=result?.mode===mode;}catch{released=false;}
   return {data:{active:false,slotReleased:released}};
  }
  if(path==='access/demo'){
   if(!mock)fail(404,'Not found.');const buyer=email(body.email??'demo@example.test'),order='mock-order-'+opaque(),key='MOCK-'+opaque();grant(key,order);recordPaid(order,key,buyer);return {data:{...issue(order,opaque()),demoEmail:buyer}};
  }
  return fail(404,'Not found.');
 }
 return {enabled,startClaim,recordPaid,revoke,handle,flushMail};
}
