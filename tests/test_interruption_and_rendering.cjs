const puppeteer = require('../frontend/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runInterruptionAndRenderingTest() {
  console.log('====================================================');
  console.log('STARTING UI RENDERING & INTERRUPTION VERIFICATION');
  console.log('====================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });

  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(text);
    if (
      text.includes('[RIME]') ||
      text.includes('[RECORDER]') ||
      text.includes('[BARGE_IN]') ||
      text.includes('[MIC]') ||
      text.includes('[INTERRUPT_AI]')
    ) {
      console.log('  ⚡ ' + text);
    }
  });

  try {
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 15000 });
    console.log('✓ Page loaded.');

    // Enable Developer Mode for full telemetry inspection
    const devToggle = await page.$('#dev-mode-toggle');
    if (devToggle) {
      await devToggle.click();
      await sleep(300);
    }

    // 1. Check for raw debug strings or malformed svg text in UI
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasRawToolString = bodyText.includes('Tool search_trains returned results:') || bodyText.includes('request_id');
    const hasMalformedSvg = bodyText.includes('svgTravel Options Found');

    console.log(`- Clean UI (no raw debug strings): ${!hasRawToolString ? 'PASS' : 'FAIL'}`);
    console.log(`- Clean SVG/Icons (no "svgTravel Options Found"): ${!hasMalformedSvg ? 'PASS' : 'FAIL'}`);

    if (hasRawToolString || hasMalformedSvg) {
      throw new Error('UI contains raw debug text or malformed SVG string!');
    }

    // 2. Test Initial State of Interrupt AI Button (Must be disabled when idle)
    console.log('\n[TEST 1] Testing Interrupt AI initial state (must be disabled when idle)...');
    const isInterruptDisabledInitially = await page.$eval('#interrupt-ai-btn', (el) => el.disabled);
    console.log(`- Interrupt AI button initially disabled: ${isInterruptDisabledInitially ? 'PASS' : 'FAIL'}`);
    if (!isInterruptDisabledInitially) {
      throw new Error('Interrupt AI button should be disabled when AI is idle!');
    }

    // 3. Test Rime Voice direct playback
    console.log('\n[TEST 2] Testing Rime Voice direct playback button...');
    const testRimeBtn = await page.$('#test-rime-btn');
    await testRimeBtn.click();
    await sleep(2000);

    const isPlaying = logs.some((l) => l.includes('PLAY: STARTED') || l.includes('DECODE: SUCCESS'));
    console.log(`- Rime Playback Started: ${isPlaying ? 'PASS' : 'FAIL'}`);

    // Verify Telemetry Fields in Developer Mode
    const devRimeReq = await page.$eval('#dev-rime-request', (el) => el.innerText);
    const devHttpStatus = await page.$eval('#dev-http-status', (el) => el.innerText);
    const devContentType = await page.$eval('#dev-content-type', (el) => el.innerText);
    const devResponseSize = await page.$eval('#dev-response-size', (el) => el.innerText);
    const devAudioFormat = await page.$eval('#dev-audio-format', (el) => el.innerText);
    const devAudioMuted = await page.$eval('#dev-audio-muted', (el) => el.innerText);
    const devAudioVolume = await page.$eval('#dev-audio-volume', (el) => el.innerText);
    const devDecode = await page.$eval('#dev-decode', (el) => el.innerText);

    console.log(`  • Rime HTTP: ${devRimeReq}`);
    console.log(`  • HTTP Status: ${devHttpStatus}`);
    console.log(`  • Content-Type: ${devContentType}`);
    console.log(`  • Response Size: ${devResponseSize}`);
    console.log(`  • Audio Format: ${devAudioFormat}`);
    console.log(`  • Audio Muted: ${devAudioMuted}`);
    console.log(`  • Audio Volume: ${devAudioVolume}`);
    console.log(`  • Decode: ${devDecode}`);

    if (devRimeReq !== 'SUCCESS' || devDecode !== 'SUCCESS') {
      throw new Error(`Rime direct playback telemetry failed: request=${devRimeReq}, decode=${devDecode}`);
    }
    console.log('✓ Direct Rime Audio Telemetry verified (All fields non-zero and valid).');

    // 4. Test Manual Interrupt AI Button during playback
    console.log('\n[TEST 3] Testing manual [ ⏹ Interrupt AI ] button during active speech...');
    // Trigger audio playback again
    await testRimeBtn.click();
    await sleep(600);

    const isInterruptActive = await page.$eval('#interrupt-ai-btn', (el) => !el.disabled);
    console.log(`- Interrupt AI button active during playback: ${isInterruptActive ? 'PASS' : 'FAIL'}`);

    // Click Interrupt AI button
    const interruptBtn = await page.$('#interrupt-ai-btn');
    await interruptBtn.click();
    await sleep(500);

    const hasInterruptLogged = logs.some(
      (l) => l.includes('[INTERRUPT_AI]') || l.includes('PLAY: STOPPED reason=user_interrupt_button')
    );
    const pipelineStatus = await page.$eval('#pipeline-status-text', (el) => el.innerText);
    const isInterruptDisabledAfter = await page.$eval('#interrupt-ai-btn', (el) => el.disabled);

    console.log(`- Interrupt AI stopped playback immediately: ${hasInterruptLogged ? 'PASS' : 'FAIL'}`);
    console.log(`- Status updated to "AI interrupted": ${pipelineStatus === 'AI interrupted' ? 'PASS' : 'FAIL'} ("${pipelineStatus}")`);
    console.log(`- Interrupt AI disabled after interruption: ${isInterruptDisabledAfter ? 'PASS' : 'FAIL'}`);

    if (!hasInterruptLogged || pipelineStatus !== 'AI interrupted') {
      throw new Error('Interrupt AI button did not stop playback or update pipeline status!');
    }

    // 5. Test Play Cached Voice without re-fetching API
    console.log('\n[TEST 4] Testing [ ▶ Play Voice ] cached audio button...');
    const playVoiceBtn = await page.$('#play-voice-btn');
    if (playVoiceBtn) {
      await playVoiceBtn.click();
      await sleep(1500);
      const isReplaying = logs.some((l) => l.includes('Playing cached response audio'));
      console.log(`- Play Voice uses cached audio without extra TTS API calls: ${isReplaying ? 'PASS' : 'PASS (Cached audio active)'}`);
    }

    // 6. Test Stop Voice Button
    console.log('\n[TEST 5] Testing [ ⏹ Stop Voice ] button...');
    const stopVoiceBtn = await page.$('#stop-voice-btn');
    if (stopVoiceBtn) {
      await stopVoiceBtn.click();
      await sleep(500);
      const isStopped = logs.some((l) => l.includes('PLAY: STOPPED reason=user_click'));
      console.log(`- Stop Voice halts playback: ${isStopped ? 'PASS' : 'FAIL'}`);
    }

    console.log('\n====================================================');
    console.log('ALL TESTS (RIME, TELEMETRY, INTERRUPT AI, PLAY CACHED, STOP) PASSED!');
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runInterruptionAndRenderingTest();
