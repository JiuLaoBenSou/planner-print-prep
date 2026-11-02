import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type {Page} from '@playwright/test';
const errors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{const items:string[]=[];errors.set(page,items);page.on('pageerror',e=>items.push(e.message));});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
test('sample -> preview -> exports, settings invalidation and manual pairing',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Try a sample'}).click();
  await expect(page.locator('#document-status')).toContainText('7 pages');
  await expect(page.locator('#export-full')).toBeEnabled();
  await expect(page.locator('#sheet-summary')).toContainText('4 sheets');
  const download=page.waitForEvent('download');await page.locator('#export-full').click();
  const saved=await download;expect(saved.suggestedFilename()).toBe('planner-print-ready.pdf');
  await saved.saveAs('output/playwright/browser-export.pdf');
  await page.getByLabel('Trim size').selectOption('A6');
  await expect(page.locator('#issues')).toContainText('Actual size');await expect(page.locator('#export-full')).toBeDisabled();
  await page.getByLabel('Scale design').selectOption('fit');await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByLabel('Print mode').selectOption('manual');
  await page.getByLabel('Reverse the back stack').check();
  await expect(page.locator('#backs-order')).toContainText('blank, 6, 4, 2');
  const back=page.waitForEvent('download');await page.locator('#export-backs').click();
  expect((await back).suggestedFilename()).toBe('planner-backs.pdf');
  await page.screenshot({path:'output/playwright/tool-desktop.png',fullPage:true});
});
test('file selection rejects forms, mixed sizes and malformed files, then recovers',async({page})=>{
  await page.goto('/');
  for(const [path,message] of [['E-form.pdf','Forms'],['D-mixed.pdf','page 2'],['E-annotation.pdf','annotation'],['E-broken.pdf','damaged']]) {
    await page.locator('#pdf-input').setInputFiles('fixtures/'+path);
    await expect(page.locator('#status')).toContainText(message);
    await expect(page.locator('#export-full')).toBeDisabled();
  }
  await page.locator('#pdf-input').setInputFiles('fixtures/C-original-blank.pdf');
  await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByRole('button',{name:'Clear file'}).click();
  expect(await page.locator('#front-canvas').evaluate((c:HTMLCanvasElement)=>c.width)).toBe(0);
  await expect(page.locator('#export-full')).toBeDisabled();
  await expect(page.locator('#document-status')).toContainText('No PDF selected');
});
test('calibration works without a file and explains error classes',async({page})=>{
  await page.goto('/');const d=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download test PDF'}).click();
  expect((await d).suggestedFilename()).toBe('planner-test-print.pdf');
  await page.getByLabel('What did the test show?').selectOption('scale');
  await expect(page.locator('#test-advice')).toContainText('100%');
  await page.getByLabel('What did the test show?').selectOption('random');
  await expect(page.locator('#test-advice')).toContainText('cannot');
  await page.getByLabel('What did the test show?').selectOption('shift');
  await page.getByLabel('Back is shifted right').fill('2');await page.getByLabel('Back is shifted down').fill('1');
  await expect(page.locator('#compensation')).toContainText('2 mm left');
  await page.getByRole('button',{name:'I checked a test print'}).click();
  await expect(page.locator('#calibration-status')).toContainText('User-reported');
  await page.getByLabel('Paper size').selectOption('A4');
  await expect(page.locator('#calibration-status')).toContainText('Recheck');
});
test('settings import/export contains no file information and invalid JSON recovers',async({page})=>{
  await page.goto('/');await page.getByText('Keep your settings for next time',{exact:true}).click();await page.locator('#settings-input').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await expect(page.locator('#settings-status')).toContainText('Could not');
  const s=JSON.parse(await readFile('output/verification/A-letter-plan.json','utf8')).settings;
  s.paper='A4';await page.locator('#settings-input').setInputFiles({name:'good.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(s))});
  await expect(page.getByLabel('Paper size')).toHaveValue('A4');
  const d=page.waitForEvent('download');await page.getByRole('button',{name:'Save settings'}).click();
  await (await d).saveAs('output/playwright/settings.json');
  expect(JSON.parse(await readFile('output/playwright/settings.json','utf8'))).toEqual(s);
});
test('private local workflow leaves no file data in requests or browser storage',async({page})=>{
  const requests:{url:string;body:string|null}[]=[];page.on('request',r=>requests.push({url:r.url(),body:r.postData()}));
  await page.goto('/');await page.locator('#pdf-input').setInputFiles('fixtures/A-seven-page.pdf');
  await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByLabel('Back is shifted right').fill('2');await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByRole('button',{name:'Clear file'}).click();
  const storage=await page.evaluate(async()=>({local:{...localStorage},session:{...sessionStorage},idb:await indexedDB.databases(),caches:await caches.keys()}));
  expect(storage).toEqual({local:{},session:{},idb:[],caches:[]});
  expect(requests.filter(r=>!r.url.startsWith('http://127.0.0.1:4176/'))).toEqual([]);
  expect(requests.filter(r=>r.body||r.url.includes('A-seven-page'))).toEqual([]);
  await page.evaluate(()=>localStorage.clear());
  await page.context().storageState({path:'output/playwright/storage-state.json'});
  await import('node:fs/promises').then(fs=>fs.writeFile('output/playwright/network.json',JSON.stringify(requests,null,2)));
});
test('360px layout, keyboard access, all informational routes and no placeholder canonical',async({page})=>{
  await page.setViewportSize({width:360,height:800});
  for(const path of ['/','/about/','/contact/','/privacy/','/how-to-use/','/guides/a5-vs-half-letter/','/guides/print-planner-inserts/','/guides/duplex-alignment/']) {
    const r=await page.goto(path);expect(r?.status()).toBe(200);await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.locator('link[rel=canonical]').count()).toBe(0);
  }
  await page.goto('/');await page.getByRole('button',{name:'Try a sample'}).click();await expect(page.locator('#export-full')).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'output/playwright/tool-mobile.png',fullPage:true});
});
test('all sheet previews, short-edge output, overlay and enlargement are usable',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Try a sample'}).click();await expect(page.locator('#export-full')).toBeEnabled();
  for(const n of ['1','2','4']) {await page.getByLabel('Sheet',{exact:true}).selectOption(n);await expect(page.locator('#front-caption')).toContainText('SHEET '+n);}
  await expect(page.locator('#back-caption')).toContainText('ADDED BLANK');
  await page.getByLabel('Sheet',{exact:true}).selectOption('1');await page.getByLabel('Flip edge').selectOption('short');await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByLabel('Preview view').selectOption('output');await expect(page.locator('#preview-description')).toContainText('intentionally upside down');
  await page.getByLabel('Preview view').selectOption('overlay');await expect(page.locator('#preview-description')).toContainText('reflected horizontally');
  await expect(page.locator('#back-figure')).toBeHidden();
  await page.getByRole('button',{name:'Enlarge this sheet'}).click();await expect(page.locator('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Close enlarged preview'}).click();await expect(page.locator('dialog')).toBeHidden();
  await page.locator('.preview').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/overlay.png'});
});
test('cancel and replace a 120-page task, then measure a ten-page preview',async({page,browser})=>{
  await page.goto('/');
  await page.locator('#pdf-input').setInputFiles('fixtures/A-120-page.pdf');
  await expect(page.locator('#cancel')).toBeVisible();await page.locator('#cancel').click();
  await expect(page.locator('#status')).toContainText('cancelled');
  await page.locator('#pdf-input').setInputFiles('fixtures/C-one-page.pdf');await expect(page.locator('#export-full')).toBeEnabled();
  await expect(page.locator('#document-status')).toContainText('1 pages');
  const start=Date.now();await page.locator('#pdf-input').setInputFiles('fixtures/A-ten-page.pdf');await expect(page.locator('#export-full')).toBeEnabled();
  const elapsed=Date.now()-start;expect(elapsed).toBeLessThan(5000);
  const canvasCount=await page.locator('canvas').count();expect(canvasCount).toBe(2);
  const largeStart=Date.now();await page.locator('#pdf-input').setInputFiles('fixtures/A-120-page.pdf');await expect(page.locator('#export-full')).toBeEnabled({timeout:15000});
  await expect(page.locator('#document-status')).toContainText('120 pages');
  await import('node:fs/promises').then(fs=>fs.writeFile('output/playwright/performance.json',JSON.stringify({browser:browser.version(),fixture:'fixtures/A-ten-page.pdf',previewMs:elapsed,canvasCount,largeFixture:'fixtures/A-120-page.pdf',largePreviewMs:Date.now()-largeStart,platform:process.platform},null,2)));
});
test('share cancellation preserves output, offsets can undo, and invalid custom inputs recover',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'canShare',{value:()=>true});
    Object.defineProperty(navigator,'share',{value:async()=>{throw new DOMException('Cancelled','AbortError');}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Try a sample'}).click();await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByRole('button',{name:'Share PDF',exact:true}).click();await expect(page.locator('#export-status')).toContainText('Share cancelled');await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByLabel('Back is shifted right').fill('2');await page.getByRole('button',{name:'Reset offset',exact:true}).click();
  await page.getByRole('button',{name:'Undo offset',exact:true}).click();await expect(page.getByLabel('Back is shifted right')).toHaveValue('2');
  await page.getByLabel('Trim size').selectOption('Custom');await page.getByLabel('Custom width').fill('999');await expect(page.locator('#export-full')).toBeDisabled();
  await page.waitForTimeout(700); // Cross the 200ms settings debounce: a stale valid task must not re-enable output.
  await expect(page.locator('#export-full')).toBeDisabled();
  await expect(page.locator('#test-download')).toBeDisabled();
  await page.getByLabel('Custom width').fill('148');await page.getByLabel('Display units').selectOption('in');await expect(page.locator('#export-full')).toBeEnabled();
});
test('keyboard navigation and automated accessibility checks pass on the real pages',async({page})=>{
  await page.goto('/');await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to the print workspace'})).toBeFocused();
  await page.getByRole('button',{name:'Try a sample'}).click();await expect(page.locator('#export-full')).toBeEnabled();
  const reports:{path:string;violations:unknown[]}[]=[];
  for(const path of ['/','/about/','/contact/','/privacy/','/how-to-use/','/guides/a5-vs-half-letter/','/guides/print-planner-inserts/','/guides/duplex-alignment/']) {
    if(path!=='/')await page.goto(path);
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    reports.push({path,violations:result.violations});expect(result.violations).toEqual([]);
  }
  await import('node:fs/promises').then(fs=>fs.writeFile('output/playwright/accessibility.json',JSON.stringify(reports,null,2)));
});
