export function bindMusicKeyboardShortcuts(
  onTogglePlay: () => void,
  onNext: () => void
) {
  const listener = (event: KeyboardEvent) => {
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
