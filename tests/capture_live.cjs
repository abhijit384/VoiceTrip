const puppeteer = require('../frontend/node_modules/puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 950 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
  const micBtn = await page.$('button[data-testid="center-mic-button"]');
  if (micBtn) await micBtn.click();
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'C:\\Users\\Abhijit\\.gemini\\antigravity-ide\\brain\\b0e7c9e1-cea7-4581-bda6-6ae7160f4fb0\\live_voice_progress_bar.png', fullPage: true });
  await browser.close();
  console.log('Screenshot captured successfully');
})();
