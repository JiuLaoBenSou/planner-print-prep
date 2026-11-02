/// <reference lib="webworker" />
import {preflight,buildPdf,testPdf} from './pdf';
import {plan,parseSettings} from './core';
self.onmessage=async(event:MessageEvent)=>{
  const {id,action,bytes,settings,kind}=event.data;
  try {
    const s=parseSettings(JSON.stringify(settings));
    if(action==='test') {
      const output=await testPdf(s);self.postMessage({id,output},[output.buffer]);return;
    }
    const input=new Uint8Array(bytes);const info=await preflight(input);const layout=plan(info,s);
    self.postMessage({id,phase:'parsed',info,layout});
    if(layout.errors.length){self.postMessage({id,info,layout});return;}
    const output=await buildPdf(input,layout,kind??'full');
    self.postMessage({id,info,layout,output},[output.buffer]);
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:'Could not process this PDF.'});}
};
