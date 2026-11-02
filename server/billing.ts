import {DatabaseSync} from 'node:sqlite';
import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {createAccess,AccessError,type AccessConfig} from './access';
export type Mode='test'|'prod'|'mock';
export type BillingConfig={mode:Mode;origin:string;productId:string;apiKey:string;webhookSecret:string;liveSales:boolean}&Pick<AccessConfig,'accessSecret'|'sendRestoreMail'|'now'>;
const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
class HttpError extends Error{constructor(readonly status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new HttpError(status,message);};
export function verifySignature(raw:string,signature:string,secret:string){
 if(!secret||!/^[a-f0-9]{64}$/i.test(signature))return false;
 return timingSafeEqual(Buffer.from(signature,'hex'),createHmac('sha256',secret).update(raw).digest());
}
export class BillingStore{
 readonly db:DatabaseSync;
 constructor(path:string,readonly mode:Mode){
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  this.db.exec(`CREATE TABLE IF NOT EXISTS orders(mode TEXT,id TEXT,state TEXT NOT NULL,PRIMARY KEY(mode,id));
   CREATE TABLE IF NOT EXISTS licenses(mode TEXT,hash TEXT,order_id TEXT NOT NULL,PRIMARY KEY(mode,hash));
   CREATE TABLE IF NOT EXISTS events(mode TEXT,id TEXT,PRIMARY KEY(mode,id));
   CREATE TABLE IF NOT EXISTS checkouts(mode TEXT,id TEXT,response TEXT,PRIMARY KEY(mode,id));`);
 }
 apply(id:string,orderId:string,revoked:boolean,keys:string[]=[]){
  this.db.exec('BEGIN IMMEDIATE');try{
   if(this.db.prepare('SELECT 1 FROM events WHERE mode=? AND id=?').get(this.mode,id)){this.db.exec('COMMIT');return;}
   this.db.prepare(`INSERT INTO orders VALUES (?,?,?) ON CONFLICT(mode,id) DO UPDATE SET state=CASE WHEN orders.state='revoked' OR excluded.state='revoked' THEN 'revoked' ELSE 'paid' END`).run(this.mode,orderId,revoked?'revoked':'paid');
   for(const key of keys){const existing=this.db.prepare('SELECT order_id FROM licenses WHERE mode=? AND hash=?').get(this.mode,hash(key));if(existing&&existing.order_id!==orderId)throw Error('License belongs to another order.');this.db.prepare('INSERT OR IGNORE INTO licenses VALUES (?,?,?)').run(this.mode,hash(key),orderId);}
   this.db.prepare('INSERT INTO events VALUES (?,?)').run(this.mode,id);this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 isPaid(key:string){return !!this.db.prepare("SELECT 1 FROM licenses l JOIN orders o ON o.mode=l.mode AND o.id=l.order_id WHERE l.mode=? AND l.hash=? AND o.state='paid'").get(this.mode,hash(key));}
 orderCount(){return Number(this.db.prepare('SELECT count(*) AS n FROM orders WHERE mode=?').get(this.mode)!.n);}
 checkout(id:string){return this.db.prepare('SELECT response FROM checkouts WHERE mode=? AND id=?').get(this.mode,id);}
 claimCheckout(id:string){return this.db.prepare('INSERT OR IGNORE INTO checkouts VALUES (?,?,NULL)').run(this.mode,id).changes===1;}
 finishCheckout(id:string,response:string){this.db.prepare('UPDATE checkouts SET response=? WHERE mode=? AND id=?').run(response,this.mode,id);}
 close(){this.db.close();}
}
const record=(value:unknown):Record<string,any>=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail(400,'Expected an object.');return value as Record<string,any>;};
const text=(value:unknown,max=256)=>{if(typeof value!=='string'||!value.trim()||value.length>max)return fail(400,'Invalid request field.');return value.trim();};
export function createBilling(config:BillingConfig,store:BillingStore,upstream:typeof fetch=fetch){
 if(store.mode!==config.mode)throw Error('Store environment mismatch.');
 const origin=new URL(config.origin);if(origin.pathname!=='/'&& !origin.pathname.endsWith('/'))throw Error('APP_URL must end in /.');
 const app=config.origin.replace(/\/$/,'')+'/';
 const loopback=['127.0.0.1','localhost','[::1]'].includes(origin.hostname);
 if(config.mode==='mock'&&!loopback)throw Error('Mock billing is restricted to loopback origins.');
 if(config.mode==='prod'&&origin.protocol!=='https:')throw Error('Production requires HTTPS.');
 const base=config.mode==='prod'?'https://api.creem.io':'https://test-api.creem.io';
 const configured=!!config.apiKey&&!!config.productId&&!!config.webhookSecret;
 const canPurchase=config.mode==='mock'||configured&&(config.mode!=='prod'||config.liveSales);
 const demoInstances=new Map<string,string>();
 const cors={'access-control-allow-origin':origin.origin,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type, authorization','vary':'Origin'};
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{...cors,'cache-control':'no-store','x-content-type-options':'nosniff'}});
 async function api(path:string,body?:unknown){
  if(!configured)fail(503,'Billing is not configured. The free tool is still available.');
  let response:Response;try{response=await upstream(base+'/v1/'+path,{method:body?'POST':'GET',headers:{'x-api-key':config.apiKey,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});}catch{fail(502,'Payment service could not be reached. Please retry later.');}
  if(!response!.ok)fail(response!.status===400||response!.status===403||response!.status===404||response!.status===410?403:502,'License or payment could not be confirmed. Check your key, activation slots or retry later.');
  try{return record(await response!.json());}catch{fail(502,'Payment service returned an unexpected response.');}
 }
 const access=createAccess(config,store.db,key=>store.isPaid(key),(key,order)=>store.apply('demo-'+randomUUID(),order,false,[key]),api);
 function scoped(value:Record<string,any>){if(value.mode!==config.mode)fail(422,'Payment environment does not match.');}
 async function event(raw:string,signature:string){
  if(!verifySignature(raw,signature,config.webhookSecret))fail(401,'Invalid webhook signature.');
  let e:Record<string,any>;try{e=record(JSON.parse(raw));}catch{fail(400,'Invalid webhook JSON.');}
  const id=text(e!.id),object=record(e!.object);scoped(object);
  if(e!.eventType==='checkout.completed'){
   const product=record(object.product),order=record(object.order);
   if(product.id!==config.productId||order.product&&order.product!==config.productId||product.price!==900||product.currency!=='USD'||product.billing_type!=='onetime'||order.currency!=='USD'||order.type!=='onetime'||order.status!=='paid'||object.status!=='completed')fail(422,'Unexpected product, price or payment status.');
   for(const part of [product,order])if(part.mode!==undefined)scoped(part);
   const licenses=object.license_keys;if(!Array.isArray(licenses)||!licenses.length)fail(422,'The product must issue license keys.');
   const keys=licenses.map((value:unknown)=>{const license=record(value);if(license.product_id!==config.productId)fail(422,'Wrong license product.');if(license.mode!==undefined)scoped(license);return text(license.key);});
   store.apply(id,text(order.id),false,keys);
   if(access.enabled)access.recordPaid(order.id,keys[0],object.customer?.email,object.request_id);
  }else if(e!.eventType==='refund.created'||e!.eventType==='dispute.created'){
   if(e!.eventType==='refund.created'&&object.status!=='succeeded')return;
   const transaction=record(object.transaction);if(transaction.mode!==undefined)scoped(transaction);
   store.apply(id,text(transaction.order),true);
   access.revoke(transaction.order);
  }
 }
 const handler=async(request:Request):Promise<Response>=>{
  try{
   const url=new URL(request.url),path=url.pathname.split('/billing/')[1];
   if(request.method==='OPTIONS')return request.headers.get('origin')===origin.origin?new Response(null,{status:204,headers:cors}):json({error:'Request origin is not allowed.'},403);
   if(path==='config'&&request.method==='GET')return json({mode:config.mode,canPurchase:canPurchase&&access.enabled,price:900,currency:'USD',configured:configured||config.mode==='mock',accessEnabled:access.enabled});
   if(request.method!=='POST')return json({error:'Not found.'},404);
   const limit=path==='webhook'?256000:8192;
   if(Number(request.headers.get('content-length'))>limit)fail(413,'Request is too large.');
   const raw=await request.text();if(Buffer.byteLength(raw)>limit)fail(413,'Request is too large.');
   if(path==='webhook'){await event(raw,request.headers.get('creem-signature')??'');return json({received:true});}
   if(request.headers.get('origin')!==origin.origin)fail(403,'Request origin is not allowed.');
   let body:Record<string,any>;try{body=record(JSON.parse(raw));}catch{fail(400,'Expected JSON.');}
   if(path?.startsWith('access/')){const result=await access.handle(path,body!,request);return json(result.data,result.status??200);}
   if(path==='demo'){
    if(config.mode!=='mock'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return json({error:'Not found.'},404);
    const key='MOCK-'+randomUUID();store.apply('mock-'+randomUUID(),'mock-order-'+randomUUID(),false,[key]);return json({key,simulated:true});
   }
   if(path==='checkout'){
    if(!canPurchase)fail(503,'Checkout is not enabled. No payment has been taken.');
    if(Object.keys(body!).some(k=>!['requestId','claimSecret'].includes(k))||!/^[a-f0-9-]{36}$/.test(body!.requestId))fail(400,'Expected a checkout request ID.');
    if(body!.claimSecret!==undefined)access.startClaim(body!.requestId,body!.claimSecret);
    const id=body!.requestId;const old=store.checkout(id);if(old){if(!old.response)fail(409,'Checkout creation is pending or unconfirmed. Do not pay twice.');return json(JSON.parse(String(old.response)));}
    if(config.mode==='mock')fail(400,'Use the local simulation button.');
    const product=(await api('products/'+encodeURIComponent(config.productId)))!;scoped(product);
    if(product.id!==config.productId||product.price!==900||product.currency!=='USD'||product.billing_type!=='onetime')fail(422,'Configure the US$9 one-time Plus product first.');
    if(!store.claimCheckout(id))fail(409,'Checkout creation is already in progress.');
    const checkout=(await api('checkouts',{product_id:config.productId,request_id:id,success_url:app+'#plus'}))!;
    const target=new URL(text(checkout.checkout_url,2048));if(target.protocol!=='https:'||!(target.hostname==='creem.io'||target.hostname.endsWith('.creem.io')))fail(502,'Unexpected checkout address.');
    const result={url:target.href,mode:config.mode};store.finishCheckout(id,JSON.stringify(result));return json(result);
   }
   if(['activate','validate','deactivate'].includes(path)){
    const key=text(body!.key);if(!store.isPaid(key))fail(403,'Payment confirmation is pending, or this license has been refunded or revoked.');
    const name=path==='activate'?text(body!.instanceName,100):'';const instanceId=path==='activate'?'':text(body!.instanceId,100);
    if(config.mode==='mock'){
     if(path==='activate'){const id=randomUUID();demoInstances.set(id,hash(key));return json({active:true,instanceId:id,mode:'mock'});}
     if(demoInstances.get(instanceId)!==hash(key))fail(403,'This simulated license instance is inactive.');
     if(path==='deactivate')demoInstances.delete(instanceId);
     return json({active:path!=='deactivate',instanceId,mode:'mock'});
    }
    const response=(await api('licenses/'+path,{key,...(path==='activate'?{instance_name:name}:{instance_id:instanceId})}))!;scoped(response);
    if(path==='deactivate')return json({active:false,mode:config.mode});
    const instances=Array.isArray(response.instance)?response.instance:[response.instance];
    const instance=instances.find((v:any)=>v&&v.status==='active'&&(path==='activate'?v.name===name:v.id===instanceId));
    if(!store.isPaid(key)||response.key!==key||response.status!=='active'||!instance||response.expires_at&&(!Number.isFinite(Date.parse(response.expires_at))||Date.parse(response.expires_at)<=Date.now()))fail(403,'This license is inactive, expired or revoked.');
    return json({active:true,instanceId:instance.id,mode:config.mode});
   }
   return json({error:'Not found.'},404);
  }catch(error){const known=error instanceof HttpError||error instanceof AccessError;return json({error:known?error.message:'Billing request failed. Please retry or contact support.'},known?error.status:500);}
 };
 return Object.assign(handler,{flushMail:access.flushMail});
}
