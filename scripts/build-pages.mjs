import {spawnSync} from 'node:child_process';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const site=new URL(process.env.PPP_SITE_URL??'https://plannerprintprep.com/');
if(site.protocol!=='https:'||site.search||site.hash||!site.pathname.endsWith('/'))throw new Error('PPP_SITE_URL must be an HTTPS URL ending in /, without query or fragment.');
const billing=process.argv.includes('--billing');
const productionApi='https://planner-print-prep-payments.video-to-gif-local.workers.dev/api/billing/';
if(billing){
 if(site.href!=='https://plannerprintprep.com/'||process.env.VITE_BILLING_API_URL&&process.env.VITE_BILLING_API_URL!==productionApi)throw Error('Production billing build requires the production site and billing API.');
 process.env.VITE_BILLING_API_URL=productionApi;
}
const dir=resolve('output/release/site');
await import('./prepare.mjs');
for(const args of [['node_modules/typescript/bin/tsc','--noEmit'],['node_modules/vite/bin/vite.js','build','--base',site.pathname,'--outDir',dir]]){
 const run=spawnSync(process.execPath,args,{stdio:'inherit'});if(run.status!==0)process.exit(run.status??1);
}
const routes=[];
async function visit(folder){for(const file of await readdir(folder,{withFileTypes:true})){
 const path=resolve(folder,file.name);if(file.isDirectory()){await visit(path);continue;}if(!file.name.endsWith('.html'))continue;
 let html=await readFile(path,'utf8');
 const route=path.slice(dir.length+1).replaceAll('\\','/').replace(/index\.html$/,'');
 const canonical=new URL(route,site).href;
 html=html.replace(/\b(href|src)="(\/(?!\/)[^"]*)"/g,(match,attr,value)=>`${attr}="${value.startsWith(site.pathname)?value:site.pathname+value.slice(1)}"`);
 html=html.replace('</head>',`<link rel="canonical" href="${canonical}"><meta property="og:url" content="${canonical}"></head>`);
 html=html.replace("connect-src 'self' ws://127.0.0.1:4176","connect-src 'self'");
 await writeFile(path,html);
 if(!/name="robots" content="[^"]*noindex/.test(html))routes.push(canonical);
}}
await visit(dir);
await writeFile(resolve(dir,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+routes.sort().map(url=>`\n<url><loc>${url}</loc></url>`).join('')+'\n</urlset>\n');
await writeFile(resolve(dir,'robots.txt'),`User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml',site).href}\n`);
await writeFile(resolve(dir,'.nojekyll'),'');
await mkdir('output/release',{recursive:true});
await writeFile('output/release/build.json',JSON.stringify({site:site.href,base:site.pathname,indexablePages:routes.length,output:dir,billingApi:process.env.VITE_BILLING_API_URL??null,billingRelease:billing},null,2));
console.log(`Pages build: ${site.href} (${routes.length} indexable pages)`);
