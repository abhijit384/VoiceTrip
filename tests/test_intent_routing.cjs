const http = require('http');

async function sendChat(message, sessionId = 'default', generationId = 'gen_1') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      session_id: sessionId,
      message: message,
      generation_id: generationId,
    });

    const req = http.request(
      'http://127.0.0.1:8000/api/chat',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function executeTool(toolName, args, sessionId = 'default', generationId = 'gen_1') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      ...args,
      session_id: sessionId,
      generation_id: generationId,
    });

    const req = http.request(
      `http://127.0.0.1:8000/api/tools/${toolName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function resetSession(sessionId = 'default') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:8000/api/chat/reset?session_id=${sessionId}`,
      { method: 'POST' },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('======================================================================');
  console.log('VOICETRIP INTENT ROUTING & SAFETY VERIFICATION SUITE');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;

  function assertTest(name, condition, details) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] Test ${total}: ${name}`);
      if (details) console.log(`   -> ${details}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      if (details) console.error(`   -> ${details}`);
    }
  }

  // GROUP 1: NON-TRAVEL INTENTS (1-9)
  const nonTravelTests = [
    { input: 'hello', expectedIntent: 'greeting', name: '"hello"' },
    { input: 'hi', expectedIntent: 'greeting', name: '"hi"' },
    { input: 'good morning', expectedIntent: 'greeting', name: '"good morning"' },
    { input: 'how are you?', expectedIntent: 'conversational', name: '"how are you?"' },
    { input: 'what can you do?', expectedIntent: 'conversational', name: '"what can you do?"' },
    { input: 'what is Python?', expectedIntent: 'conversational', name: '"what is Python?"' },
    { input: 'tell me a joke', expectedIntent: 'conversational', name: '"tell me a joke"' },
    { input: 'thanks', expectedIntent: 'conversational', name: '"thanks"' },
    { input: 'bye', expectedIntent: 'conversational', name: '"bye"' },
  ];

  console.log('--- SECTION 1: NON-TRAVEL TESTS ---');
  for (const t of nonTravelTests) {
    const sId = `session_nontravel_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const res = await sendChat(t.input, sId, 'gen_1');
    const b = res.body;
    const isDirectText = b.response_type === 'text';
    const noTools = !b.tool_calls || b.tool_calls.length === 0;
    const hasSpokenContent = typeof b.text === 'string' && b.text.length > 5;
    const isNotTravel = b.canonical_context ? ['greeting', 'conversational'].includes(b.canonical_context.intent) : true;

    assertTest(
      `Non-Travel: ${t.name}`,
      isDirectText && noTools && hasSpokenContent && isNotTravel,
      `type: ${b.response_type}, tools: ${b.tool_calls?.length || 0}, intent: ${b.canonical_context?.intent || 'none'}, text: "${b.text?.slice(0, 60)}..."`
    );
  }

  // GROUP 2: TRAVEL REQUESTS (10-13)
  console.log('\n--- SECTION 2: TRAVEL REQUEST TESTS ---');
  const travelTests = [
    {
      input: 'find hotels in Delhi',
      expectedTool: 'search_hotels',
      expectedIntent: 'hotel_search',
      name: '"find hotels in Delhi"',
    },
    {
      input: 'flights from Kolkata to Delhi',
      expectedTool: 'search_flights',
      expectedIntent: 'flight_search',
      name: '"flights from Kolkata to Delhi"',
    },
    {
      input: 'show trains from Kolkata to Delhi',
      expectedTool: 'search_trains',
      expectedIntent: 'train_search',
      name: '"show trains from Kolkata to Delhi"',
    },
    {
      input: 'bus from Mumbai to Pune',
      expectedTool: 'get_route_options',
      expectedIntent: 'route_search',
      name: '"bus from Mumbai to Pune"',
    },
  ];

  for (const t of travelTests) {
    const sId = `session_travel_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const res = await sendChat(t.input, sId, 'gen_1');
    const b = res.body;
    const isToolCall = b.response_type === 'tool_call';
    const toolMatch = b.tool_calls && b.tool_calls.length > 0 && b.tool_calls[0].name === t.expectedTool;
    const intentMatch = b.canonical_context && b.canonical_context.intent === t.expectedIntent;

    assertTest(
      `Travel Request: ${t.name}`,
      isToolCall && toolMatch && intentMatch,
      `type: ${b.response_type}, tool: ${b.tool_calls?.[0]?.name}, intent: ${b.canonical_context?.intent}`
    );
  }

  // GROUP 3: FOLLOW-UP TESTS (14-15)
  console.log('\n--- SECTION 3: TRAVEL FOLLOW-UP TESTS ---');
  {
    // 14. After hotel search: "show cheaper ones"
    const sId = `session_followup_hotel_${Date.now()}`;
    await sendChat('find hotels in Delhi', sId, 'gen_1');
    const fuRes = await sendChat('show cheaper ones', sId, 'gen_2');
    const b = fuRes.body;
    const isHotel = b.canonical_context && b.canonical_context.intent === 'hotel_search';
    const isFollowUp = b.canonical_context && b.canonical_context.request_type === 'FOLLOW_UP';
    const hasCheapestSort = b.canonical_context && (b.canonical_context.sort_by === 'cheapest' || b.tool_calls?.[0]?.arguments?.sort_by === 'cheapest');

    assertTest(
      'Follow-Up 1: Hotel search -> "show cheaper ones"',
      isHotel && isFollowUp && (b.response_type === 'tool_call' || b.response_type === 'text'),
      `intent: ${b.canonical_context?.intent}, request_type: ${b.canonical_context?.request_type}, sort_by: ${b.canonical_context?.sort_by}`
    );
  }

  {
    // 15. After flight search: "what about tomorrow?"
    const sId = `session_followup_flight_${Date.now()}`;
    await sendChat('flights from Kolkata to Delhi', sId, 'gen_1');
    const fuRes = await sendChat('what about tomorrow?', sId, 'gen_2');
    const b = fuRes.body;
    const isFlight = b.canonical_context && b.canonical_context.intent === 'flight_search';
    const isFollowUp = b.canonical_context && b.canonical_context.request_type === 'FOLLOW_UP';
    const preservedDest = b.canonical_context && b.canonical_context.destination === 'Delhi';

    assertTest(
      'Follow-Up 2: Flight search -> "what about tomorrow?"',
      isFlight && isFollowUp && preservedDest,
      `intent: ${b.canonical_context?.intent}, destination: ${b.canonical_context?.destination}, date: ${b.canonical_context?.travel_date}`
    );
  }

  // GROUP 4: STATE ISOLATION & STALE RESULT PROTECTION TESTS (16-20)
  console.log('\n--- SECTION 4: STATE ISOLATION & NON-TRAVEL PURGING TESTS ---');
  {
    const sId = `session_state_${Date.now()}`;

    // 16. Search hotels in Delhi
    const r1 = await sendChat('hotels in Delhi', sId, 'gen_1');
    const b1 = r1.body;
    assertTest(
      'State Step 1: Initial travel search ("hotels in Delhi")',
      b1.response_type === 'tool_call' && b1.tool_calls?.[0]?.name === 'search_hotels',
      `tool: ${b1.tool_calls?.[0]?.name}, dest: ${b1.canonical_context?.destination}`
    );

    // 17 & 18. Say "hello" -> verify Delhi hotels do NOT reappear or trigger tools
    const r2 = await sendChat('hello', sId, 'gen_2');
    const b2 = r2.body;
    const noTools = !b2.tool_calls || b2.tool_calls.length === 0;
    const isText = b2.response_type === 'text';
    const isGreeting = b2.canonical_context?.intent === 'greeting' || !b2.canonical_context?.destination;
    const noStaleSpeech = !b2.text?.toLowerCase().includes('hotel') && !b2.text?.toLowerCase().includes('delhi');

    assertTest(
      'State Step 2: Say "hello" after travel search -> NO hotel tools or stale hotel speech',
      isText && noTools && isGreeting && noStaleSpeech,
      `response_type: ${b2.response_type}, tools: ${b2.tool_calls?.length || 0}, text: "${b2.text}"`
    );

    // 19. Ask a general question -> verify no travel tools appear
    const r3 = await sendChat('what is Python?', sId, 'gen_3');
    const b3 = r3.body;
    const isPyText = b3.response_type === 'text';
    const noPyTools = !b3.tool_calls || b3.tool_calls.length === 0;
    const mentionsPython = b3.text?.toLowerCase().includes('python') || b3.text?.toLowerCase().includes('programming');

    assertTest(
      'State Step 3: Ask "what is Python?" -> general conversational answer, NO travel cards',
      isPyText && noPyTools && mentionsPython,
      `response_type: ${b3.response_type}, text: "${b3.text?.slice(0, 70)}..."`
    );

    // 20. Then make a new travel request and verify travel search still works
    const r4 = await sendChat('flights from Mumbai to Goa', sId, 'gen_4');
    const b4 = r4.body;
    const isNewFlight = b4.response_type === 'tool_call' && b4.tool_calls?.[0]?.name === 'search_flights';

    assertTest(
      'State Step 4: New travel request ("flights from Mumbai to Goa") -> works normally',
      isNewFlight,
      `response_type: ${b4.response_type}, tool: ${b4.tool_calls?.[0]?.name}, origin: ${b4.tool_calls?.[0]?.arguments?.origin}, dest: ${b4.tool_calls?.[0]?.arguments?.destination}`
    );
  }

  // GROUP 5: ASYNC / STALE TOOL EXECUTION TEST
  console.log('\n--- SECTION 5: ASYNC / STALE INTERRUPT PROTECTION ---');
  {
    const sId = `session_async_${Date.now()}`;

    // Start a travel search on gen_1
    const chatPromise = sendChat('find hotels in Delhi', sId, 'gen_1');
    const chatRes = await chatPromise;

    // Launch async tool call for gen_1
    const toolPromise = executeTool(
      'search_hotels',
      { destination: 'Delhi', check_in_date: 'tomorrow', nights: 2, guests: 1 },
      sId,
      'gen_1'
    );

    // Immediately send a newer conversational message with gen_2
    const newerChatRes = await sendChat('who are you?', sId, 'gen_2');

    // Wait for older tool call to finish
    const toolRes = await toolPromise;

    const isStaleDropped = toolRes.body?.status === 'stale_result_dropped' || toolRes.body?.is_stale === true || toolRes.body?.is_cancelled === true;
    const newerResValid = newerChatRes.body?.response_type === 'text' && !newerChatRes.body?.tool_calls?.length;

    assertTest(
      'Async Stale Protection: Older async tool result dropped when newer turn arrives',
      isStaleDropped && newerResValid,
      `tool status: ${toolRes.body?.status || 'completed'}, is_stale: ${toolRes.body?.is_stale}, newer response: "${newerChatRes.body?.text?.slice(0, 50)}..."`
    );
  }

  console.log('\n======================================================================');
  console.log(`TEST RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('======================================================================');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
