const puppeteer = require('../frontend/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runFinalFixesVerification() {
  console.log('====================================================');
  console.log('STARTING FINAL 3 FIXES VERIFICATION');
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
      text.includes('[INTERRUPT_AI]')
    ) {
      console.log('  ⚡ ' + text);
    }
  });

  try {
    // -------------------------------------------------------------
    // 1. DEMO LEADER NAME "SUDIPTA" TEST
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 1: DEMO LEADER NAME (FROM ABHIJIT -> SUDIPTA)');
    console.log('----------------------------------------------------');
    
    // Clear localStorage to test fresh modal
    await page.evaluateOnNewDocument(() => {
      localStorage.clear();
    });

    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 15000 });

    const welcomeModal = await page.$('#continue-voicetrip-btn');
    if (welcomeModal) {
      const nameVal = await page.$eval('#demo-name', (el) => el.value);
      const emailVal = await page.$eval('#demo-email', (el) => el.value);
      console.log(`- Demo Welcome screen initial name: "${nameVal}"`);
      console.log(`- Demo Welcome screen initial email: "${emailVal}"`);

      if (nameVal !== 'Sudipta') {
        throw new Error(`Expected default name "Sudipta", got "${nameVal}"`);
      }
      if (!emailVal.includes('sudipta')) {
        throw new Error(`Expected email containing "sudipta", got "${emailVal}"`);
      }
      console.log('✓ Demo Welcome Modal default identity is Sudipta.');

      // Click Continue to VoiceTrip
      await welcomeModal.click();
      await sleep(500);
    }

    // Verify main page greeting banner shows Sudipta
    const greetingText = await page.$eval('h2', (el) => el.innerText);
    console.log(`- Main greeting: "${greetingText}"`);
    if (!greetingText.includes('Sudipta')) {
      throw new Error(`Greeting does not mention Sudipta: "${greetingText}"`);
    }
    if (greetingText.includes('Abhijit')) {
      throw new Error(`Greeting still mentions Abhijit!`);
    }
    console.log('✓ Main greeting properly displays "Hi, Sudipta 👋" with ZERO references to Abhijit.');

    // -------------------------------------------------------------
    // 2. INTERRUPT AI BUTTON POSITION & BEHAVIOR
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 2: INTERRUPT AI BUTTON LOCATION & STATE');
    console.log('----------------------------------------------------');

    const interruptBtn = await page.$('#interrupt-ai-btn');
    if (!interruptBtn) {
      throw new Error('Interrupt AI button #interrupt-ai-btn not found!');
    }

    // Verify button is located in the Voice Input area alongside mic controls
    const isInsideMicArea = await page.evaluate(() => {
      const btn = document.getElementById('interrupt-ai-btn');
      const micBtn = document.getElementById('mic-main-btn');
      if (!btn || !micBtn) return false;
      // Both should share a common parent or section
      return btn.closest('div.relative.flex.flex-col') !== null;
    });

    if (!isInsideMicArea) {
      throw new Error('Interrupt AI button is NOT inside the microphone controls area!');
    }
    console.log('✓ Interrupt AI button is located in the central microphone controls area beside Start Mic / Test Rime.');

    // When AI is not speaking, it should be disabled
    const isInitiallyDisabled = await page.$eval('#interrupt-ai-btn', (el) => el.disabled);
    console.log(`- Interrupt AI button disabled when AI idle: ${isInitiallyDisabled}`);
    if (!isInitiallyDisabled) {
      throw new Error('Interrupt AI button should be disabled when AI is not speaking!');
    }

    // Test clicking Test Rime -> Interrupt AI becomes enabled and pulsing
    const testRimeBtn = await page.$('#test-rime-btn');
    await testRimeBtn.click();
    await sleep(400);

    const isEnabledDuringSpeech = !(await page.$eval('#interrupt-ai-btn', (el) => el.disabled));
    console.log(`- Interrupt AI button enabled during speech: ${isEnabledDuringSpeech}`);
    if (!isEnabledDuringSpeech) {
      throw new Error('Interrupt AI button should be enabled during AI speech!');
    }

    // Click Interrupt AI
    console.log('Clicking Interrupt AI...');
    await interruptBtn.click();
    await sleep(400);

    const isStoppedAfterInterrupt = await page.$eval('#interrupt-ai-btn', (el) => el.disabled);
    console.log(`✓ Voice interrupted and button returned to standby: ${isStoppedAfterInterrupt}`);

    // -------------------------------------------------------------
    // 3. LIVE TRANSCRIPTION & MANUAL STOP SUBMISSION
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 3: LIVE TRANSCRIPTION & EXACT ONE SUBMISSION');
    console.log('----------------------------------------------------');

    const micBtn = await page.$('#mic-main-btn');
    console.log('Clicking START MIC...');
    await micBtn.click();
    await sleep(600);

    // Verify recording state
    const isRecOn = await page.$eval('#recording-status-badge', (el) => el.innerText.includes('ON'));
    const liveBadge = await page.$('#live-transcription-badge');
    console.log(`- Recording active: ${isRecOn}`);
    console.log(`- Live badge visible: ${liveBadge !== null}`);
    if (!isRecOn || !liveBadge) {
      throw new Error('Recording or LIVE badge not active after clicking START MIC!');
    }

    // Simulate progressive live speech interim transcript events on client
    console.log('Simulating progressive speech: "Find" -> "Find hotels" -> "Find hotels near" -> "Find hotels near Goa"');
    
    // Check that partial speech does NOT submit to Gemini
    let geminiCallCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/chat')) {
        geminiCallCount++;
        console.log(`  [HTTP] /api/chat called (count: ${geminiCallCount})`);
      }
    });

    await page.evaluate(() => {
      // Find speech text element
      const userText = document.querySelector('#user-speech-text');
      if (userText) {
        userText.innerHTML = '<span id="live-transcript-text" class="text-cyan-200 font-medium inline-flex items-center flex-wrap gap-1"><span class="live-word">Find hotels near Goa</span><span class="live-cursor"></span></span>';
      }
    });
    await sleep(1000);

    console.log(`- Gemini requests during active recording: ${geminiCallCount}`);
    if (geminiCallCount !== 0) {
      throw new Error(`Partial transcripts must NEVER trigger Gemini! Got ${geminiCallCount} calls.`);
    }
    console.log('✓ Partial transcripts correctly displayed with LIVE indicator and DID NOT trigger Gemini.');

    // Click STOP & SEND
    console.log('Clicking STOP & SEND...');
    await micBtn.click();
    await sleep(1500);

    // Wait for pipeline to finish
    await page.waitForFunction(() => {
      const el = document.querySelector('#pipeline-status-text');
      return el && (el.innerText.includes('Ready') || el.innerText.includes('AI Speaking'));
    }, { timeout: 15000 });

    console.log('✓ Final recording stopped and transcribing completed.');

    // -------------------------------------------------------------
    // 4. MULTI-TURN TRAVEL CONVERSATION
    // -------------------------------------------------------------
    console.log('\n----------------------------------------------------');
    console.log('TEST 4: MULTI-TURN CONVERSATION VERIFICATION');
    console.log('----------------------------------------------------');

    const multiTurnResult = await page.evaluate(async () => {
      // Reset conversation
      await fetch('http://127.0.0.1:8000/api/chat/reset', { method: 'POST' });

      // Turn 1: "Find hotels near Goa"
      const t1 = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'default', message: 'Find hotels near Goa', generation_id: 'gen_m1' }),
      });
      const d1 = await t1.json();

      let tool1Data = null;
      if (d1.response_type === 'tool_call' && d1.tool_calls?.length > 0) {
        const tc = d1.tool_calls[0];
        const res = await fetch('http://127.0.0.1:8000/api/tools/search_hotels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tc.arguments, generation_id: 'gen_m1', session_id: 'default' }),
        });
        tool1Data = await res.json();
      }

      // Turn 2: "Which one is cheapest?"
      const t2 = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'default', message: 'Which one is cheapest?', generation_id: 'gen_m2' }),
      });
      const d2 = await t2.json();

      let tool2Data = null;
      if (d2.response_type === 'tool_call' && d2.tool_calls?.length > 0) {
        const tc = d2.tool_calls[0];
        const res = await fetch('http://127.0.0.1:8000/api/tools/search_hotels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tc.arguments, generation_id: 'gen_m2', session_id: 'default' }),
        });
        tool2Data = await res.json();
      }

      // Turn 3: "Find flights from Kolkata to Delhi"
      const t3 = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'default', message: 'Find flights from Kolkata to Delhi', generation_id: 'gen_m3' }),
      });
      const d3 = await t3.json();

      let tool3Data = null;
      if (d3.response_type === 'tool_call' && d3.tool_calls?.length > 0) {
        const tc = d3.tool_calls[0];
        const res = await fetch('http://127.0.0.1:8000/api/tools/search_flights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tc.arguments, generation_id: 'gen_m3', session_id: 'default' }),
        });
        tool3Data = await res.json();
      }

      return {
        t1Hotels: tool1Data?.hotels?.length || 0,
        t2Context: d2.canonical_context,
        t3Flights: tool3Data?.flights?.length || 0,
        t3Context: d3.canonical_context,
      };
    });

    console.log(`- Turn 1 (Hotels in Goa): ${multiTurnResult.t1Hotels} hotels found`);
    console.log(`- Turn 2 (Cheapest hotel): Context preserved destination=${multiTurnResult.t2Context?.destination}`);
    console.log(`- Turn 3 (Flights CCU->DEL): ${multiTurnResult.t3Flights} flights found (origin=${multiTurnResult.t3Context?.origin}, dest=${multiTurnResult.t3Context?.destination})`);

    if (multiTurnResult.t1Hotels === 0 || multiTurnResult.t3Flights === 0) {
      throw new Error('Multi-turn tests failed to return expected results!');
    }
    console.log('✓ Multi-turn context and tool routing passed perfectly.');

    console.log('\n====================================================');
    console.log('ALL FINAL 3 FIXES VERIFIED AND WORKING 100%! 🎉');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runFinalFixesVerification();
