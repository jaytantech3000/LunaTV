interface ScrollLockOptions {
  freezeBody?: boolean;
  lockBody?: boolean;
  lockHtml?: boolean;
}

interface NormalizedScrollLockOptions {
  freezeBody: boolean;
  lockBody: boolean;
  lockHtml: boolean;
}

interface ScrollLockEntry {
  id: number;
  options: NormalizedScrollLockOptions;
}

interface BodyStyleSnapshot {
  left: string;
  overflow: string;
  paddingRight: string;
  position: string;
  right: string;
  top: string;
  width: string;
}

interface ScrollLockSnapshot {
  body: BodyStyleSnapshot;
  html: {
    overflow: string;
  };
}

let activeScrollLocks: ScrollLockEntry[] = [];
let bodyFrozen = false;
let frozenScrollPosition: { x: number; y: number } | null = null;
let nextScrollLockId = 0;
let originalSnapshot: ScrollLockSnapshot | null = null;

function normalizeScrollLockOptions(
  options: ScrollLockOptions
): NormalizedScrollLockOptions {
  return {
    freezeBody: options.freezeBody ?? false,
    lockBody: options.lockBody ?? true,
    lockHtml: options.lockHtml ?? false,
  };
}

function captureSnapshot(): ScrollLockSnapshot {
  return {
    body: {
      left: document.body.style.left,
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight,
      position: document.body.style.position,
      right: document.body.style.right,
      top: document.body.style.top,
      width: document.body.style.width,
    },
    html: {
      overflow: document.documentElement.style.overflow,
    },
  };
}

function applySnapshot(snapshot: ScrollLockSnapshot): void {
  document.body.style.left = snapshot.body.left;
  document.body.style.overflow = snapshot.body.overflow;
  document.body.style.paddingRight = snapshot.body.paddingRight;
  document.body.style.position = snapshot.body.position;
  document.body.style.right = snapshot.body.right;
  document.body.style.top = snapshot.body.top;
  document.body.style.width = snapshot.body.width;
  document.documentElement.style.overflow = snapshot.html.overflow;
}

function restoreScrollPosition(position: { x: number; y: number }): void {
  const restore = () => {
    window.scrollTo(position.x, position.y);
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      restore();
    });
    return;
  }

  restore();
}

function recomputeScrollLocks(): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (activeScrollLocks.length === 0) {
    const previousFrozenPosition = bodyFrozen ? frozenScrollPosition : null;

    if (originalSnapshot) {
      applySnapshot(originalSnapshot);
    }

    activeScrollLocks = [];
    bodyFrozen = false;
    frozenScrollPosition = null;
    originalSnapshot = null;

    if (previousFrozenPosition) {
      restoreScrollPosition(previousFrozenPosition);
    }

    return;
  }

  if (!originalSnapshot) {
    originalSnapshot = captureSnapshot();
  }

  const shouldFreezeBody = activeScrollLocks.some(
    ({ options }) => options.freezeBody
  );
  const shouldLockBody = activeScrollLocks.some(
    ({ options }) => options.freezeBody || options.lockBody
  );
  const shouldLockHtml = activeScrollLocks.some(
    ({ options }) => options.lockHtml
  );

  let scrollPositionToRestore: { x: number; y: number } | null = null;

  if (shouldFreezeBody && !bodyFrozen) {
    frozenScrollPosition = {
      x: window.scrollX,
      y: window.scrollY,
    };
    bodyFrozen = true;
  } else if (!shouldFreezeBody && bodyFrozen) {
    scrollPositionToRestore = frozenScrollPosition;
    frozenScrollPosition = null;
    bodyFrozen = false;
  }

  applySnapshot(originalSnapshot);

  if (shouldLockBody) {
    document.body.style.overflow = 'hidden';
  }

  if (shouldLockHtml) {
    document.documentElement.style.overflow = 'hidden';
  }

  if (shouldFreezeBody) {
    const scrollPosition = frozenScrollPosition ?? {
      x: window.scrollX,
      y: window.scrollY,
    };
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth
    );

    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollPosition.y}px`;
    document.body.style.left = `-${scrollPosition.x}px`;
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight =
      scrollbarWidth > 0
        ? `${scrollbarWidth}px`
        : originalSnapshot.body.paddingRight;
  }

  if (scrollPositionToRestore) {
    restoreScrollPosition(scrollPositionToRestore);
  }
}

export function acquireScrollLock(options: ScrollLockOptions = {}): () => void {
  if (typeof document === 'undefined') {
    return () => undefined;
  }

  const entry: ScrollLockEntry = {
    id: ++nextScrollLockId,
    options: normalizeScrollLockOptions(options),
  };

  activeScrollLocks = [...activeScrollLocks, entry];
  recomputeScrollLocks();

  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    activeScrollLocks = activeScrollLocks.filter(({ id }) => id !== entry.id);
    recomputeScrollLocks();
  };
}

export function __resetScrollLockForTests(): void {
  if (typeof document !== 'undefined' && originalSnapshot) {
    applySnapshot(originalSnapshot);
  }

  activeScrollLocks = [];
  bodyFrozen = false;
  frozenScrollPosition = null;
  originalSnapshot = null;
}
