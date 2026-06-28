'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import {
  BROWSER_AUTH_UPDATED_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';

import {
  type MusicAccountSummary,
  buildMusicAccountSummary,
  loadMusicAccountSummary,
} from '../services/music-account-summary';
import { useMusicAccountStore } from '../state/music-account-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicLibraryStore } from '../state/music-library-store';

interface MusicAccountCardProps {
  collapsed?: boolean;
}

type MusicAccountEntryMode = 'qr' | 'cookie';

function createFallbackSummary(): MusicAccountSummary {
  return buildMusicAccountSummary({
    authInfo: getAuthInfoFromBrowserCookie(),
    bootstrapState: null,
  });
}

function buildStatBlock(label: string, value: number) {
  return (
    <div className='rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-2'>
      <div className='text-[10px] uppercase tracking-[0.22em] text-white/35'>
        {label}
      </div>
      <div className='mt-2 text-lg font-semibold text-white'>{value}</div>
    </div>
  );
}

export function MusicAccountCard({ collapsed = false }: MusicAccountCardProps) {
  const account = useMusicAccountStore((state) => state.account);
  const accountError = useMusicAccountStore((state) => state.error);
  const accountLoading = useMusicAccountStore((state) => state.loading);
  const accountSubmitting = useMusicAccountStore((state) => state.submitting);
  const qrState = useMusicAccountStore((state) => state.qrState);
  const connectSession = useMusicAccountStore((state) => state.connectSession);
  const disconnectSession = useMusicAccountStore(
    (state) => state.disconnectSession
  );
  const hydrateAccount = useMusicAccountStore((state) => state.hydrateAccount);
  const retryQrLogin = useMusicAccountStore((state) => state.retryQrLogin);
  const startQrLogin = useMusicAccountStore((state) => state.startQrLogin);
  const stopQrLoginPolling = useMusicAccountStore(
    (state) => state.stopQrLoginPolling
  );
  const refreshHomeView = useMusicDataStore((state) => state.bootstrap);
  const favoriteCount = useMusicLibraryStore(
    (state) => state.favoriteTracks.length
  );
  const recentCount = useMusicLibraryStore(
    (state) => state.recentTracks.length
  );
  const resumeCount = useMusicLibraryStore(
    (state) => state.resumeTracks.length
  );
  const [summary, setSummary] = useState<MusicAccountSummary>(
    createFallbackSummary
  );
  const [entryMode, setEntryMode] = useState<MusicAccountEntryMode>('qr');
  const [sessionInput, setSessionInput] = useState('');

  useEffect(() => {
    let cancelled = false;

    const syncSummary = async () => {
      const nextSummary = await loadMusicAccountSummary();

      if (!cancelled) {
        setSummary(nextSummary);
      }
    };

    void syncSummary();

    const handleSummaryRefresh = () => {
      void syncSummary();
    };

    window.addEventListener(BROWSER_AUTH_UPDATED_EVENT, handleSummaryRefresh);
    window.addEventListener(
      DESKTOP_RUNTIME_UPDATED_EVENT,
      handleSummaryRefresh
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        BROWSER_AUTH_UPDATED_EVENT,
        handleSummaryRefresh
      );
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        handleSummaryRefresh
      );
    };
  }, []);

  useEffect(() => {
    void hydrateAccount();
  }, [hydrateAccount]);

  useEffect(() => {
    if (!accountLoading && account?.authenticated) {
      void refreshHomeView();
    }
  }, [account?.authenticated, accountLoading, refreshHomeView]);

  useEffect(() => {
    if (account?.authenticated) {
      if (qrState.status !== 'idle') {
        stopQrLoginPolling();
      }
      return;
    }

    if (entryMode !== 'qr') {
      if (qrState.status !== 'idle') {
        stopQrLoginPolling();
      }
      return;
    }

    if (accountLoading || accountSubmitting || !account) {
      return;
    }

    if (qrState.status === 'idle') {
      void startQrLogin();
    }
  }, [
    account,
    accountLoading,
    accountSubmitting,
    entryMode,
    qrState.status,
    startQrLogin,
    stopQrLoginPolling,
  ]);

  useEffect(
    () => () => {
      stopQrLoginPolling();
    },
    [stopQrLoginPolling]
  );

  if (collapsed) {
    return (
      <div
        aria-label={`Music profile ${summary.username}`}
        className='mt-4 flex flex-col items-center gap-2 rounded-[22px] border border-white/10 bg-white/[0.04] px-2 py-3 text-center'
        title={summary.detail}
      >
        <div className='flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.06] text-sm font-semibold tracking-[0.14em] text-white'>
          {summary.initials}
        </div>
        <div className='text-[10px] uppercase tracking-[0.18em] text-white/40'>
          {summary.statusLabel}
        </div>
      </div>
    );
  }

  return (
    <section className='mt-6 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-4 text-white'>
      <div className='flex items-start gap-3'>
        <div className='flex h-14 w-14 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.06] text-base font-semibold tracking-[0.16em] text-white'>
          {summary.initials}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='text-[11px] uppercase tracking-[0.22em] text-white/35'>
            Music profile
          </div>
          <div className='mt-2 truncate text-base font-semibold text-white'>
            {summary.username}
          </div>
          <div className='mt-1 text-sm text-emerald-200'>
            {summary.statusLabel}
          </div>
        </div>
      </div>
      <div className='mt-4 rounded-[20px] border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/72'>
        {summary.modeLabel}
      </div>
      <p className='mt-3 text-sm leading-6 text-white/56'>{summary.detail}</p>
      <div className='mt-4 grid grid-cols-3 gap-2'>
        {buildStatBlock('Saved', favoriteCount)}
        {buildStatBlock('Recent', recentCount)}
        {buildStatBlock('Resume', resumeCount)}
      </div>
      <section className='mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4'>
        <div className='text-[11px] uppercase tracking-[0.22em] text-white/35'>
          Netease account
        </div>
        {account?.authenticated && account.profile ? (
          <>
            <div className='mt-3 flex items-center justify-between gap-3'>
              <div className='min-w-0'>
                <div className='truncate text-base font-semibold text-white'>
                  {account.profile.nickname}
                </div>
                <div className='mt-1 text-sm text-emerald-200'>
                  Session connected
                </div>
              </div>
              <button
                type='button'
                onClick={() => {
                  void disconnectSession().then(() => {
                    void refreshHomeView();
                  });
                }}
                className='rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white transition hover:border-white/24 hover:bg-white hover:text-black'
              >
                {accountSubmitting ? 'Disconnecting' : 'Disconnect'}
              </button>
            </div>
            <div className='mt-3 text-sm text-white/56'>
              {`${account.playlists.length} playlists ready in the sidebar.`}
            </div>
            {account.profile.signature ? (
              <div className='mt-2 text-sm text-white/45'>
                {account.profile.signature}
              </div>
            ) : null}
          </>
        ) : entryMode === 'cookie' ? (
          <>
            <p className='mt-3 text-sm leading-6 text-white/56'>
              Paste `MUSIC_U` or a full `music.163.com` cookie to unlock your
              playlists in this desktop build.
            </p>
            <div className='mt-3 flex items-center justify-between gap-3'>
              <div className='text-xs uppercase tracking-[0.22em] text-white/35'>
                Manual fallback
              </div>
              <button
                type='button'
                onClick={() => setEntryMode('qr')}
                className='rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/72 transition hover:border-white/24 hover:bg-white/[0.08] hover:text-white'
              >
                Back to QR login
              </button>
            </div>
            <form
              className='mt-3 space-y-3'
              onSubmit={(event) => {
                event.preventDefault();

                void connectSession(sessionInput).then((connected) => {
                  if (connected) {
                    setSessionInput('');
                    void refreshHomeView();
                  }
                });
              }}
            >
              <input
                aria-label='Netease session cookie'
                value={sessionInput}
                onChange={(event) => setSessionInput(event.target.value)}
                placeholder='MUSIC_U=...'
                className='w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/28'
              />
              <button
                type='submit'
                disabled={accountSubmitting || !sessionInput.trim()}
                className='w-full rounded-[18px] bg-white px-4 py-3 text-sm font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-50'
              >
                {accountLoading || accountSubmitting
                  ? 'Connecting...'
                  : 'Connect'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className='mt-3 text-sm leading-6 text-white/56'>
              Scan with Netease Cloud Music on this Mac to sync playlists
              without pasting cookies into the desktop build.
            </p>
            <div className='mt-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-3'>
              <div className='flex aspect-square items-center justify-center overflow-hidden rounded-[18px] border border-white/10 bg-black/30'>
                {qrState.qrImageDataUrl ? (
                  <Image
                    alt='Netease QR login'
                    src={qrState.qrImageDataUrl}
                    width={320}
                    height={320}
                    unoptimized
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <div className='text-xs uppercase tracking-[0.24em] text-white/35'>
                    Preparing QR
                  </div>
                )}
              </div>
              <div className='mt-3 text-sm text-white/78'>
                {qrState.message || '正在生成二维码'}
              </div>
              <div className='mt-4 flex flex-wrap gap-2'>
                {qrState.status === 'expired' || qrState.status === 'error' ? (
                  <button
                    type='button'
                    onClick={() => {
                      void retryQrLogin();
                    }}
                    className='rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white transition hover:border-white/24 hover:bg-white hover:text-black'
                  >
                    Regenerate QR
                  </button>
                ) : null}
                <button
                  type='button'
                  onClick={() => {
                    stopQrLoginPolling();
                    setEntryMode('cookie');
                  }}
                  className='rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/72 transition hover:border-white/24 hover:bg-white/[0.08] hover:text-white'
                >
                  Use cookie instead
                </button>
              </div>
            </div>
          </>
        )}
        {accountError ? (
          <div
            role='alert'
            className='mt-3 rounded-[18px] border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100'
          >
            {accountError}
          </div>
        ) : null}
      </section>
    </section>
  );
}
