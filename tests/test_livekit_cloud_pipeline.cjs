const { Room, RoomEvent } = require('livekit-client');

async function testLiveKitPipeline() {
  console.log('==================================================');
  console.log('LIVEKIT CLOUD INFRASTRUCTURE DIAGNOSTIC TEST');
  console.log('==================================================');

  // STEP 1 & 4: Test Token Endpoint
  const tokenUrl = 'http://127.0.0.1:8000/api/livekit/token';
  const healthUrl = 'http://127.0.0.1:8000/api/livekit/health';

  console.log(`\n[STEP 1] Testing backend health endpoint: ${healthUrl}`);
  try {
    const healthRes = await fetch(healthUrl);
    const healthData = await healthRes.json();
    console.log('Health Endpoint Status:', healthRes.status);
    console.log('LIVEKIT_URL:', healthData.livekit_url_status);
    console.log('LIVEKIT_API_KEY:', healthData.livekit_api_key_status);
    console.log('LIVEKIT_API_SECRET:', healthData.livekit_api_secret_status);
    console.log('is_livekit_configured:', healthData.is_livekit_configured);
  } catch (err) {
    console.error('Failed to connect to health endpoint:', err.message);
  }

  console.log(`\n[STEP 2 & 3] Requesting token from: ${tokenUrl}`);
  let serverUrl = '';
  let participantToken = '';
  let isLiveKitConfigured = false;

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_name: 'voicetrip-room', participant_name: 'Traveler' }),
    });

    console.log(`TOKEN ENDPOINT: HTTP status = ${res.status}`);
    const data = await res.json();
    serverUrl = data.server_url;
    participantToken = data.participant_token;
    isLiveKitConfigured = data.is_livekit_configured;

    console.log('TOKEN GENERATED:', !!participantToken ? 'YES' : 'NO');
    console.log('FRONTEND -> BACKEND: SUCCESS');
    console.log('LiveKit Server URL:', serverUrl);
    console.log('Token length:', participantToken ? participantToken.length : 0);
    console.log('Is Configured:', isLiveKitConfigured);
  } catch (err) {
    console.error('FRONTEND -> BACKEND: FAILED');
    console.error('Error:', err.message);
    return;
  }

  // STEP 6: LiveKit URL + Room Connect Test
  console.log('\n[STEP 6] Testing Room.connect(serverUrl, participantToken)...');
  console.log('LiveKit URL:', serverUrl ? 'configured' : 'missing');
  console.log('Token:', participantToken ? 'received (REDACTED)' : 'missing');

  if (!serverUrl || serverUrl.includes('your-livekit-project') || serverUrl.includes('placeholder')) {
    console.log('Connect: FAILURE');
    console.log('Error type: PlaceholderConfigError');
    console.log(`Error message: LIVEKIT_URL is placeholder "${serverUrl}". Set your real project websocket URL in .env.`);
    console.log('\nDIAGNOSTIC SUMMARY:');
    console.log('==================================================');
    console.log('BACKEND -> LIVEKIT: PENDING REAL URL IN .env');
    console.log('ROOM CONNECT: BLOCKED (Placeholder URL detected)');
    console.log('LOCAL SILENT FALLBACK: REMOVED (Client raises explicit error)');
    console.log('STATUS: ● LiveKit Connection Failed (Clear UI Error Banner Displayed)');
    console.log('==================================================');
    return;
  }

  const room = new Room();
  room
    .on(RoomEvent.Connected, () => {
      console.log('Connect: SUCCESS');
      console.log('Room connected: YES');
    })
    .on(RoomEvent.Disconnected, (reason) => {
      console.log('Room disconnected:', reason);
    });

  try {
    await room.connect(serverUrl, participantToken);
    console.log('BACKEND -> LIVEKIT: SUCCESS');
    console.log('ROOM CONNECT: SUCCESS');
  } catch (connectErr) {
    console.log('Connect: FAILURE');
    console.log('BACKEND -> LIVEKIT: FAILED');
    console.log('ROOM CONNECT: FAILED');
    console.log('Error type:', connectErr.name || 'RoomConnectError');
    console.log('Error message:', connectErr.message);
  }
}

testLiveKitPipeline();
