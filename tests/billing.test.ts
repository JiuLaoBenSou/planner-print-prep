import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {BillingStore,createBilling,verifySignature} from '../server/billing';
const origin='http://127.0.0.1:4176',secret='test-webhook-secret-not-a-real-credential';
const paid=(id='evt_1',mode='test',product='prod_plus')=>({id,eventType:'checkout.completed',object:{id:'ch_1',mode,status:'completed',product:{id:product,price:900,currency:'USD',billing_type:'onetime',mode},order:{id:'ord_1',status:'paid',type:'onetime',currency:'USD',transaction:'txn_1',mode},license_keys:[{key:'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY',product_id:product,mode}]}});
const refund=(id='refund_1')=>({id,eventType:'refund.created',object:{mode:'test',status:'succeeded',transaction:{id:'txn_1',order:'ord_1',mode:'test'}}});
const config={mode:'test' as const,origin,productId:'prod_plus',apiKey:'test-server-key',webhookSecret:secret,liveSales:false};
const send=(billing:ReturnType<typeof createBilling>,path:string,data:unknown,headers:Record<string,string>={})=>billing(new Request('http://127.0.0.1:4178/api/billing/'+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)}));
const webhook=async(billing:ReturnType<typeof createBilling>,event:unknown)=>{const body=JSON.stringify(event);return billing(new Request('http://127.0.0.1:4178/api/billing/webhook',{method:'POST',headers:{'creem-signature':createHmac('sha256',secret).update(body).digest('hex')},body}));};
it('verifies raw signed bytes and refuses a forged or reserialized webhook',()=>{
 const raw='{ "id": 1 }';const sig=createHmac('sha256',secret).update(raw).digest('hex');
 expect(verifySignature(raw,sig,secret)).toBe(true);expect(verifySignature(JSON.stringify(JSON.parse(raw)),sig,secret)).toBe(false);expect(verifySignature(raw,'xyz',secret)).toBe(false);
});
it('paid events are idempotent across new event IDs, and refunds cannot be undone by a late payment',async()=>{
 const store=new BillingStore(':memory:','test');const billing=createBilling(config,store,fetch);
 expect((await webhook(billing,paid())).status).toBe(200);expect((await webhook(billing,paid('manual_resend'))).status).toBe(200);
 expect(store.isPaid('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY')).toBe(true);expect(store.orderCount()).toBe(1);
 await webhook(billing,refund());await webhook(billing,paid('late'));
 expect(store.isPaid('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY')).toBe(false);store.close();
 const reverse=new BillingStore(':memory:','test'),other=createBilling(config,reverse,fetch);await webhook(other,refund());await webhook(other,paid());expect(reverse.isPaid('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY')).toBe(false);reverse.close();
});
it('rejects wrong environment/product, invalid signature and arbitrary uploads',async()=>{
 const store=new BillingStore(':memory:','test');const billing=createBilling(config,store,fetch);
 expect((await webhook(billing,paid('wrong','prod'))).status).toBe(422);
 expect((await webhook(billing,paid('wrong2','test','other_product'))).status).toBe(422);
 expect((await send(billing,'webhook',paid())).status).toBe(401);
 expect((await send(billing,'activate',{key:'x'.repeat(300000)})).status).toBe(413);
 expect(store.orderCount()).toBe(0);store.close();
});
it('requires confirmed payment and provider validation for a license, including after refund',async()=>{
 const store=new BillingStore(':memory:','test');let calls=0;
 const upstream=async()=>{calls++;return Response.json({key:'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY',mode:'test',status:'active',expires_at:null,instance:[{id:'inst_1',name:'browser-1',status:'active'}]});};
 const billing=createBilling(config,store,upstream as typeof fetch);
 expect((await send(billing,'activate',{key:'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY',instanceName:'browser-1'})).status).toBe(403);expect(calls).toBe(0);
 await webhook(billing,paid());expect((await send(billing,'activate',{key:'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY',instanceName:'browser-1'})).status).toBe(200);
 await webhook(billing,refund());expect((await send(billing,'validate',{key:'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY',instanceId:'inst_1'})).status).toBe(403);store.close();
});
it('checkout rejects cross-site requests and uses server product, price and success URL only',async()=>{
 const store=new BillingStore(':memory:','test');const calls:{url:string;data:unknown}[]=[];
 const upstream=async(input:unknown,init?:RequestInit)=>{const url=String(input);calls.push({url,data:init?.body?JSON.parse(String(init.body)):null});return Response.json(url.includes('/products/')?{id:'prod_plus',mode:'test',price:900,currency:'USD',billing_type:'onetime'}:{checkout_url:'https://www.creem.io/test/payment/ch_1'});};
 const billing=createBilling(config,store,upstream as typeof fetch);
 expect((await send(billing,'checkout',{requestId:crypto.randomUUID()},{origin:'https://evil.example'})).status).toBe(403);
 const requestId=crypto.randomUUID();expect((await send(billing,'checkout',{requestId})).status).toBe(200);expect((await send(billing,'checkout',{requestId})).status).toBe(200);
 expect(calls.length).toBe(2);expect(calls[1].data).toEqual({product_id:'prod_plus',request_id:requestId,success_url:origin+'/#plus'});
 expect((await send(billing,'checkout',{requestId:crypto.randomUUID(),price:1})).status).toBe(400);store.close();
});
it('production checkout is disabled by default and simulated grants are loopback-only',async()=>{
 const store=new BillingStore(':memory:','prod'),live=createBilling({...config,mode:'prod',origin:'https://planner.example/'},store,fetch);
 expect((await send(live,'checkout',{requestId:crypto.randomUUID()},{origin:'https://planner.example'})).status).toBe(503);expect((await send(live,'demo',{},{origin:'https://planner.example'})).status).toBe(404);store.close();
 expect(()=>createBilling({...config,mode:'mock',origin:'https://public.example'},new BillingStore(':memory:','mock'),fetch)).toThrow(/loopback/);
});
it.each(['inactive','expired','wrong-mode','wrong-instance','offline'])('fails closed when upstream license is %s',async scenario=>{
 const store=new BillingStore(':memory:','test');
 const upstream=async()=>{if(scenario==='offline')throw Error('network failure with private upstream context');return Response.json({key:'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY',mode:scenario==='wrong-mode'?'prod':'test',status:scenario==='inactive'?'inactive':'active',expires_at:scenario==='expired'?'2020-01-01T00:00:00Z':null,instance:[{id:'inst_1',name:scenario==='wrong-instance'?'another-browser':'browser-1',status:'active'}]});};
 const billing=createBilling(config,store,upstream as typeof fetch);await webhook(billing,paid());const response=await send(billing,'activate',{key:'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY',instanceName:'browser-1'});
 expect(response.ok).toBe(false);expect(await response.text()).not.toContain('private upstream context');store.close();
});
it('disputes revoke access and only the configured origin receives a CORS preflight',async()=>{
 const store=new BillingStore(':memory:','test'),billing=createBilling(config,store,fetch);await webhook(billing,paid());
 await webhook(billing,{id:'dispute_1',eventType:'dispute.created',object:{mode:'test',transaction:{order:'ord_1',mode:'test'}}});expect(store.isPaid('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY')).toBe(false);
 const good=await billing(new Request('http://127.0.0.1:4178/api/billing/activate',{method:'OPTIONS',headers:{origin}}));expect(good.status).toBe(204);expect(good.headers.get('access-control-allow-origin')).toBe(origin);
 const bad=await billing(new Request('http://127.0.0.1:4178/api/billing/activate',{method:'OPTIONS',headers:{origin:'https://other.example'}}));expect(bad.status).toBe(403);store.close();
});
it('payment, checkout and sticky revocation survive SQLite reopen, with environments isolated',()=>{
 const directory=mkdtempSync(join(tmpdir(),'ppp-billing-')),path=join(directory,'state.sqlite');
 try{
  let store=new BillingStore(path,'test');store.apply('paid_1','order_1',false,['key_1']);store.claimCheckout('request_1');store.finishCheckout('request_1','{"url":"https://www.creem.io/test"}');store.close();
  store=new BillingStore(path,'test');expect(store.isPaid('key_1')).toBe(true);expect(store.checkout('request_1')?.response).toContain('creem.io');store.apply('refund_1','order_1',true);store.close();
  store=new BillingStore(path,'test');store.apply('late_paid','order_1',false,['key_1']);expect(store.isPaid('key_1')).toBe(false);expect(store.orderCount()).toBe(1);store.close();
  const production=new BillingStore(path,'prod');expect(production.isPaid('key_1')).toBe(false);expect(production.checkout('request_1')).toBeUndefined();production.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
