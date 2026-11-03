import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import workerd from 'workerd';
import {createHmac} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.env.MINIFLARE_WORKERD_PATH=workerd.default??workerd;
const root=resolve('output/payment-cloud-20261103');await mkdir(root,{recursive:true});const storage=await mkdtemp(root+'/runtime-');
const app='https://plannerprintprep.com',id='prod_runtimefixture',secret='fixture-signature-not-real',key='fixture-license-not-real';let emails=[],native=0;const facts=[];
const upstream=async request=>{
 const url=new URL(request.url);if(url.hostname==='api.resend.com'){emails.push(await request.json());return Response.json({id:'fixture-mail'});}
 if(url.hostname!=='test-api.creem.io')throw Error('Unexpected outbound host');
 const body=request.method==='POST'?await request.json():{};
 if(url.pathname.startsWith('/v1/products/'))return Response.json({id,mode:'test',name:'Planner Print Prep Plus',price:900,currency:'USD',billing_type:'onetime'});
 if(url.pathname==='/v1/checkouts')return Response.json({checkout_url:'https://www.creem.io/checkout/fixture',mode:'test'});
 if(url.pathname.startsWith('/v1/licenses/')){native++;return Response.json({mode:'test',key:body.key,status:'active',instance:{id:body.instance_id??'instance-fixture',name:body.instance_name,status:'active'}});}
 throw Error('Unexpected upstream route');
};
const bindings={CREEM_MODE:'test',APP_URL:app+'/',CREEM_PRODUCT_ID:id,CREEM_LIVE_SALES_ENABLED:'NO',CREEM_API_KEY:'fixture-key',CREEM_WEBHOOK_SECRET:secret,ACCESS_ENCRYPTION_KEY:'4'.repeat(64),RESEND_API_KEY:'fixture-resend',MAIL_FROM:'Planner Print Prep <access@mail.plannerprintprep.com>'};
const make=(overrides={})=>new Miniflare({modules:true,scriptPath:resolve('payments/.cloudflare/output/v0/workers/default/bundle/index.js'),compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],bindings:{...bindings,...overrides},durableObjects:{BILLING:{className:'ProductBilling',useSQLite:true}},durableObjectsPersist:storage+'/do',cachePersist:storage+'/cache',outboundService:upstream,cf:false,logRequests:false});
let mf=make();const call=(path,body={},extra={})=>mf.dispatchFetch('https://payments.example/api/billing/'+path,{method:'POST',headers:{origin:app,'content-type':'application/json',...extra},body:JSON.stringify(body)});
const event=(eventType='checkout.completed',eventId='evt-paid')=>({id:eventId,eventType,object:eventType==='checkout.completed'?{mode:'test',status:'completed',request_id:'11111111-1111-4111-a111-111111111111',customer:{email:'buyer@example.test'},product:{id,price:900,currency:'USD',billing_type:'onetime'},order:{id:'order-fixture',product:id,status:'paid',type:'onetime',currency:'USD'},license_keys:[{key,product_id:id,mode:'test'}]}:{mode:'test',status:'succeeded',transaction:{id:'tx-fixture',order:'order-fixture'}}});
const webhook=async e=>{const body=JSON.stringify(e);return mf.dispatchFetch('https://payments.example/api/billing/webhook',{method:'POST',headers:{'creem-signature':createHmac('sha256',secret).update(body).digest('hex')},body});};
try{
 const config=await (await mf.dispatchFetch('https://payments.example/api/billing/config')).json();assert.equal(config.canPurchase,true);facts.push('runtime configured with isolated fixture services');
 assert.equal((await call('checkout',{}, {origin:'https://foreign.example'})).status,403);
 assert.equal((await call('webhook',{}, {'creem-signature':'0'.repeat(64)})).status,401);facts.push('foreign origin and forged notification blocked');
 assert.equal((await mf.dispatchFetch('https://payments.example/api/billing/access/request',{method:'POST',headers:{origin:app},body:'x'.repeat(8193)})).status,413);facts.push('streamed request size enforced');
 const requestId='11111111-1111-4111-a111-111111111111',claimSecret='a'.repeat(64);
 assert.equal((await call('checkout',{requestId,claimSecret})).status,200);
 assert.equal((await call('access/claim',{requestId,claimSecret})).status,202);
 const wrong=event();wrong.object.mode='prod';assert.equal((await webhook(wrong)).status,422);facts.push('test and production notifications are isolated');
 assert.equal((await webhook(event())).status,200);assert.equal((await webhook(event())).status,200);
 const accessResponse=await call('access/claim',{requestId,claimSecret});assert.equal(accessResponse.status,200);const access=await accessResponse.json();assert.match(access.token,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(access).includes(key));facts.push('signed idempotent payment and browser proof issue opaque access');
 assert.equal((await call('access/claim',{requestId,claimSecret:'b'.repeat(64)})).status,403);
 await mf.dispose();mf=make();assert.equal((await call('access/validate',{}, {authorization:'Bearer '+access.token})).status,200);facts.push('session and payment survive complete runtime restart');
 const known=await (await call('access/request',{email:'buyer@example.test'})).json();const unknown=await (await call('access/request',{email:'unknown@example.test'})).json();assert.deepEqual(known,unknown);assert.equal(emails.length,0);await mf.dispose();mf=make();
 for(let i=0;i<40&&emails.length===0;i++)await new Promise(r=>setTimeout(r,100));assert.equal(emails.length,1);const restore=/https:\/\/plannerprintprep.com\/#restore=([a-f0-9]{64})/.exec(emails[0].text)?.[1];assert.ok(restore);facts.push('alarm and encrypted outbox survive restart and deliver to stub provider without enumeration');
 assert.equal((await call('access/consume',{token:restore})).status,200);assert.equal((await call('access/consume',{token:restore})).status,401);facts.push('email link consumed once');
 assert.equal((await webhook(event('refund.created','evt-refund'))).status,200);assert.equal((await webhook(event('checkout.completed','evt-late'))).status,200);
 assert.equal((await call('access/validate',{}, {authorization:'Bearer '+access.token})).status,401);facts.push('refund revokes existing access; late payment cannot revive it');
 await mf.dispose();mf=make({CREEM_MODE:'prod',CREEM_API_KEY:'',CREEM_WEBHOOK_SECRET:'',ACCESS_ENCRYPTION_KEY:'',RESEND_API_KEY:'',MAIL_FROM:''});
 const disabled=await (await mf.dispatchFetch('https://payments.example/api/billing/config')).json();assert.equal(disabled.canPurchase,false);assert.equal((await call('checkout',{requestId,claimSecret})).status,503);facts.push('production missing configuration fails closed');
 let throttled=false;for(let i=0;i<122;i++){const response=await mf.dispatchFetch('https://payments.example/api/billing/config');if(response.status===429){throttled=true;break;}}assert.equal(throttled,true);facts.push('persistent per-client request limiter blocks flooding');
 const result={passed:facts.length,facts,nativeFixtureCalls:native,stubEmails:emails.length,realExternalCalls:0,persistence:storage};await writeFile(root+'/runtime-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await mf.dispose();}
