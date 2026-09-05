// Global AudioContext Manager to handle Chrome's Autoplay & User Gesture policy reliably

let sharedAudioContext: AudioContext | null = null;
const stateChangeListeners: Array<(state: AudioContextState) => void> = [];

export function getSharedAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new AudioCtx();

    sharedAudioContext.onstatechange = () => {
      if (sharedAudioContext) {
        console.log(`[AUDIO_CONTEXT] state_change=${sharedAudioContext.state}`);
        stateChangeListeners.forEach((cb) => cb(sharedAudioContext!.state));
      }
    };
  }

  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch((err) => {
      console.warn('[AUDIO_CONTEXT] Could not resume yet (needs user gesture):', err);
    });
  }

  return sharedAudioContext;
}

// Synchronously unlock AudioContext directly inside a user click/gesture
export function unlockAudioContext(): Promise<void> {
  const ctx = getSharedAudioContext();
  if (ctx.state === 'suspended') {
    console.log('[AUDIO_CONTEXT] Unlocking via user gesture...');
    return ctx.resume();
  }
  return Promise.resolve();
}

export function subscribeAudioContextState(cb: (state: AudioContextState) => void): () => void {
  stateChangeListeners.push(cb);
  if (sharedAudioContext) {
    cb(sharedAudioContext.state);
  }
  return () => {
    const idx = stateChangeListeners.indexOf(cb);
    if (idx !== -1) stateChangeListeners.splice(idx, 1);
  };
}

// Automatically listen for first user click on window to unlock AudioContext
if (typeof window !== 'undefined') {
  const unlockOnFirstGesture = () => {
    unlockAudioContext().catch(() => {});
  };
  window.addEventListener('click', unlockOnFirstGesture, { passive: true });
  window.addEventListener('keydown', unlockOnFirstGesture, { passive: true });
  window.addEventListener('touchstart', unlockOnFirstGesture, { passive: true });
}
