import { Suspense } from 'react';
import { EsitoClient } from './EsitoClient';

// useSearchParams richiede un confine Suspense in App Router.
export default function PagamentoEsitoPage() {
  return (
    <Suspense fallback={null}>
      <EsitoClient />
    </Suspense>
  );
}
