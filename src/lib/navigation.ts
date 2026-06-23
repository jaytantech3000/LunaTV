'use client';

export function replaceWithDocumentNavigation(path: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.replace(path);
}
