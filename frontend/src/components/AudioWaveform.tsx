import { useMemo } from 'react';
import type { FC } from 'react';
import type { VoiceState } from '../types/voice';

interface AudioWaveformProps {
  state: VoiceState;
  barCount?: number;
  micVolume?: number; // 0 to 100 from real AudioContext
}

export const AudioWaveform: FC<AudioWaveformProps> = ({
  state,
  barCount = 28,
  micVolume = 0,
}) => {
  // Generate pseudo-random delay and base heights for organic feeling
  const bars = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => {
      // parabolic curve towards center
      const centerFactor = 1 - Math.abs(i - barCount / 2) / (barCount / 2);
      const minH = 15 + centerFactor * 25;
      const maxH = 40 + centerFactor * 55;
      const duration = 0.6 + (i % 5) * 0.15;
      const delay = (i % 7) * 0.08;
      return { minH, maxH, duration, delay };
    });
  }, [barCount]);

  // Dynamic colors based on state
  const getBarColor = () => {
    switch (state) {
      case 'listening':
        return 'bg-gradient-to-t from-cyan-500 via-sky-400 to-blue-300 shadow-[0_0_12px_rgba(56,189,248,0.6)]';
      case 'thinking':
        return 'bg-gradient-to-t from-indigo-600 via-violet-400 to-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.5)]';
      case 'tool_running':
        return 'bg-gradient-to-t from-amber-500 via-orange-400 to-yellow-300 shadow-[0_0_12px_rgba(245,158,11,0.6)]';
      case 'speaking':
        return 'bg-gradient-to-t from-emerald-500 via-teal-400 to-cyan-300 shadow-[0_0_15px_rgba(52,211,153,0.7)]';
      case 'interrupted':
        return 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)]';
      case 'idle':
      default:
        return 'bg-slate-700/60';
    }
  };

  return (
    <div className="flex items-center justify-center gap-[3px] md:gap-1.5 h-20 px-4 py-2 w-full max-w-md mx-auto">
      {bars.map((bar, idx) => {
        let height = '8px';
        let animationStyle = {};

        if (state === 'listening') {
          // If real microphone volume is available, scale height dynamically with live voice
          if (micVolume > 5) {
            const spread = Math.sin(idx * 0.5) * 15;
            const dynamicHeight = Math.min(100, Math.max(15, micVolume * 1.2 + spread));
            height = `${dynamicHeight}%`;
            animationStyle = {
              transition: 'height 0.08s ease-out',
            };
          } else {
            height = `${bar.minH}%`;
            animationStyle = {
              animationName: 'waveformAnim',
              animationDuration: `${bar.duration}s`,
              animationTimingFunction: 'ease-in-out',
              animationIterationCount: 'infinite',
              animationDirection: 'alternate',
              animationDelay: `${bar.delay}s`,
            };
          }
        } else if (state === 'speaking') {
          height = `${bar.minH}%`;
          animationStyle = {
            animationName: 'waveformAnim',
            animationDuration: `${bar.duration}s`,
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            animationDirection: 'alternate',
            animationDelay: `${bar.delay}s`,
          };
        } else if (state === 'tool_running') {
          const radarPhase = (idx % 6) * 0.15;
          height = `${20 + Math.sin(idx) * 15}%`;
          animationStyle = {
            animationName: 'radarPulse',
            animationDuration: '1.2s',
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            animationDirection: 'alternate',
            animationDelay: `${radarPhase}s`,
          };
        } else if (state === 'thinking') {
          height = `${15 + (idx % 3) * 10}%`;
          animationStyle = {
            animationName: 'thinkingRipple',
            animationDuration: '1.8s',
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            animationDirection: 'alternate',
            animationDelay: `${(idx % 4) * 0.2}s`,
          };
        } else if (state === 'interrupted') {
          height = '4px'; // instantly flatline
          animationStyle = {
            transition: 'all 0.05s ease-out',
          };
        } else {
          // idle
          if (micVolume > 10) {
            height = `${Math.min(80, micVolume)}%`;
          } else {
            height = '6px';
          }
        }

        return (
          <div
            key={idx}
            className={`w-1 md:w-1.5 rounded-full transition-all duration-150 ${getBarColor()}`}
            style={{
              height,
              ...animationStyle,
            }}
          />
        );
      })}

      <style>{`
        @keyframes waveformAnim {
          0% { height: 18%; opacity: 0.6; }
          50% { height: 85%; opacity: 1; }
          100% { height: 35%; opacity: 0.8; }
        }
        @keyframes radarPulse {
          0% { height: 15%; opacity: 0.4; }
          100% { height: 75%; opacity: 1; }
        }
        @keyframes thinkingRipple {
          0% { height: 12%; opacity: 0.5; }
          100% { height: 45%; opacity: 0.9; }
        }
      `}</style>
    </div>
  );
};
