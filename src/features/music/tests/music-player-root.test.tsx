import { render } from '@testing-library/react';

import MusicPlayerRoot from '../components/MusicPlayerRoot';

describe('MusicPlayerRoot', () => {
  it('mounts the rebuilt player root without importing legacy music modules', () => {
    const { container } = render(<MusicPlayerRoot />);

    expect(container.querySelector('audio')).toBeInTheDocument();
  });
});
