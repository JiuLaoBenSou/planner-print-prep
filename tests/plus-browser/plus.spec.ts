import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('simulated license enables named profiles and a mixed batch with real split PDF output',async({page})=>{
 const sent:string[]=[];page.on('request',r=>{if(r.url().includes('/api/billing/'))sent.push(r.postData()??'');});
 await page.goto('/');await page.locator('#plus-open').click();await expect(page.locator('#plus-demo')).toBeVisible();
 await expect(page.locator('#batch-run')).toBeDisabled();await page.locator('#plus-demo').click();
 await expect(page.locator('#plus-status')).toContainText('Local simulation');
 await page.locator('#paper').selectOption('A4');await page.locator('#mode').selectOption('manual');
 await page.locator('#profile-name').fill('A4 two passes');await page.locator('#profile-save').click();
 await expect(page.locator('#profile-status')).toContainText('Saved');
 await page.locator('#paper').selectOption('Letter');await page.locator('#profile-apply').click();await expect(page.locator('#paper')).toHaveValue('A4');
 await page.locator('#batch-input').setInputFiles(['fixtures/A-seven-page.pdf','fixtures/E-broken.pdf','fixtures/C-one-page.pdf']);
  await page.locator('#batch-confirm').check();
 await page.locator('#batch-run').click();await expect(page.locator('#batch-status')).toContainText('2 ready · 1 error');
 const downloadPromise=page.waitForEvent('download');await page.locator('#batch-download').click();await (await downloadPromise).saveAs('output/plus/browser-batch.zip');
 expect(sent.join('\n')).not.toContain('A-seven-page');expect(sent.join('\n')).not.toContain('%PDF');
 expect(await page.evaluate(()=>localStorage.getItem('ppp-plus-profiles-v1'))).toBeNull();
 await page.setViewportSize({width:360,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('#plus *')).map(el=>({tag:el.tagName,id:el.id,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth+1)))).toBe(true);
 await page.screenshot({path:'output/plus/plus-mobile.png',fullPage:true});
});
test('settings changes and cancellation invalidate batches; free exports still work after deactivation',async({page})=>{
 await page.goto('/');await page.locator('#plus-open').click();await page.locator('#plus-demo').click();
  await page.locator('#batch-confirm').check();
 await page.locator('#batch-input').setInputFiles('fixtures/A-seven-page.pdf');await page.locator('#batch-run').click();await expect(page.locator('#batch-download')).toBeEnabled();
 await page.locator('#paper').selectOption('A4');await expect(page.locator('#batch-download')).toBeDisabled();
 await page.locator('#batch-input').setInputFiles('fixtures/A-120-page.pdf');await page.locator('#batch-run').click();await page.locator('#batch-cancel').click();
 await expect(page.locator('#batch-status')).toContainText('Cancelled');await expect(page.locator('#batch-download')).toBeDisabled();
 await page.locator('#plus-signout').click();await expect(page.locator('#batch-run')).toBeDisabled();
 await page.locator('#sample').click();await expect(page.locator('#export-full')).toBeEnabled();
});
test('profiles and licenses persist only by explicit choice, import errors preserve profiles, and clearing restores privacy',async({page})=>{
 await page.goto('/');await page.locator('#plus-open').click();await page.locator('#plus-demo').click();
 await page.locator('#profile-name').fill('My path');await page.locator('#profile-save').click();
 await page.locator('#profiles-remember').check();await page.locator('#access-remember').check();
 await page.reload();await page.locator('#plus-open').click();await expect(page.locator('#plus-signout')).toBeEnabled();
 await expect(page.locator('#profile-select')).toContainText('My path');
 await page.locator('#profiles-input').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":99}')});
 await expect(page.locator('#profile-status')).toContainText('Could not');await expect(page.locator('#profile-select')).toContainText('My path');
 await page.locator('#profiles-clear').click();await expect(page.locator('#profile-select option')).toHaveCount(0);
 await page.locator('#plus-signout').click();
 await expect(page.locator('#plus-status')).toContainText('Signed out');
 expect(await page.evaluate(()=>[localStorage.getItem('ppp-plus-profiles-v1'),localStorage.getItem('ppp-plus-access-v1')])).toEqual([null,null]);
});
test('a late device deactivation cannot erase a newer activation',async({page})=>{
 await page.goto('/');await page.locator('#plus-open').click();await page.locator('#plus-demo').click();await expect(page.locator('#plus-status')).toContainText('Local simulation active');
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let seen!:()=>void;const started=new Promise<void>(resolve=>seen=resolve);
 await page.route('**/api/billing/access/logout',async route=>{seen();await gate;await route.continue();});
 await page.locator('#plus-signout').click();await started;await page.locator('#plus-demo').click();await expect(page.locator('#plus-status')).toContainText('Local simulation active');release();
 await page.waitForResponse(response=>response.url().includes('/api/billing/access/logout'));await expect(page.locator('#plus-status')).toContainText('Local simulation active');await expect(page.locator('#batch-input')).toBeEnabled();
});
test('pricing, terms, refunds and opened Plus are readable and accessible on mobile',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 for(const route of ['/pricing/','/terms/','/refunds/']){await page.goto(route);await expect(page.locator('h1')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);}
 await page.goto('/');await page.locator('#plus-open').click();await page.locator('#plus-demo').click();await expect(page.locator('#plus-status')).toContainText('Local simulation active');expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.setViewportSize({width:1440,height:1000});await page.locator('#plus').screenshot({path:'output/plus/plus-desktop.png'});
});

test('the pricing anchor opens Plus and an entirely invalid batch still downloads its error report',async({page})=>{
 await page.goto('/pricing/');await page.getByRole('link',{name:'Open the Plus panel'}).click();
 await expect(page.locator('#plus-demo')).toBeVisible();await page.locator('#plus-demo').click();await expect(page.locator('#batch-input')).toBeEnabled();
 await page.locator('#batch-confirm').check();await page.locator('#batch-input').setInputFiles('fixtures/E-broken.pdf');await page.locator('#batch-run').click();
 await expect(page.locator('#batch-status')).toContainText('0 ready · 1 error');await expect(page.locator('#batch-download')).toBeEnabled();
 const waiting=page.waitForEvent('download');await page.locator('#batch-download').click();await (await waiting).saveAs('output/plus/errors-only.zip');
});
