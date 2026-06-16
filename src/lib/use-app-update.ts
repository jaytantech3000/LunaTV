'use client';

import { useEffect, useState } from 'react';

import {
  ensureBackgroundUpdateCheck,
  getAppUpdateState,
  subscribeToAppUpdateState,
} from '@/lib/app-update';

export function useAppUpdateState() {
  const [updateState, setUpdateState] = useState(getAppUpdateState);

  useEffect(() => {
    ensureBackgroundUpdateCheck();
    return subscribeToAppUpdateState(setUpdateState);
  }, []);

  return updateState;
}
