function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  if (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  ) {
    return true;
  }

  return Boolean(target.closest('[contenteditable="true"]'));
}

export function bindMusicKeyboardShortcuts(
  onTogglePlay: () => void,
  onNext: () => void
) {
  const listener = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      onTogglePlay();
    }

    if (event.code === 'ArrowRight') {
      event.preventDefault();
      onNext();
    }
  };

  window.addEventListener('keydown', listener);
  return () => window.removeEventListener('keydown', listener);
}
