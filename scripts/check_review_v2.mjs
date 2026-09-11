import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome'});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5174/benchmark/review-v2.html');
 await page.waitForSelector('article');assert.equal(await page.locator('article').count(),40);
 assert.equal(await page.getByLabel('Shot 1 size',{exact:true}).inputValue(),'Not applicable');
 assert.equal(await page.getByLabel('Shot 1 size',{exact:true}).isDisabled(),true);
 await page.locator('article').first().getByText('Reviewed and confirmed').click();
 assert.match(await page.locator('#count').textContent(),/^1\/40/);
 await page.getByLabel('Shot 1 content',{exact:true}).selectOption('People');
 assert.equal(await page.getByLabel('Shot 1 size',{exact:true}).inputValue(),'Unknown');
 assert.match(await page.locator('#count').textContent(),/^0\/40/);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export revised review'}).click();
 assert.equal((await download).suggestedFilename(),'editmap-review-v2.json');
 await page.reload();assert.equal(await page.getByLabel('Shot 1 content',{exact:true}).inputValue(),'People');
 assert.deepEqual(errors,[]);console.log('PASS: 40 cards, text constraint, edit invalidation, persistence, export, no page errors.');
} finally {await browser.close();}
