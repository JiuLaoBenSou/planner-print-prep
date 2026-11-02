import {defineConfig,loadEnv} from 'vite';
import {resolve} from 'node:path';
export default defineConfig(({mode})=>{
  const api=loadEnv(mode,process.cwd(),'VITE_').VITE_BILLING_API_URL;
  let billingOrigin='';
  if(api){const url=new URL(api);if(!api.endsWith('/')||url.search||url.hash||url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('VITE_BILLING_API_URL must be an HTTPS directory URL (or loopback HTTP), without credentials/query/hash.');billingOrigin=' '+url.origin;}
  return {
  appType:'mpa',
  server:{proxy:{'/api/billing/':'http://127.0.0.1:4178'},fs:{deny:['.env','.env.*','**/*.sqlite','**/*.sqlite-wal','**/*.sqlite-shm']}},
  build:{rollupOptions:{input:Object.fromEntries(['index.html','designs/index.html','about/index.html','contact/index.html','privacy/index.html','how-to-use/index.html','pricing/index.html','terms/index.html','refunds/index.html','guides/a5-vs-half-letter/index.html','guides/print-planner-inserts/index.html','guides/duplex-alignment/index.html'].map(p=>[p,resolve(p)]))}},
  plugins:[{name:'local-only-csp',transformIndexHtml(html){return html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; worker-src \'self\' blob:; style-src \'self\' \'unsafe-inline\'; font-src \'self\' blob:; img-src \'self\' data: blob:; connect-src \'self\' ws://127.0.0.1:4176'+billingOrigin+'; object-src \'none\'; base-uri \'self\'; form-action \'none\'">');}}],
  };
});
