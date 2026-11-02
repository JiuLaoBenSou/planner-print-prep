import {test,expect} from '@playwright/test';
test('purchase access persists without a license key and email links restore another browser',async({page,browser})=>{
 await page.goto('/#plus');await expect(page.locator('#access-email')).toBeVisible();await expect(page.locator('#plus-key')).toHaveCount(0);
 await page.locator('#plus-demo').click();await expect(page.locator('#plus-status')).toContainText('Local simulation active');
 await page.reload();await expect(page.locator('#plus-signout')).toBeEnabled();await expect(page.locator('#batch-input')).toBeEnabled();
 await page.locator('#access-email').fill('demo@example.test');await page.locator('#access-request').click();await expect(page.locator('#restore-demo-link')).toBeVisible();
 const url=await page.locator('#restore-demo-link').getAttribute('href');const context=await browser.newContext(),other=await context.newPage();await other.goto(url!);
 await expect(other.locator('#plus-status')).toContainText('Local simulation active');expect(other.url()).not.toContain('restore=');await expect(other.locator('#batch-input')).toBeEnabled();
 await other.goto(url!);await expect(other.locator('#plus-status')).toContainText('already used');
 await page.locator('#plus-signout').click();await expect(page.locator('#batch-input')).toBeDisabled();expect(await page.evaluate(()=>localStorage.getItem('ppp-plus-access-v1'))).toBeNull();
 await page.locator('#sample').click();await expect(page.locator('#export-full')).toBeEnabled();await context.close();
});
test('unverified return parameters cannot activate Plus and opt-out keeps access in memory only',async({page})=>{
 await page.goto('/?checkout_id=fake&success=true#plus');await expect(page.locator('#plus-demo')).toBeVisible();await expect(page.locator('#batch-input')).toBeDisabled();
 await page.locator('#access-remember').uncheck();await page.locator('#plus-demo').click();await expect(page.locator('#batch-input')).toBeEnabled();
 expect(await page.evaluate(()=>localStorage.getItem('ppp-plus-access-v1'))).toBeNull();await page.reload();await expect(page.locator('#batch-input')).toBeDisabled();
});
test('checkout retries reuse the same request; returning waits for confirmation before activating',async({page})=>{
 const response=await page.request.post('http://127.0.0.1:4178/api/billing/access/demo',{headers:{origin:'http://127.0.0.1:4176'},data:{email:'return@example.test'}});const access=await response.json();
 let claim:{requestId:string;claimSecret:string}|undefined,checkoutCalls=0;
 await page.route('**/api/billing/config',route=>route.fulfill({json:{mode:'test',canPurchase:true,accessEnabled:true}}));
 await page.route('**/api/billing/checkout',async route=>{const body=route.request().postDataJSON();if(claim)expect(body).toEqual(claim);else claim=body;checkoutCalls++;await route.fulfill(checkoutCalls===1?{status:503,json:{error:'Temporary checkout outage'}}:{json:{url:'https://www.creem.io/test/payment/ppp-test-only',mode:'test'}});});
 await page.route('https://www.creem.io/test/payment/ppp-test-only',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><h1>Simulated hosted checkout — no charge</h1>'}));
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let calls=0;
 await page.route('**/api/billing/access/claim',async route=>{expect(route.request().postDataJSON()).toEqual(claim);calls++;if(calls===1){await route.fulfill({json:{pending:true},status:202});return;}await gate;await route.fulfill({json:access});});
 await page.goto('/#plus');await expect(page.locator('#plus-buy')).toBeEnabled();await page.locator('#plus-buy').click();await expect(page.locator('#access-retry')).toBeVisible();await page.locator('#access-retry').click();await expect(page.getByRole('heading',{name:'Simulated hosted checkout — no charge',exact:true})).toBeVisible();
 await page.goto('http://127.0.0.1:4176/#plus');await expect(page.locator('#plus-status')).toContainText('Confirming your payment');await expect(page.locator('#batch-input')).toBeDisabled();
 release();await expect(page.locator('#batch-input')).toBeEnabled();expect(await page.evaluate(()=>sessionStorage.getItem('ppp-plus-checkout-v1'))).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('ppp-plus-access-v1'))).not.toBeNull();expect(checkoutCalls).toBe(2);
});
