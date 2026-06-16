import { getHlsPlaybackConfig } from './hls-playback-config';

describe('getHlsPlaybackConfig', () => {
  it('keeps the standard online mode close to the current low-latency setup', () => {
    expect(
      getHlsPlaybackConfig({ mode: 'standard', isOfflineMode: false })
    ).toEqual({
      lowLatencyMode: true,
      maxBufferLength: 30,
      backBufferLength: 30,
      maxBufferSize: 60_000_000,
    });
  });

  it('uses a larger non-low-latency buffer for enhanced mode', () => {
    expect(
      getHlsPlaybackConfig({ mode: 'enhanced', isOfflineMode: false })
    ).toEqual({
      lowLatencyMode: false,
      maxBufferLength: 45,
      backBufferLength: 45,
      maxBufferSize: 90_000_000,
    });
  });

  it('caps the max mode at a conservative upper bound', () => {
    expect(getHlsPlaybackConfig({ mode: 'max', isOfflineMode: false })).toEqual(
      {
        lowLatencyMode: false,
        maxBufferLength: 75,
        backBufferLength: 60,
        maxBufferSize: 120_000_000,
      }
    );
  });

  it('forces offline playback back to the stable baseline regardless of mode', () => {
    expect(getHlsPlaybackConfig({ mode: 'max', isOfflineMode: true })).toEqual({
      lowLatencyMode: false,
      maxBufferLength: 30,
      backBufferLength: 30,
      maxBufferSize: 60_000_000,
    });
  });
});
