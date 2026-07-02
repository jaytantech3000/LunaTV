import { render, screen } from '@testing-library/react';

import ConfigPage from './page';

jest.mock('@/components/ConfigPageClient', () => ({
  __esModule: true,
  default: () => <div data-testid='config-page-client' />,
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

describe('ConfigPage', () => {
  it('renders the dedicated config page shell', () => {
    render(<ConfigPage />);

    expect(screen.getByTestId('page-layout')).toBeInTheDocument();
    expect(screen.getByTestId('config-page-client')).toBeInTheDocument();
  });
});
