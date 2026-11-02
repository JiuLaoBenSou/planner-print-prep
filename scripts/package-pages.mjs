import {cp,mkdir,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,extname} from 'node:path';
const root=resolve('.'), target=resolve('output/release/repository');
await mkdir(target,{recursive:true});
// Explicit public source allowlist. Internal project documents and evidence stay local.
const allow=['src','scripts','tests','fixtures','public','about','contact','privacy','how-to-use','guides','designs','index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts','playwright.config.ts','playwright.pages.config.ts','requirements-dev.txt'];
for(const path of allow)await cp(resolve(root,path),resolve(target,path),{recursive:true});
await writeFile(resolve(target,'.gitignore'),'node_modules/\ndist/\noutput/\ntest-results/\nplaywright-report/\n.vite/\n.env\n.env.*\n');
await writeFile(resolve(target,'.gitattributes'),'* -text\n');
await writeFile(resolve(target,'README.md'),`# Planner Print Prep

A free browser-based tool to resize your existing planner PDF, check duplex page order, prepare a test print, and export a print-ready PDF. PDF files stay in browser memory and are not uploaded.

**Website:** https://jiulaobensou.github.io/planner-print-prep/

One insert per output side on A4 or Letter. Includes A5, A6, Half Letter and custom trim sizes, proportional scaling, binding space, safety checks, manual front/back exports, and fixed back-side offset correction. Random feed errors and printer skew cannot be corrected with a fixed offset. Physical printing and iPad/Safari paths remain unverified.

The current core is free with no account, watermark, export cooldown or checkout. Plus batch processing and named profiles are planned and are not available for purchase.

## Run locally

Node.js 22.13+ and npm are required.

~~~sh
npm ci
npm run dev
~~~

Open http://127.0.0.1:4176/. To build and test:

~~~sh
npm run build
npm test
npm run test:browser
npm run build:pages
npm run test:pages
~~~

Browser checks use an installed Chrome browser. Python PDF checks additionally require the packages in requirements-dev.txt. The optional full local verification script writes its results under output/.

## GitHub Pages

The main branch holds public source. The gh-pages branch holds the reviewed static build. Build with npm run build:pages, then publish output/release/site to the gh-pages branch root. PPP_SITE_URL can override the default HTTPS address when building for a different deployment.

GitHub Pages hosts static assets only; there is currently no payment backend. GitHub may log visitor IP addresses for security. See the website's Privacy policy for details.

## Contact and dependencies

Contact: fanghong1994@gmail.com. Please do not email private PDFs or purchased templates.

Third-party license texts are included under public/licenses and alongside PDF.js resources. PDF.js is Apache-2.0, pdf-lib is MIT, and bundled fonts are SIL OFL. These dependency licenses do not grant rights to third-party planner templates.
`);
const files=[];
async function inspect(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
 if(entry.name==='.git')continue;
 const path=resolve(folder,entry.name);if(entry.isDirectory()){await inspect(path);continue;}
 const name=relative(target,path).replaceAll('\\','/');const bytes=await readFile(path);
 if(['.ts','.js','.mjs','.json','.html','.md','.txt'].includes(extname(name))&&/(?:[A-Z]:[\\/](?:Users|个人大管家|Foster)|\b(?:ghp_|gho_|sk_live_)[A-Za-z0-9]{10,})/i.test(bytes.toString('utf8')))throw new Error('Private path or credential pattern in '+name);
 files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}}
await inspect(target);
await writeFile('output/release/public-source-manifest.json',JSON.stringify(files,null,2));
console.log(JSON.stringify({publicSourceFiles:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),target,excluded:['internal Markdown plans','output evidence','user files','credentials','node_modules','dist']},null,2));
