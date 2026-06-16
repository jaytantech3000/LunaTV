import {
  Database,
  FileText,
  FolderOpen,
  Settings,
  Tv,
  Users,
  Video,
} from 'lucide-react';

import PageLayout from '@/components/PageLayout';

const skeletonSections = [
  { icon: Settings, title: '站点配置' },
  { icon: Users, title: '用户配置' },
  { icon: Video, title: '视频源配置' },
  { icon: Tv, title: '直播源配置' },
  { icon: FolderOpen, title: '分类配置' },
  { icon: FileText, title: '配置文件' },
  { icon: Database, title: '数据迁移' },
];

export default function AdminLoading() {
  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 py-4 sm:px-10 sm:py-8'>
        <div className='mx-auto max-w-[95%] space-y-8'>
          <div className='space-y-3'>
            <div className='h-9 w-40 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700' />
            <div className='h-4 w-72 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800' />
          </div>

          <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className='space-y-3 rounded-2xl border border-gray-200 bg-white px-4 py-4 dark:border-gray-800 dark:bg-gray-950'
              >
                <div className='h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
                <div className='h-7 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700' />
                <div className='h-4 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800' />
              </div>
            ))}
          </div>

          <div className='space-y-4'>
            {skeletonSections.map(({ icon: Icon, title }) => (
              <div
                key={title}
                className='rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm dark:border-gray-800 dark:bg-gray-950'
              >
                <div className='flex items-center gap-3'>
                  <Icon className='h-5 w-5 text-gray-400 dark:text-gray-500' />
                  <div className='h-5 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700' />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
