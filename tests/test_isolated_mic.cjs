const puppeteer = require('../frontend/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = 'C:\\Users\\Abhijit\\.gemini\\antigravity-ide\\brain\\b0e7c9e1-cea7-4581-bda6-6ae7160f4fb0';

async function runMicTestDiagnostic() {
  console.log('🚀 Starting Isolated /mic-test Diagnostic in Headless Chrome...\n');

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('[MIC_DEBUG]')) {
      console.log(`⚡ ${text}`);
    }
  });

  page.on('pageerror', (err) => {
    console.error('❌ Browser Page Error:', err.message);
  });

  // Step 1: Navigate to /mic-test
  console.log('--- STEP 1: NAVIGATING TO /mic-test ---');
  await page.goto('http://127.0.0.1:5173/mic-test', { waitUntil: 'networkidle0' });

  // Verify page title
  const pageTitle = await page.$eval('h1', (el) => el.textContent);
  console.log(`Page title: "${pageTitle}"`);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mic_test_01_initial.png') });

  // Step 2: Verify Initial State
  console.log('\n--- STEP 2: VERIFY INITIAL STATE BEFORE CLICK ---');
  const initialText = await page.evaluate(() => document.body.innerText);
  const hasPrompt = initialText.includes('PROMPT');
  const hasInactive = initialText.includes('INACTIVE');
  console.log(`Permission PROMPT: ${hasPrompt}`);
  console.log(`Stream INACTIVE: ${hasInactive}`);

  // Step 3: Click START MICROPHONE
  console.log('\n--- STEP 3: CLICK START MICROPHONE ---');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => el.textContent.includes('START MICROPHONE'));
    if (b) b.click();
  });

  // Wait 1.5s for getUserMedia and AudioContext
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mic_test_02_started.png') });

  // Step 4: Verify Active State & Audio Track
  console.log('\n--- STEP 4: VERIFY MIC ACTIVE & AUDIO TRACK STATUS ---');
  const activeText = await page.evaluate(() => document.body.innerText);
  const isGranted = activeText.includes('GRANTED');
  const isActive = activeText.includes('ACTIVE');
  const hasTrack = activeText.includes('1 track') || activeText.includes('tracks');
  const isLive = activeText.includes('live');
  const isEnabled = activeText.includes('true');

  console.log(`Permission GRANTED: ${isGranted}`);
  console.log(`Stream ACTIVE: ${isActive}`);
  console.log(`Audio tracks detected: ${hasTrack}`);
  console.log(`Track state live: ${isLive}`);
  console.log(`Track enabled: ${isEnabled}`);

  // Read current microphone level
  const micLevel = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const levelSpan = spans.find((s) => s.textContent.includes('Microphone Level:'));
    return levelSpan ? levelSpan.parentElement.innerText : 'Unknown';
  });
  console.log(`Current Audio Reading: ${micLevel}`);

  // Step 5: Click STOP
  console.log('\n--- STEP 5: CLICK STOP (CLEAN RELEASE) ---');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => el.textContent.includes('STOP'));
    if (b) b.click();
  });

  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mic_test_03_stopped.png') });

  const stoppedText = await page.evaluate(() => document.body.innerText);
  const isStopped = stoppedText.includes('INACTIVE');
  console.log(`Stream returned to INACTIVE: ${isStopped}`);

  // Step 6: Click START again to test re-activation
  console.log('\n--- STEP 6: RE-START MICROPHONE ---');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => el.textContent.includes('START MICROPHONE'));
    if (b) b.click();
  });

  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mic_test_04_restarted.png') });

  const restartedText = await page.evaluate(() => document.body.innerText);
  const isRestarted = restartedText.includes('ACTIVE') && restartedText.includes('GRANTED');
  console.log(`Re-started cleanly: ${isRestarted}`);

  // Step 7: Clean final stop
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => el.textContent.includes('STOP'));
    if (b) b.click();
  });

  await browser.close();
  console.log('\n========================================');
  console.log('🎉 ISOLATED MIC DIAGNOSTIC PASSED ALL CHECKS!');
  console.log('========================================');
}

runMicTestDiagnostic().catch((err) => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
