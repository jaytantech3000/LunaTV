'use client';

import { useEffect } from 'react';

import { ensureBackgroundUpdateCheck } from '@/lib/app-update';
import { getRuntimeConfig } from '@/lib/runtime-config';

export default function DesktopUpdateBootstrap() {
  useEffect(() => {
    if (getRuntimeConfig().APP_TARGET !== 'desktop') {
      return;
    }

    ensureBackgroundUpdateCheck();
  }, []);

  return null;
}
