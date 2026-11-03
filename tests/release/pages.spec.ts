import {test,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
const site=process.env.PPP_PUBLIC_URL??'http://127.0.0.1:4177/';
const canonical='https://plannerprintprep.com/';
test('published subpath loads workers, sample and real PDF export without broken requests',async({page})=>{
  const failures:string[]=[];const requests:string[]=[];
  page.on('pageerror',error=>failures.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failures.push(response.status()+' '+response.url());});
  page.on('request',request=>requests.push(request.url()));
  await page.goto(site);
  await expect(page.locator('body')).toHaveAttribute('data-ui','github');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',canonical);
  await page.getByRole('button',{name:'Try a sample',exact:true}).click();
  await expect(page.locator('#export-full')).toBeEnabled({timeout:60000});
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#export-full').click();const download=await downloadPromise;
  const pdf=await PDFDocument.load(await readFile((await download.path())!));expect(pdf.getPageCount()).toBe(8);
  expect(requests.some(url=>url===new URL('samples/planner-sample.pdf',site).href)).toBe(true);
  expect(requests.filter(url=>url.startsWith(new URL(site).origin)).every(url=>new URL(url).pathname.startsWith(new URL(site).pathname))).toBe(true);
  await page.getByRole('link',{name:'How to use',exact:true}).first().click();
  await expect(page).toHaveURL(site+'how-to-use/');
  await expect(page.locator('h1')).toContainText('How to print');
  await page.screenshot({path:process.env.PPP_PUBLIC_URL?'output/release/live-help.png':'output/release/local-help.png',fullPage:true});
  expect(failures).toEqual([]);
});
test('public pages, privacy, metadata, sitemap and mobile workspace agree',async({page,request})=>{
  for(const route of ['','about/','contact/','privacy/','how-to-use/','guides/a5-vs-half-letter/','guides/print-planner-inserts/','guides/duplex-alignment/','pricing/','terms/','refunds/']){
    const response=await page.goto(site+route);expect(response?.status()).toBe(200);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',canonical+route);
    expect(await page.locator('h1').count()).toBe(1);
  }
  await page.goto(site+'privacy/');await expect(page.locator('main')).toContainText('GitHub Pages');
  await expect(page.locator('main')).not.toContainText('no public hosting provider');
  await page.goto(site+'about/');await expect(page.locator('main')).toContainText('Check the Plus panel for checkout availability');
  const sitemap=await request.get(site+'sitemap.xml');expect(sitemap.status()).toBe(200);expect(await sitemap.text()).toContain(canonical+'privacy/');
  const robots=await request.get(site+'robots.txt');expect(robots.status()).toBe(200);expect(await robots.text()).toContain('Sitemap: '+canonical+'sitemap.xml');
  await page.setViewportSize({width:360,height:800});await page.goto(site);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#plus-open').click();await expect(page.locator('#plus-buy')).toBeDisabled();await expect(page.locator('#access-request')).toBeDisabled();await expect(page.locator('#plus-demo')).toBeHidden();await expect(page.locator('#plus-status')).toContainText('not available yet');
  await page.screenshot({path:process.env.PPP_PUBLIC_URL?'output/release/live-mobile.png':'output/release/local-mobile.png',fullPage:true});
});
