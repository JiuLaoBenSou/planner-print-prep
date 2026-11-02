import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/plus-browser',timeout:60000,workers:1,
 use:{baseURL:'http://127.0.0.1:4176',channel:'chrome',headless:true,trace:'retain-on-failure'},
 reporter:[['list'],['json',{outputFile:'output/plus/browser-results.json'}]],outputDir:'output/plus/browser',
 webServer:{command:'npm run dev:plus',url:'http://127.0.0.1:4176',reuseExistingServer:false,env:{VITE_BILLING_API_URL:'http://127.0.0.1:4178/api/billing/'}},
});
