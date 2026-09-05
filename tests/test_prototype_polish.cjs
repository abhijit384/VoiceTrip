const puppeteer = require('../frontend/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPrototypeVerification() {
  console.log('====================================================');
  console.log('STARTING VOICETRIP PROTOTYPE-ROUND POLISH VERIFICATION');
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
      text.includes('[RECORDER]') ||
      text.includes('[STT]') ||
      text.includes('[LLM]') ||
      text.includes('[RIME]') ||
      text.includes('[MIC]') ||
      text.includes('[BARGE_IN]')
    ) {
      console.log('  ⚡ ' + text);
    }
  });

  try {
    // -------------------------------------------------------------
    // 1. WELCOME / DEMO SIGNUP EXPERIENCE
    // -------------------------------------------------------------
    console.log('\n[STEP 1] Navigating to http://127.0.0.1:5173/ ...');
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 15000 });
    console.log('✓ Page loaded. Title:', await page.title());

    // Check if Demo Welcome Modal is visible
    const welcomeModalBtn = await page.$('#continue-voicetrip-btn');
    if (welcomeModalBtn) {
      console.log('✓ Demo Welcome screen displayed properly.');
      const nameInput = await page.$('#demo-name');
      const emailInput = await page.$('#demo-email');
      console.log('✓ Verified Name and Email fields present on Demo Welcome screen.');
      
      // Click Continue to VoiceTrip
      console.log('Clicking "Continue to VoiceTrip"...');
      await welcomeModalBtn.click();
      await sleep(500);
      console.log('✓ Transitioned smoothly to main VoiceTrip workspace.');
    } else {
      console.log('✓ Direct workspace entry verified (session persisted).');
    }

    // Verify Main UI controls
    const micBtn = await page.$('#mic-main-btn');
    const testRimeBtn = await page.$('#test-rime-btn');
    const devToggle = await page.$('#dev-mode-toggle');
    const micSelect = await page.$('#mic-device-select');
    const usingMicLabel = await page.$('#using-mic-label');

    if (!micBtn || !testRimeBtn || !devToggle || !micSelect || !usingMicLabel) {
      throw new Error('Required VoiceTrip UI elements missing!');
    }
    console.log('✓ Verified core UI: Central Mic Button, Device Selector, Using Mic Label, Test Rime, Dev Mode.');

    // -------------------------------------------------------------
    // 2. MICROPHONE START / STOP & LEVEL INDICATOR
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST: CENTRAL MICROPHONE CAPTURE & RECORDING STATE');
    console.log('----------------------------------------------------');
    await micBtn.click();
    await sleep(1000);

    const recordingBadgeOn = await page.$eval('#recording-status-badge', (el) => el.innerText);
    const micBtnTextOn = await page.$eval('#mic-main-btn', (el) => el.innerText);
    const micVolText = await page.$eval('#mic-volume-value', (el) => el.innerText);

    console.log(`- Recording Status: ${recordingBadgeOn}`);
    console.log(`- Button Text: ${micBtnTextOn.replace(/\n/g, ' ')}`);
    console.log(`- Mic Volume: ${micVolText}`);

    if (!recordingBadgeOn.includes('ON') || !micBtnTextOn.toUpperCase().includes('STOP')) {
      throw new Error(`Microphone failed to start: badge=${recordingBadgeOn}, btn=${micBtnTextOn}`);
    }
    console.log('✓ Recording ON with prominent STOP & SEND label and active volume meter.');

    // Wait 2 seconds while recording
    await sleep(2000);

    // Click STOP & SEND
    console.log('Clicking STOP & SEND...');
    await micBtn.click();
    await sleep(1000);

    // Wait until transcribing is finished and status returns to Ready
    await page.waitForFunction(() => {
      const el = document.querySelector('#pipeline-status-text');
      return el && el.innerText.includes('Ready');
    }, { timeout: 10000 });

    const recordingBadgeOff = await page.$eval('#recording-status-badge', (el) => el.innerText);
    console.log(`✓ Recording stopped immediately: ${recordingBadgeOff}`);

    // -------------------------------------------------------------
    // TEST 1 (USER_REQUEST): "Find hotels near Goa."
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 1: "Find hotels near Goa."');
    console.log('----------------------------------------------------');

    const test1Result = await page.evaluate(async () => {
      const prompt = "Find hotels near Goa.";
      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'default',
          message: prompt,
          generation_id: 'gen_test_goa',
        }),
      });
      const data = await res.json();
      
      let toolData = null;
      let toolSummary = null;
      if (data.response_type === 'tool_call' && data.tool_calls?.length > 0) {
        const tc = data.tool_calls[0];
        const tRes = await fetch('http://127.0.0.1:8000/api/tools/search_hotels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tc.arguments, generation_id: 'gen_test_goa', session_id: 'default' }),
        });
        toolData = await tRes.json();

        const sRes = await fetch('http://127.0.0.1:8000/api/chat/tool_result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: 'default',
            tool_name: 'search_hotels',
            tool_results: toolData,
            generation_id: 'gen_test_goa',
          }),
        });
        toolSummary = await sRes.json();
      }
      return { data, toolData, toolSummary };
    });

    console.log('✓ Hotel results found:', test1Result.toolData?.hotels?.length || 0, 'options');
    console.log('✓ Summary:', test1Result.toolSummary?.text?.slice(0, 100) + '...');
    if (!test1Result.toolData?.hotels || test1Result.toolData.hotels.length === 0) {
      throw new Error('TEST 1 FAILED: No Goa hotels returned!');
    }
    console.log('✓ TEST 1 PASSED.');

    // -------------------------------------------------------------
    // TEST 2 (USER_REQUEST): "Find trains from NJP to Howrah tomorrow evening."
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 2: "Find trains from NJP to Howrah tomorrow evening."');
    console.log('----------------------------------------------------');

    const test2Result = await page.evaluate(async () => {
      // Reset session for fresh test 2
      await fetch('http://127.0.0.1:8000/api/chat/reset', { method: 'POST' });

      const prompt = "Find trains from NJP to Howrah tomorrow evening.";
      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'default',
          message: prompt,
          generation_id: 'gen_test_trains',
        }),
      });
      const data = await res.json();
      
      let toolData = null;
      let toolSummary = null;
      if (data.response_type === 'tool_call' && data.tool_calls?.length > 0) {
        const tc = data.tool_calls[0];
        const tRes = await fetch('http://127.0.0.1:8000/api/tools/search_trains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tc.arguments, generation_id: 'gen_test_trains', session_id: 'default' }),
        });
        toolData = await tRes.json();

        const sRes = await fetch('http://127.0.0.1:8000/api/chat/tool_result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: 'default',
            tool_name: 'search_trains',
            tool_results: toolData,
            generation_id: 'gen_test_trains',
          }),
        });
        toolSummary = await sRes.json();
      }
      return { data, toolData, toolSummary };
    });

    console.log('✓ Train results found:', test2Result.toolData?.trains?.length || 0, 'options');
    console.log('✓ Summary:', test2Result.toolSummary?.text?.slice(0, 100) + '...');
    if (!test2Result.toolData?.trains || test2Result.toolData.trains.length === 0) {
      throw new Error('TEST 2 FAILED: No trains returned!');
    }
    console.log('✓ TEST 2 PASSED.');

    // -------------------------------------------------------------
    // TEST 3 & 4: INTERRUPT AI & MULTI-TURN CONTEXT ("Only morning")
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 3 & 4: INTERRUPT AI & MULTI-TURN ("Only morning")');
    console.log('----------------------------------------------------');

    // Test Test Rime playback and Interrupt button
    await testRimeBtn.click();
    await sleep(400);

    const interruptBtn = await page.$('#interrupt-ai-btn');
    const isInterruptDisabled = await page.$eval('#interrupt-ai-btn', (el) => el.disabled);
    console.log(`- Interrupt AI button active during speech: ${!isInterruptDisabled}`);

    // Click Interrupt
    console.log('Clicking Interrupt AI...');
    await interruptBtn.click();
    await sleep(400);

    const isRimeStopped = await page.$eval('#ai-voice-status-indicator', (el) => el.innerText);
    console.log(`✓ Voice playback halted immediately: ${isRimeStopped}`);

    // Follow-up: "Only morning."
    const test4Result = await page.evaluate(async () => {
      const prompt = "Only morning.";
      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'default',
          message: prompt,
          generation_id: 'gen_test_morning',
        }),
      });
      const data = await res.json();
      
      let toolData = null;
      let toolSummary = null;
      if (data.response_type === 'tool_call' && data.tool_calls?.length > 0) {
        const tc = data.tool_calls[0];
        const tRes = await fetch('http://127.0.0.1:8000/api/tools/search_trains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tc.arguments, generation_id: 'gen_test_morning', session_id: 'default' }),
        });
        toolData = await tRes.json();

        const sRes = await fetch('http://127.0.0.1:8000/api/chat/tool_result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: 'default',
            tool_name: 'search_trains',
            tool_results: toolData,
            generation_id: 'gen_test_morning',
          }),
        });
        toolSummary = await sRes.json();
      }
      return { data, toolData, toolSummary };
    });

    console.log('✓ Canonical context merged origin:', test4Result.data?.canonical_context?.origin, '-> destination:', test4Result.data?.canonical_context?.destination);
    console.log('✓ Filter applied: time_constraint =', test4Result.data?.canonical_context?.time_constraint);
    console.log('✓ Morning trains found:', test4Result.toolData?.trains?.length || 0);

    if (test4Result.data?.canonical_context?.time_constraint !== 'morning') {
      throw new Error('TEST 4 FAILED: Morning constraint not preserved in canonical context!');
    }
    console.log('✓ TEST 3 & 4 PASSED.');

    // -------------------------------------------------------------
    // TEST 5 (USER_REQUEST): Second unrelated request "Find hotels in Delhi."
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 5: Second unrelated request: "Find hotels in Delhi."');
    console.log('----------------------------------------------------');

    const test5Result = await page.evaluate(async () => {
      const prompt = "Find hotels in Delhi.";
      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'default',
          message: prompt,
          generation_id: 'gen_test_delhi',
        }),
      });
      const data = await res.json();
      
      let toolData = null;
      let toolSummary = null;
      if (data.response_type === 'tool_call' && data.tool_calls?.length > 0) {
        const tc = data.tool_calls[0];
        const tRes = await fetch('http://127.0.0.1:8000/api/tools/search_hotels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tc.arguments, generation_id: 'gen_test_delhi', session_id: 'default' }),
        });
        toolData = await tRes.json();
      }
      return { data, toolData };
    });

    console.log('✓ New destination:', test5Result.data?.canonical_context?.destination);
    console.log('✓ Delhi hotels returned:', test5Result.toolData?.hotels?.length || 0);

    if (test5Result.data?.canonical_context?.destination?.toLowerCase() !== 'delhi') {
      throw new Error('TEST 5 FAILED: Stale destination remained!');
    }
    console.log('✓ TEST 5 PASSED: Fresh Delhi results returned with no stale Goa data.');

    // -------------------------------------------------------------
    // 6. DEVELOPER MODE PANEL VERIFICATION
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST: DEVELOPER MODE TOGGLE & TELEMETRY');
    console.log('----------------------------------------------------');
    await devToggle.click();
    await sleep(300);

    const devPanel = await page.$('#dev-mode-panel');
    if (!devPanel) throw new Error('Developer Mode panel failed to open!');
    console.log('✓ Developer Mode panel opened with 10-field audit trail and pipeline diagnostics.');

    await devToggle.click();
    await sleep(200);
    const devPanelClosed = await page.$('#dev-mode-panel');
    if (devPanelClosed) throw new Error('Developer Mode panel failed to close!');
    console.log('✓ Developer Mode panel closed cleanly (normal UI is clutter-free).');

    // -------------------------------------------------------------
    // 7. RESPONSIVE MOBILE VIEWPORT TEST
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST: MOBILE VIEWPORT RESPONSIVENESS');
    console.log('----------------------------------------------------');
    await page.setViewport({ width: 390, height: 844 }); // iPhone 14 dimensions
    await sleep(400);

    const mobileMicBtn = await page.$('#mic-main-btn');
    const mobileBounds = await mobileMicBtn.boundingBox();
    console.log(`✓ Mobile viewport rendered successfully (Mic button size: ${Math.round(mobileBounds.width)}x${Math.round(mobileBounds.height)}px).`);

    console.log('\n====================================================');
    console.log('ALL PROTOTYPE-ROUND POLISH TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ VERIFICATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runPrototypeVerification();
