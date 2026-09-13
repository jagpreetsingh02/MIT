import {test,expect} from '@playwright/test';
test('demo investigation, filtering, export and responsive layout',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/app');await expect(page.getByText('Demo snapshot',{exact:true})).toBeVisible();
  await page.screenshot({path:`test-results/${testInfo.project.name}-overview.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Simulate ripple',exact:true}).click();
  await expect(page.getByText('Affected application paths',{exact:true})).toBeVisible();
  await expect(page.getByText(/affected ancestors · 2 services/)).toBeVisible();
  await page.screenshot({path:`test-results/${testInfo.project.name}-ripple.png`,fullPage:true});
  await page.getByRole('button',{name:'Clear simulation'}).click();
  await page.getByRole('button',{name:'View all dependencies'}).click();
  await page.getByRole('textbox',{name:'Search dependencies'}).fill('lodash');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Inspect lodash',exact:true}).click();
  await expect(page.getByRole('heading',{name:'lodash',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Simulate ripple',exact:true}).click();
  await expect(page.getByText(/3 affected ancestors · 3 services/)).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export SBOM'}).click();expect((await download).suggestedFilename()).toMatch(/\.spdx\.json$/);
  await page.reload();await expect(page.getByText('Demo snapshot',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
test('scan form invalid repository recovery',async({page})=>{
  await page.goto('/app');await expect(page.getByText('Demo snapshot',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'New scan',exact:true}).click();
  await page.getByLabel('Repository URL').fill('https://localhost/private');
  await page.getByRole('button',{name:'Start scan',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('canonical GitHub');
});
