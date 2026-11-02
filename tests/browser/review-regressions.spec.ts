import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {defaults} from '../../src/core';
test.beforeEach(async()=>{await mkdir('output/fix-review',{recursive:true});});
let pageErrors:string[]=[];
test.beforeEach(async({page})=>{pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));});
test.afterEach(()=>{expect(pageErrors).toEqual([]);});
test('a delayed sample response cannot replace the last local selection',async({page})=>{
  let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>release=r),intercepted=new Promise<void>(r=>seen=r);
  await page.route('**/samples/planner-sample.pdf',async route=>{const response=await route.fetch();seen();await gate;await route.fulfill({response}).catch(()=>{});});
  await page.goto('/');await page.getByRole('button',{name:'Try a sample',exact:true}).click();await intercepted;
  await page.locator('#pdf-input').setInputFiles('fixtures/C-one-page.pdf');await expect(page.locator('#export-full')).toBeEnabled();
  const before=await page.locator('#document-status').innerText();release();
  // Wait beyond the old response/generation path, then inspect both status and the actual downloaded PDF.
  await page.waitForTimeout(1200);
  await expect(page.locator('#document-status')).toContainText('1 pages');await expect(page.locator('#sheet-summary')).toContainText('1 sheets');
  const download=page.waitForEvent('download');await page.locator('#export-full').click();await(await download).saveAs('output/fix-review/latest-local-export.pdf');
  await writeFile('output/fix-review/sample-race-result.json',JSON.stringify({before,after:await page.locator('#document-status').innerText()},null,2));
});
test('clearing while a sample body is still being read invalidates that sample',async({page})=>{
  await page.addInitScript(()=>{
    const read=Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer=async function(){
      if(this.url.endsWith('/samples/planner-sample.pdf')){
        document.documentElement.dataset.sampleReading='yes';
        await new Promise<void>(resolve=>window.addEventListener('release-sample-body',()=>resolve(),{once:true}));
      }
      return read.call(this);
    };
  });
  await page.goto('/');await page.locator('#pdf-input').setInputFiles('fixtures/C-one-page.pdf');await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByRole('button',{name:'Try a sample',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.sampleReading==='yes');
  await page.getByRole('button',{name:'Clear file',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('release-sample-body')));await page.waitForTimeout(1000);
  await expect(page.locator('#document-status')).toHaveText('No PDF selected');await expect(page.locator('#export-full')).toBeDisabled();
});
test('asymmetric safe margins block the review input and permit a physically safe short-edge alternative',async({page})=>{
  await page.goto('/');
  const blocked={...defaults,trim:'Custom',customWidth:210,customHeight:260,band:20,first:'back',flip:'short',marginLeft:0,marginRight:20,marginTop:0,marginBottom:0,marks:false};
  await page.locator('#settings-input').setInputFiles({name:'safe-area.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(blocked))});
  await expect(page.getByLabel('Flip edge')).toHaveValue('short');
  await page.locator('#pdf-input').setInputFiles('fixtures/G-review-safe-area.pdf');
  await expect(page.locator('#issues')).toContainText('safe area');await expect(page.locator('#export-full')).toBeDisabled();
  const allowed={...blocked,marginLeft:20,marginRight:0,marginTop:20,marginBottom:0,offsetX:2,offsetY:1};
  await page.locator('#settings-input').setInputFiles({name:'safe-alternative.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(allowed))});
  await expect(page.locator('#export-full')).toBeEnabled();
  const download=page.waitForEvent('download');await page.locator('#export-full').click();await(await download).saveAs('output/fix-review/safe-browser-export.pdf');
  await page.getByLabel('Preview view').selectOption('output');await expect(page.locator('#preview-description')).toContainText('Actual PDF');
  await page.locator('#back-canvas').screenshot({path:'output/fix-review/safe-raw-back.png'});
  await page.getByLabel('Preview view').selectOption('pair');await expect(page.locator('#preview-description')).toContainText('Both sides');
  await page.locator('#back-canvas').screenshot({path:'output/fix-review/safe-upright-back.png'});
});
