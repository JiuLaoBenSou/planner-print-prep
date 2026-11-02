import {it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {BillingStore,createBilling} from '../server/billing';
const origin='http://127.0.0.1:4176',key='KEY-FOR-PAID-ORDER',proof='a'.repeat(64),requestId='12345678-1234-1234-1234-123456789abc';
function fixture(){
 let now=Date.now(),failures=0;const mail:{to:string;url:string}[]=[],store=new BillingStore(':memory:','test');
 const config={mode:'test' as const,origin,productId:'prod_plus',apiKey:'fake-key',webhookSecret:'fake-webhook',liveSales:false,accessSecret:'f'.repeat(64),sendRestoreMail:async(message:{to:string;url:string})=>{if(failures>0){failures--;throw Error('Simulated provider outage');}mail.push(message);},now:()=>now};
 const upstream=async(input:unknown,init?:RequestInit)=>{const path=String(input),body=init?.body?JSON.parse(String(init.body)):{};
  return Response.json(path.includes('/products/')?{id:'prod_plus',mode:'test',price:900,currency:'USD',billing_type:'onetime'}:path.endsWith('/checkouts')?{checkout_url:'https://www.creem.io/test/payment/test'}:{key,mode:'test',status:'active',instance:[{id:'instance_1',name:body.instance_name,status:'active'}]});};
 const billing=createBilling(config,store,upstream as typeof fetch);
 const post=async(path:string,body:unknown={},token?:string)=>billing(new Request('http://127.0.0.1:4178/api/billing/'+path,{method:'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));
 const event=async(refund=false)=>{const raw=JSON.stringify(refund?{id:'refund',eventType:'refund.created',object:{mode:'test',status:'succeeded',transaction:{order:'order_1'}}}:{id:'paid',eventType:'checkout.completed',object:{id:'checkout_1',request_id:requestId,mode:'test',status:'completed',customer:{email:'Buyer@Example.com'},product:{id:'prod_plus',price:900,currency:'USD',billing_type:'onetime'},order:{id:'order_1',status:'paid',currency:'USD',type:'onetime'},license_keys:[{key,product_id:'prod_plus'}]}});
  return billing(new Request('http://127.0.0.1:4178/api/billing/webhook',{method:'POST',headers:{'creem-signature':createHmac('sha256',config.webhookSecret).update(raw).digest('hex')},body:raw}));};
 return {post,event,mail,store,failDeliveries:(n:number)=>failures=n,flush:()=>billing.flushMail(),recreate:()=>createBilling(config,store,upstream as typeof fetch),advance:(ms:number)=>now+=ms};
}
it('auto-access requires both browser proof and verified payment; refund invalidates the session',async()=>{
 const f=fixture();expect((await f.post('checkout',{requestId,claimSecret:proof})).status).toBe(200);
 expect((await f.post('access/claim',{requestId,claimSecret:proof})).status).toBe(202);
 expect((await f.event()).status).toBe(200);
 expect((await f.post('access/claim',{requestId,claimSecret:'b'.repeat(64)})).status).toBe(403);
 const result=await f.post('access/claim',{requestId,claimSecret:proof});expect(result.status).toBe(200);const access=await result.json();
 expect(access.active).toBe(true);expect(access.token).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(access)).not.toContain(key);
 expect((await f.post('access/validate',{},access.token)).status).toBe(200);
 await f.event(true);expect((await f.post('access/validate',{},access.token)).status).toBe(401);f.store.close();
});
it('email recovery does not reveal purchases and requires a one-use, expiring email link',async()=>{
 const f=fixture();await f.event();
 const a=await f.post('access/request',{email:'buyer@example.com'}),b=await f.post('access/request',{email:'unknown@example.com'});
 expect(a.status).toBe(200);expect(await a.json()).toEqual(await b.json());expect(f.mail).toHaveLength(0);await f.flush();expect(f.mail).toHaveLength(1);expect(f.mail[0].to).toBe('buyer@example.com');
 const token=new URL(f.mail[0].url).hash.slice('#restore='.length);expect(token).toMatch(/^[a-f0-9]{64}$/);
 expect((await f.post('access/consume',{token:'0'.repeat(64)})).status).toBe(401);
 const access=await (await f.post('access/consume',{token})).json();expect(access.active).toBe(true);
 expect((await f.post('access/consume',{token})).status).toBe(401);
 await f.post('access/request',{email:'buyer@example.com'});await f.flush();const second=new URL(f.mail[1].url).hash.slice(9);f.advance(16*60000);
 expect((await f.post('access/consume',{token:second})).status).toBe(401);
 expect((await f.post('access/logout',{},access.token)).status).toBe(200);expect((await f.post('access/validate',{},access.token)).status).toBe(401);f.store.close();
});
it('recovery is rate limited and refund removes outstanding email links',async()=>{
 const f=fixture();await f.event();for(let i=0;i<3;i++)expect((await f.post('access/request',{email:'buyer@example.com'})).status).toBe(200);
 expect((await f.post('access/request',{email:'buyer@example.com'})).status).toBe(429);
 await f.flush();const token=new URL(f.mail[0].url).hash.slice(9);await f.event(true);expect((await f.post('access/consume',{token})).status).toBe(401);f.store.close();
});
it('expired browser sessions fail closed and a bare email or checkout redirect cannot unlock Plus',async()=>{
 const f=fixture();await f.post('checkout',{requestId,claimSecret:proof});await f.event();const access=await (await f.post('access/claim',{requestId,claimSecret:proof})).json();
 expect((await f.post('access/claim',{requestId})).status).toBe(400);expect((await f.post('access/validate',{email:'buyer@example.com'})).status).toBe(401);
 f.advance(31*86400000);expect((await f.post('access/validate',{},access.token)).status).toBe(401);f.store.close();
});
it('sessions and queued mail survive handler recreation without storing plaintext email, keys or tokens',async()=>{
 const f=fixture();await f.post('checkout',{requestId,claimSecret:proof});await f.event();const access=await (await f.post('access/claim',{requestId,claimSecret:proof})).json();
 await f.post('access/request',{email:'buyer@example.com'});
 const persisted=JSON.stringify(['access_orders','access_sessions','access_outbox','access_links'].map(table=>f.store.db.prepare('SELECT * FROM '+table).all()));
 for(const privateValue of ['buyer@example.com',key,access.token])expect(persisted).not.toContain(privateValue);
 const next=f.recreate();expect((await next(new Request('http://127.0.0.1:4178/api/billing/access/validate',{method:'POST',headers:{origin,authorization:'Bearer '+access.token},body:'{}'}))).status).toBe(200);
 await next.flushMail();expect(f.mail).toHaveLength(1);f.store.close();
});
it('refund deletes queued recovery mail before delivery',async()=>{
 const f=fixture();await f.event();await f.post('access/request',{email:'buyer@example.com'});await f.event(true);await f.flush();expect(f.mail).toHaveLength(0);f.store.close();
});
it('recovery mail retries temporary provider failures from the persistent queue',async()=>{
 const f=fixture();await f.event();f.failDeliveries(2);await f.post('access/request',{email:'buyer@example.com'});
 await f.flush();expect(f.mail).toHaveLength(0);f.advance(31000);await f.flush();expect(f.mail).toHaveLength(0);f.advance(31000);await f.recreate().flushMail();expect(f.mail).toHaveLength(1);
 expect(f.store.db.prepare('SELECT count(*) AS n FROM access_outbox').get()?.n).toBe(0);f.store.close();
});
