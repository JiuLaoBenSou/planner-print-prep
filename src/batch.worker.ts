/// <reference lib="webworker" />
import {preflight,buildPdf} from './pdf';
import {plan,parseSettings} from './core';
self.onmessage=async event=>{
 try{
  const {bytes,settings}=event.data;const s=parseSettings(JSON.stringify(settings));const input=new Uint8Array(bytes),info=await preflight(input),layout=plan(info,s);
  if(layout.errors.length)throw Error(layout.errors.join(' '));
  const kinds=s.mode==='manual'?['full','fronts','backs'] as const:['full'] as const;
  const files=[];for(const kind of kinds)files.push({name:kind+'.pdf',bytes:await buildPdf(input,layout,kind)});
  self.postMessage({pages:info.pages.length,sheets:layout.sheets,warnings:layout.warnings,files},files.map(f=>f.bytes.buffer));
 }catch(error){self.postMessage({error:error instanceof Error?error.message:'Could not process this PDF.'});}
};
