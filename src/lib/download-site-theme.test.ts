import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('download site theme styles', () => {
  function readDownloadSiteStylesheet() {
    return readFileSync(
      path.join(process.cwd(), 'download-site', 'assets', 'app.css'),
      'utf8'
    );
  }

  it('routes page and surface backgrounds through theme variables', () => {
    const stylesheet = readDownloadSiteStylesheet();

    expect(stylesheet).toMatch(
      /html\s*\{[\s\S]*background:\s*var\(--page-background\);/
    );
    expect(stylesheet).toMatch(
      /\.release-section--secondary\s*\{[\s\S]*background:\s*var\(--surface-secondary\);/
    );
    expect(stylesheet).toMatch(
      /\.asset-item\s*\{[\s\S]*background:\s*var\(--asset-surface\);/
    );
  });

  it('defines dedicated dark theme surface tokens', () => {
    const stylesheet = readDownloadSiteStylesheet();

    expect(stylesheet).toMatch(
      /html\[data-theme='dark'\]\s*\{[\s\S]*--page-background:/
    );
    expect(stylesheet).toMatch(
      /html\[data-theme='dark'\]\s*\{[\s\S]*--surface-secondary:/
    );
    expect(stylesheet).toMatch(
      /html\[data-theme='dark'\]\s*\{[\s\S]*--asset-surface:/
    );
  });
});
