export default function OfflineFallbackPage() {
  return (
    <div className='flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-lime-50 px-6 dark:from-gray-950 dark:via-gray-900 dark:to-emerald-950/30'>
      <div className='max-w-md rounded-3xl border border-emerald-200/60 bg-white/90 p-8 text-center shadow-xl backdrop-blur dark:border-emerald-900/40 dark:bg-gray-900/80'>
        <div className='mb-4 text-4xl'>📡</div>
        <h1 className='text-2xl font-semibold text-gray-900 dark:text-gray-100'>
          当前处于离线状态
        </h1>
        <p className='mt-3 text-sm leading-6 text-gray-600 dark:text-gray-400'>
          该页面暂未缓存。你仍然可以前往“下载管理”播放已经离线保存的剧集。
        </p>
      </div>
    </div>
  );
}
