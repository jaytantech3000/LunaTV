export function MusicTopBar() {
  return (
    <header className='flex items-center justify-between gap-4'>
      <input
        readOnly
        value='Search music'
        className='w-full rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm'
      />
      <button className='rounded-full border border-white/10 px-4 py-3 text-sm'>
        Theme
      </button>
    </header>
  );
}
