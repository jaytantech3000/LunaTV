import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { AppRuntimeConfig } from '@/lib/runtime-config';
import { getRuntimeConfig } from '@/lib/runtime-config';

import MusicPage from './page';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

jest.mock('@/components/music/MusicPageClient', () => ({
  __esModule: true,
  default: () => <div>music-page-client</div>,
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

const mockGetRuntimeConfig = getRuntimeConfig as jest.MockedFunction<
  typeof getRuntimeConfig
>;

function buildRuntimeConfig(config: AppRuntimeConfig = {}): AppRuntimeConfig {
  return config;
}

describe('MusicPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRuntimeConfig.mockReturnValue(
      buildRuntimeConfig({
        ENABLE_WEB_MUSIC: false,
      })
    );
  });

  it('explains that the music entry is disabled by runtime config instead of missing data support', async () => {
    render(<MusicPage />);

    expect(
      await screen.findByRole('heading', {
        name: '音乐模块暂未对当前运行环境开放',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/管理员可在站点设置中开启“网页音乐”开关/)
    ).toBeInTheDocument();
    expect(screen.getByText(/当前已支持网易云真实数据/)).toBeInTheDocument();
  });
});
