export function MusicSidebar() {
  return (
    <aside className='rounded-[32px] border border-white/10 bg-black/90 p-5 text-white'>
      <div className='text-sm uppercase tracking-[0.24em] text-white/45'>
        Luna Music
      </div>
      <nav className='mt-6 space-y-3 text-sm'>
        <a className='block rounded-2xl bg-white/10 px-4 py-3'>Home</a>
        <a className='block rounded-2xl px-4 py-3 text-white/72'>Explore</a>
        <a className='block rounded-2xl px-4 py-3 text-white/72'>Library</a>
      </nav>
    </aside>
  );
}
