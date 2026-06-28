import { MusicHero } from './MusicHero';
import { MusicSidebar } from './MusicSidebar';
import { MusicTopBar } from './MusicTopBar';

export function MusicShell() {
  return (
    <div className='grid min-h-[60vh] gap-6 lg:grid-cols-[240px_minmax(0,1fr)]'>
      <MusicSidebar />
      <section className='space-y-6 rounded-[32px] bg-neutral-950/95 p-6 text-white'>
        <MusicTopBar />
        <MusicHero />
      </section>
    </div>
  );
}
