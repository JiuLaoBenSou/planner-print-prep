import {defineConfig} from '@playwright/test';
const live=process.env.PPP_PUBLIC_URL;
export default defineConfig({
  testDir:'./tests/release', timeout:90000, workers:1,
  use:{baseURL:live??'http://127.0.0.1:4177/planner-print-prep/',channel:'chrome',headless:true,trace:'retain-on-failure'},
  reporter:[['list'],['json',{outputFile:live?'output/release/live-browser.json':'output/release/local-browser.json'}]],
  outputDir:live?'output/release/live-browser':'output/release/local-browser',
  webServer:live?undefined:{command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4177 --strictPort --base /planner-print-prep/ --outDir output/release/site',url:'http://127.0.0.1:4177/planner-print-prep/',reuseExistingServer:false},
});
