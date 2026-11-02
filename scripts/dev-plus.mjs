import {spawn} from 'node:child_process';
await import('./prepare.mjs');
const demo=process.argv.includes('--demo');
const children=[spawn(process.execPath,['--import','tsx','server/dev.ts'],{stdio:'inherit',env:{...process.env,...(demo?{CREEM_MODE:'mock'}:{})}}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4176','--strictPort'],{stdio:'inherit',env:process.env})];
let closing=false;function stop(code=0){if(closing)return;closing=true;for(const child of children)child.kill();setTimeout(()=>process.exit(code),300);}
for(const child of children)child.on('exit',code=>stop(code??0));
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
