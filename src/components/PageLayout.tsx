import { BackButton } from './BackButton';
import DesktopDownloadStoreSync from './DesktopDownloadStoreSync';
import DownloadSessionSync from './DownloadSessionSync';
import FollowUpdatesSync from './FollowUpdatesSync';
import GlobalRatingFilterControl from './GlobalRatingFilterControl';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import { NavigationFeedbackProvider } from './NavigationFeedbackProvider';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  const showBackButton = ['/play', '/live'].includes(activePath);

  return (
    <NavigationFeedbackProvider>
      <div className='luna-desktop-shell w-full min-h-screen overflow-x-hidden'>
        <DownloadSessionSync />
        <DesktopDownloadStoreSync />
        <FollowUpdatesSync />

        {/* 移动端头部 */}
        <MobileHeader showBackButton={showBackButton} />

        <div
          aria-hidden='true'
          className='pointer-events-none fixed inset-0 z-0 hidden md:block'
        >
          <div className='luna-backdrop-sky' />
          <div className='luna-backdrop-glow' />
          <div className='luna-backdrop-glow-secondary' />
          <div className='luna-backdrop-landscape' />
          <div className='luna-backdrop-foreground' />
          <div className='luna-backdrop-mist' />
          <div className='luna-backdrop-landscape-haze' />
          <div className='luna-backdrop-noise' />
        </div>

        {/* 主要布局容器 */}
        <div className='relative z-10 flex w-full md:grid md:min-h-screen md:grid-cols-[auto_1fr]'>
          {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
          <div className='hidden md:block'>
            <Sidebar activePath={activePath} />
          </div>

          {/* 主内容区域 */}
          <div className='min-w-0 flex-1 transition-all duration-300'>
            <div className='hidden md:flex items-center justify-between px-7 pt-5 lg:px-10'>
              <div className='flex min-h-[2.625rem] items-center'>
                {showBackButton ? (
                  <BackButton />
                ) : (
                  <div
                    aria-hidden='true'
                    className='h-[2.625rem] w-[2.625rem]'
                  />
                )}
              </div>

              <div className='flex items-center gap-[0.64rem] pr-0.5'>
                <ThemeToggle variant='ghost' />
                <GlobalRatingFilterControl variant='ghost' />
                <UserMenu variant='ghost' />
              </div>
            </div>

            {/* 主内容 */}
            <main
              className='relative flex-1 mb-14 mt-12 md:mt-0 md:min-h-0'
              style={{
                paddingBottom:
                  'calc(3.5rem + var(--music-player-safe-offset, 0px) + env(safe-area-inset-bottom))',
              }}
            >
              {children}
            </main>
          </div>
        </div>

        {/* 移动端底部导航 */}
        <div className='md:hidden'>
          <MobileBottomNav activePath={activePath} />
        </div>
      </div>
    </NavigationFeedbackProvider>
  );
};

export default PageLayout;
