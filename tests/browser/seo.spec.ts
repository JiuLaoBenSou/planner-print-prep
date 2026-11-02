import {test,expect} from '@playwright/test';
const paths=['/','/about/','/contact/','/privacy/','/how-to-use/','/guides/a5-vs-half-letter/','/guides/print-planner-inserts/','/guides/duplex-alignment/'];
test('selected E is the default workspace without a design preview bar',async({page})=>{
  await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ui','github');
  await expect(page.locator('h1')).toHaveText('Resize planner PDFs for printing.');
  await expect(page.locator('.design-switcher')).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'Main',exact:true})).not.toContainText('Compare designs');
  await expect(page.locator('.trust-points')).toContainText('No account or watermark');
  await page.getByRole('button',{name:'Try a sample',exact:true}).click();await expect(page.locator('#export-full')).toBeEnabled();
  await expect(page.locator('#sheet-summary')).toContainText('4 sheets');
});
test('the adopted style and useful search content exist without JavaScript',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:360,height:800}});
  const page=await context.newPage();const titles=new Set<string>();const descriptions=new Set<string>();
  try{
    for(const path of paths){
      const response=await page.goto('http://127.0.0.1:4176'+path);expect(response?.status()).toBe(200);
      await expect(page.locator('body')).toHaveAttribute('data-ui','github');await expect(page.locator('h1')).toBeVisible();
      expect(await page.locator('h1').count()).toBe(1);
      const title=await page.title();const description=await page.locator('meta[name=description]').getAttribute('content');
      expect(titles.has(title)).toBe(false);expect(descriptions.has(description!)).toBe(false);titles.add(title);descriptions.add(description!);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content',title);
      expect(await page.locator('link[rel=canonical]').count()).toBe(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.goto('http://127.0.0.1:4176/');await expect(page.locator('.benefit-list')).toContainText('Keep usable text and vectors');
    await expect(page.locator('.faq details')).toHaveCount(6);
    await page.locator('.faq summary').filter({hasText:'white borders'}).click();await expect(page.locator('.faq details[open]')).toContainText('No. Printer margins');
    await expect(page.getByRole('link',{name:'My double-sided pages do not line up',exact:true})).toHaveAttribute('href','/guides/duplex-alignment/');
  }finally{await context.close();}
});
test('preview layouts stay separate from the default search page',async({page})=>{
  await page.goto('/?ui=original');await expect(page.locator('body')).not.toHaveAttribute('data-ui');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex,follow');
  await page.locator('[data-design-choice="github"]').click();await expect(page.locator('body')).toHaveAttribute('data-ui','github');
  await page.goto('/');await expect(page.locator('.design-switcher')).toHaveCount(0);await expect(page.locator('meta[name=robots]')).toHaveCount(0);
  await page.goto('/designs/');await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex,nofollow');
});
