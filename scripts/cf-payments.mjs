import workerd from 'workerd';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {existsSync,symlinkSync,readFileSync} from 'node:fs';
// cf beta.15 resolves delegates only inside the worker directory, even in workspaces.
const localModules=resolve('payments/node_modules');if(!existsSync(localModules))symlinkSync(resolve('node_modules'),localModules,process.platform==='win32'?'junction':'dir');
const args=process.argv.slice(2);
if(args.includes('--prebuilt')){
 const modeIndex=args.findIndex(arg=>arg==='--mode'||arg==='-m');
 const inlineMode=args.find(arg=>arg.startsWith('--mode='))?.slice(7);
 const requested=inlineMode??(modeIndex>=0?args[modeIndex+1]:'production');
 const manifest=JSON.parse(readFileSync(resolve('payments/.cloudflare/output/v0/config.json'),'utf8'));
 if(manifest.buildContext?.mode!==requested){console.error('Prebuilt payment environment mismatch. Rebuild using the intended mode before deploying.');process.exit(2);}
}
const child=spawn(process.execPath,[resolve('node_modules/cf/bin/cf'),...process.argv.slice(2)],{cwd:resolve('payments'),stdio:'inherit',env:{...process.env,DO_NOT_TRACK:'1',MINIFLARE_WORKERD_PATH:workerd.default??workerd}});
child.on('error',()=>{console.error('Cloudflare CLI could not start.');process.exitCode=1;});child.on('exit',code=>process.exit(code??1));
