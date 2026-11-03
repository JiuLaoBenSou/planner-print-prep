import {defineConfig,bindings,exports} from 'cf/config';
import {readFileSync} from 'node:fs';
import * as entrypoint from './worker.ts' with {type:'cf-worker'};
export default defineConfig(({mode})=>{
 const sandbox=mode==='sandbox';
 const product=sandbox?JSON.parse(readFileSync(new URL('./sandbox-product.json',import.meta.url),'utf8')):{id:'prod_7MybLMuwoKlHSEMyRr1NAt',mode:'prod'};
 if(product.mode!==(sandbox?'test':'prod')||!/^prod_[a-zA-Z0-9]+$/.test(product.id)||sandbox&&product.id==='prod_7MybLMuwoKlHSEMyRr1NAt')throw Error('Payment environment/product mismatch.');
 return {worker:{
 name:sandbox?'planner-print-prep-payments-sandbox':'planner-print-prep-payments',entrypoint,compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],workersDev:true,previewUrls:false,
 observability:{enabled:true,redactQueryString:true,logs:{enabled:true,invocationLogs:false},traces:{enabled:true,headSamplingRate:0.01}},
 exports:{ProductBilling:exports.durableObject({storage:'sqlite'})},
 env:{
 CREEM_MODE:bindings.text<string>(product.mode),APP_URL:bindings.text('https://plannerprintprep.com/'),CREEM_PRODUCT_ID:bindings.text<string>(product.id),CREEM_LIVE_SALES_ENABLED:bindings.text<string>(sandbox?'NO':'YES'),
 CREEM_API_KEY:bindings.secret(),CREEM_WEBHOOK_SECRET:bindings.secret(),ACCESS_ENCRYPTION_KEY:bindings.secret(),RESEND_API_KEY:bindings.secret(),MAIL_FROM:bindings.secret()}
 }};
});
