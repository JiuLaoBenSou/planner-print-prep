import {createServer} from 'node:http';
import {mkdirSync} from 'node:fs';
import {BillingStore,createBilling,type Mode} from './billing';
import {restoreMailer} from './mail';
const mode=(process.env.CREEM_MODE??'test') as Mode;if(!['test','prod','mock'].includes(mode))throw Error('Invalid CREEM_MODE.');
mkdirSync('output/plus',{recursive:true});
const store=new BillingStore(`output/plus/billing-${mode}.sqlite`,mode);
const billing=createBilling({mode,origin:process.env.APP_URL??'http://127.0.0.1:4176/',productId:process.env.CREEM_PRODUCT_ID??'',apiKey:process.env.CREEM_API_KEY??'',webhookSecret:process.env.CREEM_WEBHOOK_SECRET??'',liveSales:process.env.CREEM_LIVE_SALES_ENABLED==='YES',accessSecret:process.env.ACCESS_ENCRYPTION_KEY,sendRestoreMail:restoreMailer(process.env.RESEND_API_KEY,process.env.MAIL_FROM)},store);
const limits=new Map<string,{time:number;count:number}>();
const server=createServer(async(req,res)=>{
 res.setHeader('cache-control','no-store');
 if(!['127.0.0.1:4178','localhost:4178'].includes(req.headers.host??'')){res.writeHead(403).end();return;}
 const ip=req.socket.remoteAddress??'';let rate=limits.get(ip);if(!rate||Date.now()-rate.time>60000){rate={time:Date.now(),count:0};limits.set(ip,rate);}if(++rate.count>120){res.writeHead(429).end('Please retry later.');return;}
 try{
  const parts:Buffer[]=[];let size=0;for await(const part of req){size+=part.length;if(size>256000){res.writeHead(413).end();return;}parts.push(part);}
  const request=new Request('http://127.0.0.1:4178'+req.url,{method:req.method,headers:req.headers as Record<string,string>,body:['GET','HEAD'].includes(req.method??'GET')?undefined:Buffer.concat(parts)});
  const result=await billing(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
 }catch{res.writeHead(500).end('Billing request failed.');}
});
server.listen(4178,'127.0.0.1',()=>console.log(`Local billing on 127.0.0.1:4178 (${mode}${mode==='mock'?' — SIMULATED, NO PAYMENTS':''})`));
let mailJob:Promise<void>=Promise.resolve(),mailing=false;const mailTimer=setInterval(()=>{if(mailing)return;mailing=true;mailJob=billing.flushMail().catch(()=>{}).finally(()=>{mailing=false;});},2000);mailTimer.unref();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{clearInterval(mailTimer);server.close(()=>void mailJob.finally(()=>{store.close();process.exit(0);}));});
