import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({
  appType:'mpa',
  build:{rollupOptions:{input:Object.fromEntries(['index.html','designs/index.html','about/index.html','contact/index.html','privacy/index.html','how-to-use/index.html','guides/a5-vs-half-letter/index.html','guides/print-planner-inserts/index.html','guides/duplex-alignment/index.html'].map(p=>[p,resolve(p)]))}},
  plugins:[{name:'local-only-csp',transformIndexHtml(html){return html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; worker-src \'self\' blob:; style-src \'self\' \'unsafe-inline\'; font-src \'self\' blob:; img-src \'self\' data: blob:; connect-src \'self\' ws://127.0.0.1:4176; object-src \'none\'; base-uri \'self\'; form-action \'none\'">');}}],
});
