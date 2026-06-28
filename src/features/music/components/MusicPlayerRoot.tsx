'use client';

import { useEffect, useRef } from 'react';

import { createAudioEngine } from '../services/audio-engine';

export default function MusicPlayerRoot() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    const engine = createAudioEngine(audioRef.current);
    engine.syncPosition(0);
  }, []);

  return <audio ref={audioRef} hidden preload='metadata' />;
}
