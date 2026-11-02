import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser', timeout:45000, workers:1,
  use:{baseURL:'http://127.0.0.1:4176',channel:'chrome',headless:true,trace:'retain-on-failure'},
  reporter:[['list'],['json',{outputFile:'output/playwright/results.json'}]],
  webServer:{command:process.env.PPP_TEST_BUILT?'npm run preview':'npm run dev',url:'http://127.0.0.1:4176',reuseExistingServer:false},
});
