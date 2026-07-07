import { ArrowLeft } from 'lucide-react';

export function BackButton() {
  return (
    <button
      onClick={() => window.history.back()}
      className='luna-toolbar-button'
      aria-label='Back'
    >
      <ArrowLeft className='w-full h-full' />
    </button>
  );
}
