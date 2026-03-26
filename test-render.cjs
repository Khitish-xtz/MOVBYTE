const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));
    page.on('pageerror', err => console.error('BROWSER_ERROR:', err.message));
    
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    
    const content = await page.content();
    console.log('HTML length:', content.length);
    console.log('Body HTML:', await page.evaluate(() => document.body.innerHTML));
    
    await browser.close();
  } catch (e) {
    console.error('Puppeteer Failed:', e);
  }
})();
