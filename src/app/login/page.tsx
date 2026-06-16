import { Suspense } from 'react';

import { LoginPageClient } from './LoginPageClient';

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
