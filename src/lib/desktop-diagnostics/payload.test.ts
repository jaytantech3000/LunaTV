import {
  normalizeDesktopDiagnosticsPayload,
  redactSensitiveText,
} from './payload';

describe('desktop diagnostics payload normalization', () => {
  it('normalizes and redacts the canonical payload', () => {
    const payload = normalizeDesktopDiagnosticsPayload({
      appVersion: 'desktop-v1',
      channel: 'Nova',
      findings: ['Bearer abc123 token leaked'],
      platform: 'macos',
      profileSyncEnabled: true,
      rawLogText:
        '\n\nBearer super-secret-token\n/Users/jay/Library/Logs/app.log\nhttps://nova.example.com/api?token=abc123\n',
      recommendations: ['Rotate password: hunter2'],
      remoteSiteOrigin: 'https://nova.example.com/api?token=abc123',
      reportPayload: {
        apiKey: 'sk-demo',
        nested: {
          cookie: 'foo=bar',
        },
      },
      summary: 'Local service failed to start',
    });

    expect(payload.channel).toBe('nova');
    expect(payload.remoteSiteOrigin).toBe('https://nova.example.com');
    expect(payload.findings).toEqual(['Bearer [REDACTED] token leaked']);
    expect(payload.recommendations).toEqual(['Rotate password: [REDACTED]']);
    expect(payload.rawLogText).toContain('Bearer [REDACTED]');
    expect(payload.rawLogText).toContain(
      '/Users/[REDACTED]/Library/Logs/app.log'
    );
    expect(payload.rawLogText).toContain(
      'https://nova.example.com/api?[REDACTED]'
    );
    expect(payload.reportPayload).toEqual({
      apiKey: '[REDACTED]',
      nested: {
        cookie: '[REDACTED]',
      },
    });
    expect(payload.rawLogSizeBytes).toBeGreaterThan(0);
    expect(payload.rawLogSha256).toHaveLength(64);
    expect(payload.errorFingerprint).toBeTruthy();
  });

  it('rejects payloads without a raw log', () => {
    expect(() =>
      normalizeDesktopDiagnosticsPayload({
        platform: 'macos',
        summary: 'Local service failed to start',
      })
    ).toThrow('rawLogText must be a string.');
  });

  it('redacts credential-like assignments in freeform text', () => {
    expect(
      redactSensitiveText(
        'password=hunter2 cookie=foo token=abc https://a:b@example.com/x?key=v'
      )
    ).toBe(
      'password=[REDACTED] cookie=[REDACTED] token=[REDACTED] https://[REDACTED]@example.com/x?[REDACTED]'
    );
  });
});
