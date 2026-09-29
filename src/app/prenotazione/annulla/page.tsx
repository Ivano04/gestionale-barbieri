import { Suspense } from 'react';
import { AnnullaClient } from './AnnullaClient';

export default function AnnullaPage() {
  return (
    <Suspense fallback={null}>
      <AnnullaClient />
    </Suspense>
  );
}
