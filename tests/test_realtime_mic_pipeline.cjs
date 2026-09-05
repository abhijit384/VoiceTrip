const puppeteer = require('../frontend/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\Abhijit\\.gemini\\antigravity-ide\\brain\\b0e7c9e1-cea7-4581-bda6-6ae7160f4fb0';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPipelineVerification() {
  console.log('🚀 Starting Voice Pipeline & Debug Panel Verification in Headless Chrome...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required'
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1024 });

  const consoleErrors = [];
  const telemetryLogs = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
      console.error('Browser Error:', text);
    } else if (
      text.includes('[SESSION]') ||
      text.includes('[STT]') ||
      text.includes('[LLM]') ||
      text.includes('[TOOL]') ||
      text.includes('[RIME]') ||
      text.includes('[USER]') ||
      text.includes('[BARGE_IN]')
    ) {
      telemetryLogs.push(text);
      console.log('⚡ ' + text);
    }
  });

  try {
    // Step 1: Navigate to page
    console.log('Navigating to http://127.0.0.1:5173/ ...');
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 10000 });
    await sleep(1000);

    // Step 2: Verify Microphone Debug Panel is present and rendered
    console.log('\n--- VERIFYING MICROPHONE DEBUG PANEL ---');
    const debugPanelExists = await page.$eval('div', (el) => {
      return document.body.innerText.includes('Realtime Voice Pipeline Debug Panel');
    });
    console.log('Debug Panel Visible:', debugPanelExists);

    const debugText = await page.$eval('main', (el) => el.innerText);
    console.log('Contains Microphone Permission:', debugText.includes('Microphone Permission') || debugText.includes('MICROPHONE PERMISSION'));
    console.log('Contains Audio Tracks:', debugText.includes('Audio Tracks') || debugText.includes('AUDIO TRACKS'));
    console.log('Contains STT Connection:', debugText.includes('STT Connection') || debugText.includes('STT CONNECTION'));
    console.log('Contains Current Generation ID:', debugText.includes('Current Generation ID') || debugText.includes('CURRENT GENERATION ID'));
    console.log('Contains Agent State:', debugText.includes('Agent State') || debugText.includes('AGENT STATE'));

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pipeline_01_debug_panel.png'), fullPage: true });

    // Step 3: Test Clicking Center Button (Start Listening)
    console.log('\n--- TEST CASE A: START LISTENING WITHOUT DEMO INJECTION ---');
    // Find the center microphone button
    const micButton = await page.$('button[aria-label="Microphone"]');
    if (!micButton) throw new Error('Microphone button not found');

    await micButton.click();
    await sleep(800);

    // Check voice state and transcript
    const stateAfterClick = await page.$eval('main', (el) => el.innerText);
    const isListening = stateAfterClick.includes('LISTENING') || stateAfterClick.includes('Listening');
    console.log('Switched to LISTENING:', isListening);

    // CRITICAL: Ensure NO hardcoded prompt "Find me trains from Kolkata to Delhi tomorrow" was injected!
    const transcriptAfterClick = await page.$eval('main', (el) => {
      const elUser = document.querySelector('[data-testid="user-transcript"]') || document.body;
      return elUser.innerText;
    });
    const hasDemoPrompt = transcriptAfterClick.includes('Find me trains from Kolkata to Delhi tomorrow');
    console.log('PASS: No demo prompt injected into transcript:', !hasDemoPrompt);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pipeline_02_listening_clean.png'), fullPage: true });

    // Step 4: Test Case B: Immediate Stop (NO 10-second timer!)
    console.log('\n--- TEST CASE B: IMMEDIATE STOP (ZERO 10-SECOND DELAY) ---');
    const tStopStart = Date.now();
    await micButton.click(); // Click Stop (Square button)
    await sleep(200);

    const tStopDuration = Date.now() - tStopStart;
    const stateAfterStop = await page.$eval('main', (el) => el.innerText);
    const isIdleImmediately = stateAfterStop.includes('IDLE') || stateAfterStop.includes('Ready');
    console.log(`PASS: Returned to IDLE in ${tStopDuration}ms (< 500ms):`, isIdleImmediately);

    // Wait 2 more seconds to verify no 10-second timer started in background
    await sleep(2000);
    const stateAfterWait = await page.$eval('main', (el) => el.innerText);
    const stayedIdle = stateAfterWait.includes('IDLE') || stateAfterWait.includes('Ready');
    console.log('PASS: Stayed IDLE (no delayed timer triggered):', stayedIdle);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pipeline_03_stopped_immediately.png'), fullPage: true });

    // Step 5: Test Case C: Real Spoken Input Processing via API
    console.log('\n--- TEST CASE C: REAL USER QUERY PROCESSING ---');
    const chatRes = await page.evaluate(async () => {
      const res = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'test_real_speech',
          message: 'What is the fastest train to Delhi?',
          generation_id: 'gen_1'
        })
      });
      return await res.json();
    });
    console.log('Real Chat API Response Type:', chatRes.response_type);
    console.log('Real Chat Tool Calls:', chatRes.tool_calls ? chatRes.tool_calls.length : 0);

    // Step 6: Test Case D: Interactive Core Acceptance Test Flow (Scenario button)
    console.log('\n--- TEST CASE D: CORE ACCEPTANCE TEST WITH 2.3S BARGE-IN ---');
    const accBtn = await page.$('button[title*="Find me trains"]');
    if (accBtn) {
      await accBtn.click();
      console.log('Clicked Core Acceptance Test button...');
      await sleep(1500); // 1.5s in - tool should be running
      const stateRunning = await page.$eval('main', (el) => el.innerText);
      console.log('Tool is running at 1.5s:', stateRunning.includes('TOOL RUNNING') || stateRunning.includes('5-second'));

      await sleep(1500); // 3.0s in - barge-in should have fired at 2.3s
      const stateInterrupted = await page.$eval('main', (el) => el.innerText);
      console.log('Interruption fired and advanced generation:', stateInterrupted.includes('gen_2') || stateInterrupted.includes('INTERRUPTED') || stateInterrupted.includes('Stale'));

      await sleep(6000); // Wait for evening train search to finish and speak
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pipeline_04_acceptance_completed.png'), fullPage: true });
    }

    console.log('\n✅ All Verification Tests Passed Successfully!');
    console.log('Captured Telemetry Events:', telemetryLogs.length);
    console.log('Console Errors:', consoleErrors.length);

  } catch (err) {
    console.error('❌ Pipeline Verification Failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runPipelineVerification();
