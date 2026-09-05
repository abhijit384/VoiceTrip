import React, { useState } from 'react';
import { Compass, Sparkles, Mic, Volume2, ArrowRight, ShieldCheck } from 'lucide-react';

interface DemoWelcomeModalProps {
  initialName?: string;
  onContinue: (name: string, email: string) => void;
}

export const DemoWelcomeModal: React.FC<DemoWelcomeModalProps> = ({
  initialName = 'Sudipta',
  onContinue,
}) => {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialName ? `${initialName.toLowerCase().replace(/\s+/g, '')}@example.com` : 'guest@voicetrip.ai');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalName = name.trim() || 'Sudipta';
    const finalEmail = email.trim() || `${finalName.toLowerCase()}@example.com`;
    setIsSubmitting(true);
    setTimeout(() => {
      onContinue(finalName, finalEmail);
    }, 250);
  };

  const handleQuickDemo = () => {
    setName('Sudipta');
    setEmail('sudipta@voicetrip.ai');
    setIsSubmitting(true);
    setTimeout(() => {
      onContinue('Sudipta', 'sudipta@voicetrip.ai');
    }, 200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in-scale">
      <div className="relative w-full max-w-lg rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-700/60 shadow-2xl p-6 sm:p-8 flex flex-col gap-6 text-slate-100 overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header Badge */}
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-teal-400 p-0.5 shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full rounded-[14px] bg-slate-950 flex items-center justify-center text-cyan-400">
                <Compass className="w-6 h-6 animate-spin-slow" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                VoiceTrip
                <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  DEMO PROTOTYPE
                </span>
              </h1>
              <p className="text-xs text-cyan-400 font-medium tracking-wide">
                Your AI-powered voice travel companion
              </p>
            </div>
          </div>
        </div>

        {/* Supporting Pitch */}
        <div className="relative z-10 p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex flex-col gap-2">
          <p className="text-sm text-slate-300 leading-relaxed">
            Plan <strong className="text-white font-medium">trains, flights, hotels</strong> and complete journeys naturally using only your voice.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800">
              <Mic className="w-3 h-3 text-cyan-400" /> Voice-First
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800">
              <Volume2 className="w-3 h-3 text-purple-400" /> Rime Mist TTS
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800">
              <Sparkles className="w-3 h-3 text-amber-400" /> Multi-Turn Context
            </span>
          </div>
        </div>

        {/* Demo Signup Form */}
        <form onSubmit={handleSubmit} className="relative z-10 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="demo-name" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Your Name
            </label>
            <input
              id="demo-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sudipta"
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 text-slate-100 placeholder-slate-600 text-sm outline-none transition"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="demo-email" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Work / Demo Email
            </label>
            <input
              id="demo-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. sudipta@example.com"
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 text-slate-100 placeholder-slate-600 text-sm outline-none transition"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              type="submit"
              id="continue-voicetrip-btn"
              disabled={isSubmitting}
              className="w-full sm:flex-1 py-3.5 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 shadow-lg shadow-cyan-500/25 transition-all transform active:scale-95 flex items-center justify-center gap-2"
            >
              <span>Continue to VoiceTrip</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              id="try-demo-btn"
              onClick={handleQuickDemo}
              disabled={isSubmitting}
              className="w-full sm:w-auto py-3.5 px-5 rounded-xl font-medium text-xs bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60 transition flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Try Demo</span>
            </button>
          </div>
        </form>

        {/* Disclaimer / Privacy Footer */}
        <div className="relative z-10 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Demo mode • No password required
          </span>
          <span>Prototype v2.0</span>
        </div>
      </div>
    </div>
  );
};
