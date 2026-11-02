import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const versions=[['teaching','Print-ready. Class-ready.'],['study','Your plans. Your paper.'],['home','A little space for everyday life.'],['pop','BIG PLANS. RIGHT FIT.'],['github','Resize planner PDFs for printing.']] as const;
for(const [ui,title] of versions)test(`${ui}: usable desktop/mobile design with real PDF export`,async({page})=>{
  await mkdir('output/ui-variants',{recursive:true});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:1050});await page.goto('/?ui='+ui);
  await expect(page.locator('body')).toHaveAttribute('data-ui',ui);
  await expect(page.locator('h1')).toContainText(title);
  await page.screenshot({path:`output/ui-variants/${ui}-desktop.png`,fullPage:false});
  await page.getByRole('button',{name:'Try a sample',exact:true}).click();await expect(page.locator('#export-full')).toBeEnabled();
  await page.locator('#workspace').scrollIntoViewIfNeeded();
  await page.screenshot({path:`output/ui-variants/${ui}-workspace.png`});
  const download=page.waitForEvent('download');await page.locator('#export-full').click();await(await download).saveAs(`output/ui-variants/${ui}-export.pdf`);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({width:360,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right}))))).toBe(true);
  await page.screenshot({path:`output/ui-variants/${ui}-mobile.png`,fullPage:true});
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await writeFile(`output/ui-variants/${ui}-checks.json`,JSON.stringify({ui,desktop:[1440,1050],mobile:[360,800],axeViolations:0,pageErrors:errors},null,2));
  expect(errors).toEqual([]);
});
test('changing a design preserves the selected document, settings and generated PDF',async({page})=>{
  await page.goto('/?ui=teaching');await page.locator('#pdf-input').setInputFiles('fixtures/C-one-page.pdf');await expect(page.locator('#export-full')).toBeEnabled();
  await page.getByLabel('Paper size').selectOption('A4');await expect(page.locator('#export-full')).toBeEnabled();
  for(const id of ['study','home','pop','github','teaching']){
    await page.locator(`[data-design-choice="${id}"]`).click();await expect(page.locator('body')).toHaveAttribute('data-ui',id);
    await expect(page.locator('#document-status')).toContainText('1 pages');await expect(page.getByLabel('Paper size')).toHaveValue('A4');await expect(page.locator('#export-full')).toBeEnabled();
    expect(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length)).toBe(0);
  }
  await page.locator('[data-design-choice="original"]').click();await expect(page.locator('body')).not.toHaveAttribute('data-ui');
  await expect(page.locator('#document-status')).toContainText('1 pages');await expect(page.getByLabel('Paper size')).toHaveValue('A4');await expect(page.locator('#export-full')).toBeEnabled();
});
test('comparison page links to five working directions and the original',async({page})=>{
  const r=await page.goto('/designs/');expect(r?.status()).toBe(200);
  for(const [id] of versions)await expect(page.locator(`a.button[href="/?ui=${id}"]`)).toBeVisible();
  await expect(page.getByRole('link',{name:'Original version'})).toHaveAttribute('href','/?ui=original');
  await page.setViewportSize({width:360,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('GitHub direction follows the supplied compact utility style at phone, tablet and desktop sizes',async({page})=>{
  await page.goto('/?ui=github');
  for(const width of [360,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.mouse.move(0,0);
    await expect(page.locator('.file-section .primary')).toHaveCSS('background-color','rgb(9, 105, 218)');
    await expect(page.locator('.hero-note')).not.toBeVisible();
    const actual=await page.evaluate(()=>({
      titleSize:parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),
      headingFonts:[...document.querySelectorAll('h1,h2,h3')].filter(n=>(n as HTMLElement).offsetHeight>0).map(n=>getComputedStyle(n).fontFamily),
      buttonRadius:getComputedStyle(document.querySelector('#sample')!).borderRadius,
      primaryColor:getComputedStyle(document.querySelector('.file-section .primary')!).backgroundColor,
      fits:document.documentElement.scrollWidth<=innerWidth,
    }));
    expect(actual.titleSize).toBeLessThanOrEqual(32);expect(actual.headingFonts.join(' ')).not.toMatch(/Baskerville|Georgia|Times|"serif"/i);
    expect(actual.buttonRadius).toBe('6px');expect(actual.primaryColor).toBe('rgb(9, 105, 218)');expect(actual.fits).toBe(true);
  }
  await page.keyboard.press('Tab');
  const focused=await page.locator(':focus-visible').evaluate(el=>({outline:getComputedStyle(el).outlineStyle,shadow:getComputedStyle(el).boxShadow}));
  expect(focused.outline).not.toBe('none');expect(focused.shadow).not.toBe('none');
});
