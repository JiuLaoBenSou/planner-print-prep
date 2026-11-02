import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,relative} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
mkdirSync('output/verification',{recursive:true});
const steps=[
 ['prepare',process.execPath,['scripts/prepare.mjs']],
 ['typecheck',process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],
 ['build',process.execPath,['node_modules/vite/bin/vite.js','build']],
 ['unit',process.execPath,['node_modules/vitest/vitest.mjs','run','--reporter=json','--outputFile=output/verification/unit-results.json']],
 ['browser-built',process.execPath,['node_modules/@playwright/test/cli.js','test']],
 ['plus-browser',process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.plus.config.ts']],
 ['plus-independent','python',['scripts/verify_plus.py']],
 ['independent-pdf','python',['scripts/verify_pdf.py']],
 ['site','python',['scripts/check_site.py']],
 ['review-outputs',process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/review-regression-outputs.ts']],
 ['review-independent','python',['scripts/verify_review_fixes.py']],
];
const results=[];
for(const [name,command,args] of steps){
 const started=Date.now();const run=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024,env:{...process.env,PPP_TEST_BUILT:'1'}});
 writeFileSync(`output/verification/${name}.log`,(run.stdout??'')+(run.stderr??'')+(run.error?String(run.error):''));
 results.push({name,exitCode:run.status,durationMs:Date.now()-started});
 console.log(`${name}: exit=${run.status}`);
 if(run.status!==0){console.log((run.stdout??'')+(run.stderr??''));writeFileSync('output/verification/final-verification.json',JSON.stringify({results,complete:false},null,2));process.exit(1);}
}
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=[];
function add(path){if(statSync(path).isDirectory())for(const name of readdirSync(path))add(resolve(path,name));else{const b=readFileSync(path);files.push({path:relative(root,path).replaceAll('\\','/'),bytes:b.length,sha256:sha(b)});}}
for(const path of ['src','server','scripts','tests','fixtures','public','about','contact','privacy','how-to-use','pricing','terms','refunds','guides','designs','index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts','playwright.config.ts','playwright.pages.config.ts','playwright.plus.config.ts','README.md','requirements-dev.txt'])add(resolve(path));
// Private project notes are included in local evidence, but are not published with the source.
for(const path of ['IMPLEMENTATION_PLAN.md','ACCEPTANCE_STATUS.md','PRINT_TEST_PROTOCOL.md','PRICING_PLAN.md','SEO_POSITIONING.md','PAYMENT_INTEGRATION.md'])if(existsSync(path))add(resolve(path));
writeFileSync('output/verification/source-manifest.json',JSON.stringify(files,null,2));
const unit=JSON.parse(readFileSync('output/verification/unit-results.json','utf8'));
const browser=JSON.parse(readFileSync('output/playwright/results.json','utf8'));
const report={date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),complete:true,node:process.version,platform:process.platform,results,unit:{passed:unit.numPassedTests,failed:unit.numFailedTests},browser:browser.stats,plusBrowser:JSON.parse(readFileSync('output/plus/browser-results.json','utf8')).stats,plusIndependent:JSON.parse(readFileSync('output/plus/independent-checks.json','utf8')).passed,independentPdf:JSON.parse(readFileSync('output/verification/independent-checks.json')).count,site:JSON.parse(readFileSync('output/verification/site-checks.json')),sourceFiles:files.length,sourceManifestSHA256:sha(readFileSync('output/verification/source-manifest.json'))};
writeFileSync('output/verification/final-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
