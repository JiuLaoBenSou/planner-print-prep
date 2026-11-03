import {DurableObject} from 'cloudflare:workers';
import {createHmac} from 'node:crypto';
import {createBilling,type Mode} from '../server/billing-core';
import {SqlBillingStore,type SyncDatabase,type SqlValue} from '../server/sql-store';
import {restoreMailer} from '../server/mail';

type RuntimeEnv=Cloudflare.Env;
const paths=new Set(['config','checkout','webhook','access/request','access/consume','access/claim','access/validate','access/logout']);
const reply=(status:number,message:string)=>Response.json({error:message},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});

export class ProductBilling extends DurableObject<RuntimeEnv>{
 private readonly store:SqlBillingStore;
 private readonly billing:ReturnType<typeof createBilling>;
 constructor(ctx:DurableObjectState,env:RuntimeEnv){
  super(ctx,env);
  const db:SyncDatabase={
   exec:(sql)=>{for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))ctx.storage.sql.exec(statement);},
   prepare:(sql)=>({run:(...values:SqlValue[])=>{const cursor=ctx.storage.sql.exec(sql,...values);cursor.toArray();return {changes:Number(ctx.storage.sql.exec<{n:number}>("SELECT changes() AS n").one().n)};},get:(...values:SqlValue[])=>ctx.storage.sql.exec(sql,...values).toArray()[0],all:(...values:SqlValue[])=>ctx.storage.sql.exec(sql,...values).toArray()}),close:()=>{}
  };
  this.store=new SqlBillingStore(db,env.CREEM_MODE as Mode,work=>ctx.storage.transactionSync(work));
  db.exec('CREATE TABLE IF NOT EXISTS request_rates(hash TEXT PRIMARY KEY,started INTEGER NOT NULL,count INTEGER NOT NULL)');
  this.billing=createBilling({mode:env.CREEM_MODE as Mode,origin:env.APP_URL,productId:env.CREEM_PRODUCT_ID,apiKey:env.CREEM_API_KEY??'',webhookSecret:env.CREEM_WEBHOOK_SECRET??'',liveSales:env.CREEM_LIVE_SALES_ENABLED==='YES',accessSecret:env.ACCESS_ENCRYPTION_KEY,sendRestoreMail:restoreMailer(env.RESEND_API_KEY,env.MAIL_FROM)},this.store);
 }
 async handle(request:Request):Promise<Response>{
  const now=Date.now(),ip=request.headers.get('cf-connecting-ip')??'unknown';
  const bucket=createHmac('sha256',this.env.ACCESS_ENCRYPTION_KEY||'unconfigured-rate-key').update(ip).digest('hex');
  const limited=this.ctx.storage.transactionSync(()=>{
   this.store.db.prepare('DELETE FROM request_rates WHERE started<?').run(now-60000);
   this.store.db.prepare('INSERT INTO request_rates VALUES (?,?,1) ON CONFLICT(hash) DO UPDATE SET count=count+1').run(bucket,now);
   return Number(this.store.db.prepare('SELECT count FROM request_rates WHERE hash=?').get(bucket)?.count)>120;
  });
  if(limited)return reply(429,'Too many requests. Please retry shortly.');
  // Persist a wake-up before a request can enqueue mail, so eviction cannot strand it.
  if(new URL(request.url).pathname==='/api/billing/access/request'&&request.method==='POST'){
   const current=await this.ctx.storage.getAlarm();if(current===null||current>now+1000)await this.ctx.storage.setAlarm(now+1000);
  }
  return this.billing(request);
 }
 async alarm(){
  try{await this.billing.flushMail();}
  finally{
   const row=this.store.db.prepare('SELECT min(send_after) AS next FROM access_outbox WHERE mode=?').get(this.env.CREEM_MODE);
   if(row?.next!==null&&row?.next!==undefined)await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,Number(row.next)));
  }
 }
}

export default {
 async fetch(request:Request,env:RuntimeEnv,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url),path=url.pathname.startsWith('/api/billing/')?url.pathname.slice(13):'';
  if(!['test','prod'].includes(env.CREEM_MODE)||!/^prod_[a-zA-Z0-9]+$/.test(env.CREEM_PRODUCT_ID)||new URL(env.APP_URL).protocol!=='https:')return reply(503,'Billing is not configured.');
  if(!paths.has(path)||url.search)return reply(404,'Not found.');
  if(path!=='webhook'&&request.method!=='GET'&&request.headers.get('origin')!==new URL(env.APP_URL).origin)return reply(403,'Request origin is not allowed.');
  const limit=path==='webhook'?256000:8192;
  if(request.method==='POST'){
   const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let length=0;
   if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();return reply(413,'Request is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   request=new Request(request,{body:bytes});
  }else if(!['GET','OPTIONS'].includes(request.method))return reply(405,'Method not allowed.');
  // One coordination/database unit per product and environment, rather than a service-wide singleton.
  const stub=ctx.exports.ProductBilling.getByName(env.CREEM_MODE+':'+env.CREEM_PRODUCT_ID);
  try{return await stub.handle(request);}catch{return reply(503,'Payment access is temporarily unavailable. Please retry later.');}
 }
} satisfies ExportedHandler<RuntimeEnv>;
