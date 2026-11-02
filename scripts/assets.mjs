import {cp,mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await mkdir('public/pdfjs',{recursive:true});await mkdir('public/licenses',{recursive:true});
for(const dir of ['standard_fonts','cmaps','wasm'])await cp(`node_modules/pdfjs-dist/${dir}`,`public/pdfjs/${dir}`,{recursive:true});
for(const [src,name] of [['pdf-lib/LICENSE.md','pdf-lib-MIT.txt'],['pdfjs-dist/LICENSE','PDFjs-Apache-2.0.txt'],['@fontsource/dm-sans/LICENSE','DM-Sans-OFL.txt'],['@fontsource/libre-baskerville/LICENSE','Libre-Baskerville-OFL.txt']])await copyFile('node_modules/'+src,'public/licenses/'+name);
const pkg=JSON.parse(await readFile('package.json','utf8'));
await writeFile('public/licenses/NOTICE.txt',`Planner Print Prep 0.1.0\nRuntime dependencies:\n${JSON.stringify(pkg.dependencies,null,2)}\n\nPDF.js: Mozilla Foundation, Apache-2.0. pdf-lib: Andrew Dillon, MIT.\nDM Sans and Libre Baskerville: SIL Open Font License; full license texts accompany this notice.\nPDF.js bundled standard font and CMap licensing files are retained in the copied resource directories.\n`);
console.log('Copied PDF.js resources and 4 license texts locally.');
let transitive='Bundled browser dependencies — license texts\n';
for(const module of ['pdf-lib','pdfjs-dist','@pdf-lib/standard-fonts','@pdf-lib/upng','pako','tslib']){
 const p=JSON.parse(await readFile(`node_modules/${module}/package.json`,'utf8'));
 for(const file of ['LICENSE','LICENSE.md','LICENSE.txt']){
  try {transitive+=`\n\n=== ${module} ${p.version} (${p.license}) ===\n`+await readFile(`node_modules/${module}/${file}`,'utf8');break;}catch{}
 }
}
await writeFile('public/licenses/THIRD_PARTY_LICENSES.txt',transitive);
