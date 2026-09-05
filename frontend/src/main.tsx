import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MicTestPage } from './pages/MicTestPage.tsx'

// Ensure tab title is always VoiceTrip and clear any legacy service workers on localhost
document.title = 'VoiceTrip | Realtime Voice Travel Assistant (Rime TTS)';
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  }).catch(() => {});
}

function RootRouter() {
  const [path, setPath] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const handlePop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const isMicTest = path === '/mic-test' || window.location.hash === '#/mic-test';

  return isMicTest ? <MicTestPage /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootRouter />
  </StrictMode>,
)
