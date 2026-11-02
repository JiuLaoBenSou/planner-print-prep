import {parseSettings,type PrintSettings} from './core';
export type Profile={id:string;name:string;settings:PrintSettings};
export const profileLimit=20;
export function parseProfiles(text:string):Profile[]{
 if(text.length>100_000)throw Error('Profile file is too large.');
 const v=JSON.parse(text);if(!v||Object.keys(v).sort().join(',')!=='profiles,schemaVersion'||v.schemaVersion!==1||!Array.isArray(v.profiles)||v.profiles.length>profileLimit)throw Error('Choose a version 1 profile collection.');
 const names=new Set<string>(),ids=new Set<string>();
 return v.profiles.map((p:Profile)=>{if(!p||Object.keys(p).sort().join(',')!=='id,name,settings'||typeof p.id!=='string'||!/^[-\w]{1,80}$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>48||/[\u0000-\u001f]/.test(p.name)||names.has(p.name.toLowerCase())||ids.has(p.id))throw Error('Profiles need unique names and IDs (name: 1–48 characters).');names.add(p.name.toLowerCase());ids.add(p.id);return {id:p.id,name:p.name,settings:parseSettings(JSON.stringify(p.settings))};});
}
export function saveProfile(profiles:Profile[],name:string,settings:PrintSettings,id?:string):Profile[]{
 name=name.trim();if(profiles.some(p=>p.name.toLowerCase()===name.toLowerCase()&&p.id!==id))throw Error('A profile with this name already exists. Choose another name or Replace selected.');
 if(id&&!profiles.some(p=>p.id===id))throw Error('Select a profile to replace.');
 const next={id:id??crypto.randomUUID(),name,settings:parseSettings(JSON.stringify(settings))};
 return parseProfiles(JSON.stringify({schemaVersion:1,profiles:id?profiles.map(p=>p.id===id?next:p):[...profiles,next]}));
}
export type BatchInput={name:string;size:number;data?:Uint8Array;file?:File};
export type OutputFile={name:string;bytes:Uint8Array};
export type BatchOutput={pages:number;sheets:number;warnings:string[];files:OutputFile[]};
export type BatchRecord={name:string;status:'ready'|'error';pages?:number;sheets?:number;warnings?:string[];error?:string};
export function validateQueue(files:BatchInput[]){
 if(!files.length||files.length>10)throw Error('Choose 1–10 PDFs for one batch.');
 if(files.some(f=>f.size>20*1024*1024))throw Error('Each PDF must be at most 20 MiB.');
 if(files.reduce((n,f)=>n+f.size,0)>80*1024*1024)throw Error('A batch can contain at most 80 MiB of source files.');
}
export async function runBatch(inputs:BatchInput[],settings:PrintSettings,process:(file:BatchInput,s:PrintSettings,signal:AbortSignal)=>Promise<BatchOutput>,signal:AbortSignal,progress?:(i:number,record:BatchRecord)=>void){
 validateQueue(inputs);const snapshot=parseSettings(JSON.stringify(settings));const files:OutputFile[]=[],records:BatchRecord[]=[];let size=0;
 for(let i=0;i<inputs.length;i++){
  signal.throwIfAborted();const file=inputs[i];let record:BatchRecord;
  try{
   const result=await process(file,structuredClone(snapshot),signal);signal.throwIfAborted();
   const prefix=String(i+1).padStart(2,'0')+'-'+(file.name.replace(/\.pdf$/i,'').replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,64)||'document');
   if(!result.files.length||result.files.some(f=>!/^(full|fronts|backs)\.pdf$/.test(f.name)))throw Error('Unexpected output files.');
   const bytes=result.files.reduce((n,f)=>n+f.bytes.byteLength,0);if(size+bytes>64*1024*1024)throw Error('Batch output exceeds 64 MiB. Split it into smaller batches.');size+=bytes;
   for(const output of result.files)files.push({...output,name:prefix+'/'+output.name});
   record={name:file.name,status:'ready',pages:result.pages,sheets:result.sheets,warnings:result.warnings};
  }catch(error){signal.throwIfAborted();record={name:file.name,status:'error',error:error instanceof Error?error.message:'Could not process this PDF.'};}
  records.push(record);progress?.(i,record);
 }
 signal.throwIfAborted();return {files,records,settings:snapshot};
}
// ZIP store mode keeps PDF bytes unchanged. UTF-8 names and CRC32 are standard ZIP fields.
export function zipFiles(files:OutputFile[]):Uint8Array{
 const chunks:Uint8Array[]=[],directory:Uint8Array[]=[];let offset=0;
 const crc=(bytes:Uint8Array)=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 for(const file of files){
  if(file.name.startsWith('/')||file.name.split('/').some(p=>!p||p==='..'||p==='.')||file.name.includes('\\'))throw Error('Unsafe ZIP path.');
  const name=new TextEncoder().encode(file.name),data=file.bytes,checksum=crc(data);const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint32(14,checksum,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);
  const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,checksum,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
  chunks.push(local,data);directory.push(central);offset+=local.length+data.length;
 }
 const centralSize=directory.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
 const zip=new Uint8Array(offset+centralSize+22);let p=0;for(const chunk of [...chunks,...directory,end]){zip.set(chunk,p);p+=chunk.length;}return zip;
}
