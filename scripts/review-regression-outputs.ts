import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {defaults,plan,type PrintSettings} from '../src/core';
import {preflight,buildPdf} from '../src/pdf';
await mkdir('output/fix-review',{recursive:true});
const input=new Uint8Array(await readFile('fixtures/G-review-safe-area.pdf'));
const base:PrintSettings={...defaults,trim:'Custom',customWidth:210,customHeight:260,band:20,first:'back',flip:'short',marginLeft:0,marginRight:20,marginTop:0,marginBottom:0,marks:false};
const cases:[string,PrintSettings,boolean][]=[
  ['review-exact-blocked',base,true],
  ['short-offset-blocked',{...base,offsetX:2,offsetY:1},true],
  ['short-safe-combination',{...base,offsetX:2,offsetY:1,marginLeft:20,marginRight:0,marginTop:20},false],
  ['long-safe-control',{...base,flip:'long'},false],
];
const results=[];
for(const [name,settings,expectedBlocked] of cases){
  const layout=plan(await preflight(input),settings);let outputFile:string|null=null,exportError:string|null=null;
  try {const bytes=await buildPdf(input,layout);outputFile=`output/fix-review/${name}.pdf`;await writeFile(outputFile,bytes);}
  catch(e){exportError=e instanceof Error?e.message:String(e);}
  if(Boolean(exportError)!==expectedBlocked)throw Error(`${name}: unexpected export result`);
  if(expectedBlocked&&!exportError?.includes('safe area'))throw Error(`${name}: wrong refusal reason`);
  results.push({name,settings,errors:layout.errors,expectedBlocked,actualExportBlocked:!!exportError,exportError,outputFile});
}
await writeFile('output/fix-review/safe-area-results.json',JSON.stringify(results,null,2));
console.log(`Review safety cases: ${results.length}; blocked=${results.filter(r=>r.actualExportBlocked).length}; generated=${results.filter(r=>r.outputFile).length}`);
