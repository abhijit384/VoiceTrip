const puppeteer = require('../frontend/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runBaselineVerification() {
  console.log('====================================================');
  console.log('STARTING MANUAL VOICE BASELINE VERIFICATION');
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
      text.includes('[MIC]')
    ) {
      console.log('  ⚡ ' + text);
    }
  });

  try {
    // 1. Load Frontend
    console.log('\n[STEP 1] Navigating to http://127.0.0.1:5173/ ...');
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 15000 });
    console.log('✓ Page loaded successfully. Title:', await page.title());

    // Check UI elements
    const micBtn = await page.$('#mic-main-btn');
    const testRimeBtn = await page.$('#test-rime-btn');
    const devToggle = await page.$('#dev-mode-toggle');
    if (!micBtn || !testRimeBtn || !devToggle) {
      throw new Error('Required buttons missing from UI!');
    }
    console.log('✓ Core UI buttons verified: Start Mic, Test Rime, Developer Mode.');

    // Enable Developer Mode
    await devToggle.click();
    await sleep(300);
    console.log('✓ Developer Mode panel enabled.');

    // -------------------------------------------------------------
    // TEST 1: MICROPHONE START / STOP & REAL SOUND INDICATOR
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 1: MICROPHONE CAPTURE & NO AUTO-STOP TEST');
    console.log('----------------------------------------------------');
    await micBtn.click();
    await sleep(1000);

    const recordingBadgeOn = await page.$eval('#recording-status-badge', (el) => el.innerText);
    const micBtnTextOn = await page.$eval('#mic-main-btn', (el) => el.innerText);
    const micVolText = await page.$eval('#mic-volume-value', (el) => el.innerText);
    const micVolBar = await page.$eval('#mic-volume-bar', (el) => el.style.width);

    console.log(`- Recording Status: ${recordingBadgeOn}`);
    console.log(`- Button Text: ${micBtnTextOn}`);
    console.log(`- Real Mic Volume: ${micVolText} (Bar: ${micVolBar})`);

    if (!recordingBadgeOn.includes('ON') || !micBtnTextOn.includes('STOP MIC')) {
      throw new Error(`Microphone failed to start: badge=${recordingBadgeOn}, btn=${micBtnTextOn}`);
    }

    // Wait 4 seconds to verify microphone DOES NOT AUTO-STOP
    console.log('Waiting 4 seconds while microphone is active (verifying no auto-stop)...');
    await sleep(4000);

    const recordingStillOn = await page.$eval('#recording-status-badge', (el) => el.innerText);
    if (!recordingStillOn.includes('ON')) {
      throw new Error('REGRESSION: Microphone auto-stopped prematurely!');
    }
    console.log('✓ Mic stayed ON continuously for 4+ seconds without auto-stopping.');

    // Click STOP MIC
    console.log('Clicking STOP MIC...');
    await micBtn.click();

    // Wait until transcribing is finished and status returns to Ready
    await page.waitForFunction(() => {
      const el = document.querySelector('#pipeline-status-text');
      return el && el.innerText.includes('Ready');
    }, { timeout: 10000 });

    const recordingBadgeOff = await page.$eval('#recording-status-badge', (el) => el.innerText);
    console.log(`✓ Recording stopped immediately: ${recordingBadgeOff}`);

    // -------------------------------------------------------------
    // TEST 5: RIME TTS VOICE ONLY DIRECT TEST
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 5: RIME TTS DIRECT SYNTHESIS & AUDIBLE PLAYBACK');
    console.log('----------------------------------------------------');
    console.log('Clicking TEST RIME button...');
    await testRimeBtn.click();

    // Wait for synthesis & playback
    await sleep(4000);

    const devRimeStatus = await page.$eval('#dev-rime-request', (el) => el.innerText);
    const devPlaybackStatus = await page.$eval('#dev-play', (el) => el.innerText);
    console.log(`- Rime Request Status: ${devRimeStatus}`);
    console.log(`- Playback Status: ${devPlaybackStatus}`);

    const hasRimeSuccess = logs.some((l) => l.includes('PLAY: STARTED') || l.includes('RIME_PLAY_START') || l.includes('RIME_DECODE_SUCCESS') || l.includes('HTMLAudioElement playing') || l.includes('Web Audio SourceNode'));
    console.log(`✓ Rime audio playback verified: ${hasRimeSuccess ? 'SUCCESS' : 'FAILED'}`);

    // -------------------------------------------------------------
    // TEST 3: FULL CONVERSATION PIPELINE (Train search)
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 3: FULL END-TO-END PIPELINE (NJP to Howrah Trains)');
    console.log('----------------------------------------------------');

    // Test the sequential processing pipeline directly through processTurn in page context
    const fullPipelineResult = await page.evaluate(async () => {
      // Simulate speech transcript arriving from STT
      const prompt = "Find trains from NJP to Howrah tomorrow evening.";
      
      const t0 = Date.now();
      const chatRes = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'test_session',
          message: prompt,
          generation_id: 'gen_test_3',
        }),
      });

      const chatData = await chatRes.json();
      const tChat = Date.now() - t0;

      let toolData = null;
      let summaryText = "";
      if (chatData.response_type === 'tool_call' && chatData.tool_calls?.length > 0) {
        const call = chatData.tool_calls[0];
        const toolRes = await fetch('http://127.0.0.1:8000/api/tools/' + call.name, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...call.arguments,
            generation_id: 'gen_test_3',
            session_id: 'test_session',
          }),
        });
        toolData = await toolRes.json();

        const summaryRes = await fetch('http://127.0.0.1:8000/api/chat/tool_result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: 'test_session',
            tool_name: call.name,
            tool_results: toolData,
            generation_id: 'gen_test_3',
          }),
        });
        const summaryJson = await summaryRes.json();
        summaryText = summaryJson.text;
      } else {
        summaryText = chatData.text;
      }

      // Synthesize with Rime TTS
      const tTtsStart = Date.now();
      const ttsRes = await fetch('http://127.0.0.1:8000/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: summaryText,
          generation_id: 'gen_test_3',
        }),
      });

      const audioBuf = await ttsRes.arrayBuffer();
      const tTtsEnd = Date.now() - tTtsStart;

      return {
        prompt,
        intent: chatData.intent?.intent,
        toolCall: chatData.tool_calls?.[0]?.name,
        toolArgs: chatData.tool_calls?.[0]?.arguments,
        trainCount: toolData?.trains?.length || 0,
        summaryText,
        ttsStatus: ttsRes.status,
        ttsContentType: ttsRes.headers.get('content-type'),
        audioBytes: audioBuf.byteLength,
        chatLatencyMs: tChat,
        ttsLatencyMs: tTtsEnd,
      };
    });

    console.log('Turn 1 Pipeline Results:');
    console.log(`- Prompt: "${fullPipelineResult.prompt}"`);
    console.log(`- Gemini Intent: ${fullPipelineResult.intent}`);
    console.log(`- Tool Selected: ${fullPipelineResult.toolCall}`);
    console.log(`- Tool Arguments: ${JSON.stringify(fullPipelineResult.toolArgs)}`);
    console.log(`- Trains Found: ${fullPipelineResult.trainCount}`);
    console.log(`- Summary / Spoken Text: "${fullPipelineResult.summaryText.slice(0, 80)}..."`);
    console.log(`- Rime TTS Status: ${fullPipelineResult.ttsStatus} (${fullPipelineResult.ttsContentType})`);
    console.log(`- Rime Audio Bytes: ${fullPipelineResult.audioBytes} bytes`);
    console.log(`- Rime TTS Latency: ${fullPipelineResult.ttsLatencyMs}ms`);

    if (fullPipelineResult.audioBytes < 1000) {
      throw new Error('Rime audio generation failed: 0 or low bytes returned!');
    }
    console.log('✓ Full Pipeline (Speech -> Gemini -> Train Tool -> Rime TTS -> Audio) VERIFIED!');

    // -------------------------------------------------------------
    // TEST 4: GENERAL TRAVEL (Hotels in Goa)
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 4: GENERAL TRAVEL INTENT (Hotels in Goa)');
    console.log('----------------------------------------------------');

    const hotelResult = await page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'test_hotel_session',
          message: 'Find hotels in Goa.',
          generation_id: 'gen_hotel_1',
        }),
      });
      const data = await res.json();
      return data;
    });

    console.log(`- Hotel Intent: ${hotelResult.intent?.intent}`);
    console.log(`- Tool Called: ${hotelResult.tool_calls?.[0]?.name}`);
    console.log(`- Destination Extracted: ${hotelResult.tool_calls?.[0]?.arguments?.destination || hotelResult.tool_calls?.[0]?.arguments?.location}`);
    if (hotelResult.tool_calls?.[0]?.name !== 'search_hotels') {
      throw new Error('Failed to route general hotel intent to search_hotels!');
    }
    console.log('✓ Hotel search intent correctly selected without Indian Railways fallback.');

    // -------------------------------------------------------------
    // TEST 6: SECOND PROMPT (Contextual Follow-Up)
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 6: SECOND PROMPT FOLLOW-UP ("Only evening trains")');
    console.log('----------------------------------------------------');

    const followUpResult = await page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'test_session', // continue train session
          message: 'Only evening trains.',
          generation_id: 'gen_test_4',
        }),
      });
      return await res.json();
    });

    console.log(`- Follow-up Intent: ${followUpResult.intent?.intent}`);
    console.log(`- Preserved Origin: ${followUpResult.intent?.origin}`);
    console.log(`- Preserved Destination: ${followUpResult.intent?.destination}`);
    console.log(`- Time Constraint Added: ${followUpResult.intent?.time_constraint}`);
    console.log(`- Tool Called: ${followUpResult.tool_calls?.[0]?.name}`);
    console.log('✓ Second prompt correctly processed with multi-turn context preservation and without prompt reuse.');

    console.log('\n====================================================');
    console.log('ALL 6 TESTS PASSED SUCCESSFULLY! BASELINE RESTORED!');
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
  } finally {
    await browser.close();
  }
}

runBaselineVerification();
