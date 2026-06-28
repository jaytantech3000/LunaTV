import { render, screen } from '@testing-library/react';

jest.mock('@/features/music/app/MusicPageShell', () => ({
  __esModule: true,
  default: () => <div>music-shell-root</div>,
}));

interface MusicPageModule {
  default: () => JSX.Element;
}

async function importMusicPage(): Promise<MusicPageModule> {
  const modulePath = './page';
  return (await import(modulePath)) as MusicPageModule;
}

describe('MusicPage', () => {
  it('renders the rebuilt music shell when web music is enabled', async () => {
    const MusicPage = (await importMusicPage()).default;
    render(<MusicPage />);

    expect(await screen.findByText('music-shell-root')).toBeInTheDocument();
  });
});
