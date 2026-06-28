'use client';

/* eslint-disable no-console */

import { useState } from 'react';

import { useLyricsStore } from '../state/lyrics-store';
import { useMusicAccountStore } from '../state/music-account-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicLibraryStore } from '../state/music-library-store';
import { useMusicShellStore } from '../state/music-shell-store';

function SettingsToggleButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  const { active, label, onClick } = props;

  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-[20px] border px-4 py-3 text-left text-sm font-medium transition ${
        active
          ? 'border-white/18 bg-white text-black'
          : 'border-white/10 bg-black/20 text-white/78 hover:border-white/18 hover:bg-white/[0.07] hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function SettingsMetricCard(props: {
  label: string;
  valueLabel: string;
  actionLabel?: string;
  disabled?: boolean;
  onAction?: () => void;
}): JSX.Element {
  const { actionLabel, disabled = false, label, onAction, valueLabel } = props;

  return (
    <article className='rounded-[24px] border border-white/10 bg-black/20 p-4'>
      <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
        {label}
      </div>
      <div className='mt-3 text-xl font-semibold text-white'>{valueLabel}</div>
      {actionLabel && onAction ? (
        <button
          type='button'
          disabled={disabled}
          onClick={onAction}
          className='mt-4 rounded-full border border-white/12 px-4 py-2 text-sm text-white/82 transition hover:border-white/24 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50'
        >
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}

export function MusicSettingsView() {
  const account = useMusicAccountStore((state) => state.account);
  const accountSubmitting = useMusicAccountStore((state) => state.submitting);
  const disconnectSession = useMusicAccountStore(
    (state) => state.disconnectSession
  );
  const bootstrap = useMusicDataStore((state) => state.bootstrap);
  const preferredPlaybackQuality = useMusicDataStore(
    (state) => state.preferredPlaybackQuality
  );
  const setPreferredPlaybackQuality = useMusicDataStore(
    (state) => state.setPreferredPlaybackQuality
  );
  const savedCollections = useMusicLibraryStore(
    (state) => state.savedCollections
  );
  const favoriteTracks = useMusicLibraryStore((state) => state.favoriteTracks);
  const recentTracks = useMusicLibraryStore((state) => state.recentTracks);
  const resumeTracks = useMusicLibraryStore((state) => state.resumeTracks);
  const clearSavedCollections = useMusicLibraryStore(
    (state) => state.clearSavedCollections
  );
  const clearFavoriteTracks = useMusicLibraryStore(
    (state) => state.clearFavoriteTracks
  );
  const clearRecentTracks = useMusicLibraryStore(
    (state) => state.clearRecentTracks
  );
  const clearResumeTracks = useMusicLibraryStore(
    (state) => state.clearResumeTracks
  );
  const followMode = useLyricsStore((state) => state.followMode);
  const setFollowMode = useLyricsStore((state) => state.setFollowMode);
  const themeVariant = useMusicShellStore((state) => state.themeVariant);
  const setThemeVariant = useMusicShellStore((state) => state.setThemeVariant);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const connectedNickname =
    account?.authenticated && account.profile ? account.profile.nickname : null;

  const runAction = async (
    actionKey: string,
    action: () => Promise<void>
  ): Promise<void> => {
    setBusyAction(actionKey);

    try {
      await action();
    } catch (error) {
      console.error(`执行音乐设置动作失败: ${actionKey}`, error);
    } finally {
      setBusyAction((currentAction) =>
        currentAction === actionKey ? null : currentAction
      );
    }
  };

  return (
    <div className='space-y-6'>
      <section className='rounded-[30px] border border-white/10 bg-white/[0.04] p-6'>
        <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
          Desktop preferences
        </div>
        <h2 className='mt-3 text-3xl font-semibold tracking-[-0.03em] text-white'>
          Music settings
        </h2>
        <p className='mt-3 max-w-2xl text-sm leading-7 text-white/58'>
          Tune playback quality, shell mood, lyric behavior, and local library
          hygiene for this desktop-first music rebuild.
        </p>
      </section>

      <section className='grid gap-4 lg:grid-cols-3'>
        <article className='rounded-[28px] border border-white/10 bg-black/20 p-5'>
          <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
            Playback preferences
          </div>
          <div className='mt-4 grid gap-3'>
            <SettingsToggleButton
              active={preferredPlaybackQuality === 'standard'}
              label='Use standard playback quality'
              onClick={() => setPreferredPlaybackQuality('standard')}
            />
            <SettingsToggleButton
              active={preferredPlaybackQuality === 'high'}
              label='Use high playback quality'
              onClick={() => setPreferredPlaybackQuality('high')}
            />
          </div>
        </article>

        <article className='rounded-[28px] border border-white/10 bg-black/20 p-5'>
          <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
            Shell theme
          </div>
          <div className='mt-4 grid gap-3'>
            <SettingsToggleButton
              active={themeVariant === 'midnight'}
              label='Use midnight theme'
              onClick={() => setThemeVariant('midnight')}
            />
            <SettingsToggleButton
              active={themeVariant === 'sunset'}
              label='Use sunset theme'
              onClick={() => setThemeVariant('sunset')}
            />
          </div>
        </article>

        <article className='rounded-[28px] border border-white/10 bg-black/20 p-5'>
          <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
            Lyrics follow
          </div>
          <div className='mt-4 grid gap-3'>
            <SettingsToggleButton
              active={followMode === 'auto'}
              label='Use auto lyric follow'
              onClick={() => setFollowMode('auto')}
            />
            <SettingsToggleButton
              active={followMode === 'manual'}
              label='Use manual lyric follow'
              onClick={() => setFollowMode('manual')}
            />
          </div>
        </article>
      </section>

      <section className='rounded-[28px] border border-white/10 bg-white/[0.04] p-5'>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
              Netease session
            </div>
            <div className='mt-3 text-lg font-semibold text-white'>
              {connectedNickname
                ? `Connected as ${connectedNickname}`
                : 'No Netease session connected'}
            </div>
            <div className='mt-2 text-sm text-white/52'>
              {connectedNickname
                ? 'Daily recommendations and personal FM stay available while the session is active.'
                : 'Connect a Netease session from the sidebar card to unlock daily recommendations and personal FM.'}
            </div>
          </div>
          {connectedNickname ? (
            <button
              type='button'
              disabled={accountSubmitting || busyAction === 'disconnect'}
              onClick={() => {
                void runAction('disconnect', async () => {
                  await disconnectSession();
                  await bootstrap();
                });
              }}
              className='rounded-full border border-white/12 bg-white/[0.08] px-4 py-3 text-sm font-medium text-white transition hover:border-white/24 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-50'
            >
              {accountSubmitting || busyAction === 'disconnect'
                ? 'Disconnecting Netease session'
                : 'Disconnect Netease session'}
            </button>
          ) : null}
        </div>
      </section>

      <section className='space-y-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-5'>
        <div>
          <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
            Library hygiene
          </div>
          <div className='mt-3 text-lg font-semibold text-white'>
            Keep the rebuilt desktop library lean
          </div>
        </div>
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
          <SettingsMetricCard
            label='Saved collections'
            valueLabel={`${savedCollections.length} saved collections`}
            actionLabel='Clear saved collections'
            disabled={busyAction === 'saved-collections'}
            onAction={() => {
              void runAction('saved-collections', clearSavedCollections);
            }}
          />
          <SettingsMetricCard
            label='Saved tracks'
            valueLabel={`${favoriteTracks.length} saved tracks`}
            actionLabel='Clear saved tracks'
            disabled={busyAction === 'saved-tracks'}
            onAction={() => {
              void runAction('saved-tracks', clearFavoriteTracks);
            }}
          />
          <SettingsMetricCard
            label='Recent plays'
            valueLabel={`${recentTracks.length} recent plays`}
            actionLabel='Clear recent plays'
            disabled={busyAction === 'recent-plays'}
            onAction={() => {
              void runAction('recent-plays', clearRecentTracks);
            }}
          />
          <SettingsMetricCard
            label='Continue listening'
            valueLabel={`${resumeTracks.length} continue listening`}
            actionLabel='Clear continue listening'
            disabled={busyAction === 'continue-listening'}
            onAction={() => {
              void runAction('continue-listening', clearResumeTracks);
            }}
          />
        </div>
      </section>
    </div>
  );
}
