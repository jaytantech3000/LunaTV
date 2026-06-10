import { BackButton } from './BackButton';
import DesktopDownloadStoreSync from './DesktopDownloadStoreSync';
import DownloadSessionSync from './DownloadSessionSync';
import GlobalRatingFilterControl from './GlobalRatingFilterControl';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  return (
    <div className='w-full min-h-screen'>
      <DownloadSessionSync />
      <DesktopDownloadStoreSync />

      {/* 移动端头部 */}
      <MobileHeader showBackButton={['/play', '/live'].includes(activePath)} />

      {/* 主要布局容器 */}
      <div className='flex md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'>
        {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>

        {/* 主内容区域 */}
        <div className='min-w-0 flex-1 transition-all duration-300'>
          <div className='hidden md:flex items-center justify-between px-4 pt-2 sm:px-6 lg:px-8'>
            <div className='flex min-h-10 items-center'>
              {['/play', '/live'].includes(activePath) ? (
                <BackButton />
              ) : (
                <div aria-hidden='true' className='h-10 w-10' />
              )}
            </div>

            <div className='flex items-center gap-2'>
              <ThemeToggle />
              <GlobalRatingFilterControl />
              <UserMenu />
            </div>
          </div>

          {/* 主内容 */}
          <main
            className='flex-1 md:min-h-0 mb-14 mt-12 md:mb-0 md:mt-0'
            style={{
              paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
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
  );
};

export default PageLayout;
