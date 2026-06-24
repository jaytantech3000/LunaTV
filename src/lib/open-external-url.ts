'use client';

import {
  isDesktopTauriRuntimeAvailable,
  openDesktopExternalUrl,
} from '@/lib/desktop/tauri-client';
import { isDesktopAppTarget } from '@/lib/runtime-config';

function fallbackOpenInBrowser(url: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openExternalUrl(url: string) {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return;
  }

  if (isDesktopAppTarget() && isDesktopTauriRuntimeAvailable()) {
    try {
      await openDesktopExternalUrl(normalizedUrl);
      return;
    } catch {
      // Fall back to the web path if the desktop bridge is unavailable.
    }
  }

  fallbackOpenInBrowser(normalizedUrl);
}
