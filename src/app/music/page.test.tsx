import { render, screen } from '@testing-library/react';

jest.mock('@/features/music/app/MusicPageShell', () => ({
  __esModule: true,
  default: () => <div>music-shell-root</div>,
}));

describe('MusicPage', () => {
  it('renders the rebuilt music shell when web music is enabled', async () => {
    const MusicPage = (await import('./page')).default;
    render(<MusicPage />);

    expect(await screen.findByText('music-shell-root')).toBeInTheDocument();
  });
});
