import {it,expect} from 'vitest';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {defaults,plan} from '../src/core';
import {preflight,buildPdf} from '../src/pdf';
import {parseProfiles,saveProfile,runBatch,zipFiles} from '../src/plus-core';
it('profiles are isolated settings snapshots, reject malformed or private fields, and replace explicitly',()=>{
 const s={...defaults};const profiles=saveProfile([], 'Letter duplex',s);s.paper='A4';
 expect(profiles[0].settings.paper).toBe('Letter');
 expect(()=>saveProfile(profiles,'Letter duplex',s)).toThrow(/exists/);
 expect(saveProfile(profiles,'Letter duplex',s,profiles[0].id)[0].settings.paper).toBe('A4');
 expect(parseProfiles(JSON.stringify({schemaVersion:1,profiles}))).toEqual(profiles);
 expect(()=>parseProfiles(JSON.stringify({schemaVersion:1,profiles,fileName:'private.pdf'}))).toThrow();
 expect(()=>parseProfiles(JSON.stringify({schemaVersion:1,profiles:[{...profiles[0],settings:{...defaults,offsetX:99}}]}))).toThrow();
 expect(()=>saveProfile([], '  ',defaults)).toThrow();
});
it('batch continues after a bad file, preserves each PDF pairing and yields a readable ZIP',async()=>{
 const good=new Uint8Array(await readFile('fixtures/A-seven-page.pdf'));let active=0,max=0;
 const result=await runBatch([{name:'../planner.pdf',size:good.length,data:good},{name:'bad.pdf',size:4,data:new Uint8Array([1,2,3,4])},{name:'planner.pdf',size:good.length,data:good}],defaults,async(file,s)=>{
  active++;max=Math.max(active,max);try{const info=await preflight(file.data!);const layout=plan(info,s);if(layout.errors.length)throw Error(layout.errors.join(' '));return {pages:info.pages.length,sheets:layout.sheets,warnings:layout.warnings,files:[{name:'full.pdf',bytes:await buildPdf(file.data!,layout)}]};}finally{active--;}
 },new AbortController().signal);
 expect(max).toBe(1);expect(result.records.map(r=>r.status)).toEqual(['ready','error','ready']);
 expect(result.files.map(f=>f.name)).toEqual(['01-planner/full.pdf','03-planner/full.pdf']);
 expect((await PDFDocument.load(result.files[0].bytes)).getPageCount()).toBe(8);
 await mkdir('output/plus',{recursive:true});await writeFile('output/plus/unit-batch.zip',zipFiles([...result.files,{name:'batch-report.json',bytes:new TextEncoder().encode(JSON.stringify(result.records))}]));
});
it('cancellation and oversized queues never return a stale downloadable batch',async()=>{
 const abort=new AbortController();
 await expect(runBatch([{name:'one.pdf',size:5}],defaults,async()=>{abort.abort();return {pages:1,sheets:1,warnings:[],files:[]};},abort.signal)).rejects.toMatchObject({name:'AbortError'});
 let called=false;await expect(runBatch([{name:'large.pdf',size:21*1024*1024}],defaults,async()=>{called=true;throw Error();},new AbortController().signal)).rejects.toThrow(/20 MiB/);expect(called).toBe(false);
});
