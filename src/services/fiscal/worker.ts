import { FiskalyTestError, type FiskalyRecord } from './fiskaly-test-client';

export interface FiscalWork {
  jobId: string; leaseToken: string; attempts: number; documentId: string; salonId: string;
  operation: string; mode: string; snapshot: Record<string, unknown>;
  configuration: { provider: string; mode: string; organization_id: string; system_id: string };
  intentionKey: string; transactionKey: string; intentionId?: string; recordId?: string; originalRecordId?: string;
}
export interface FiscalProgress {
  intentionId?: string; recordId?: string; originalRecordId?: string; state?: string; mode?: string;
  outcome: 'processing' | 'completed' | 'retry' | 'uncertain' | 'failed';
  errorCode?: string; delaySeconds?: number;
}
export interface FiscalWorkerRepo {
  claim(): Promise<FiscalWork | null>;
  checkpoint(work: FiscalWork, progress: FiscalProgress): Promise<void>;
}
export interface FiscalProvider {
  assertOrganization(id: string): Promise<void>;
  createIntention(key: string): Promise<FiskalyRecord>;
  submitReceipt(id: string, operation: Record<string, unknown>, key: string): Promise<FiskalyRecord>;
  submitCancellation?(intentionId: string, originalId: string, key: string): Promise<FiskalyRecord>;
  getRecord(id: string): Promise<FiskalyRecord>;
}
export class FiscalLeaseLost extends Error {}
function recordId(record: FiskalyRecord): string {
  const id = record.content?.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new FiskalyTestError('Record ID missing', null, true);
  }
  return id;
}

// One job per invocation. Scheduling and credential selection belong to the server.
export async function runFiscalWorkerOnce(repo: FiscalWorkerRepo,
  providerFor: (work: FiscalWork) => FiscalProvider): Promise<'idle' | 'processed' | 'lease_lost'> {
  const work = await repo.claim();
  if (!work) return 'idle';
  try {
    if (work.mode !== 'test' || !['receipt', 'cancellation'].includes(work.operation) || work.snapshot?.type !== (work.operation === 'cancellation' ? 'CANCELLATION' : 'RECEIPT') ||
        (work.operation === 'cancellation' && !work.originalRecordId) ||
        work.configuration?.provider !== 'fiskaly' || work.configuration.mode !== 'test' ||
        !work.configuration.system_id || !work.configuration.organization_id) {
      await repo.checkpoint(work, { outcome: 'failed', errorCode: 'INVALID_TEST_CONFIGURATION' });
      return 'processed';
    }
    const provider = providerFor(work);
    await provider.assertOrganization(work.configuration.organization_id);
    await repo.checkpoint(work, { outcome: 'processing' });
    if (!work.intentionId) {
      work.intentionId = recordId(await provider.createIntention(work.intentionKey));
      await repo.checkpoint(work, { outcome: 'processing', intentionId: work.intentionId });
    }
    if (!work.recordId) {
      if (work.operation === 'cancellation') {
        if (!provider.submitCancellation || !work.originalRecordId) throw new Error('Cancellation provider unavailable');
        work.recordId = recordId(await provider.submitCancellation(work.intentionId, work.originalRecordId, work.transactionKey));
      } else {
        work.recordId = recordId(await provider.submitReceipt(work.intentionId, work.snapshot, work.transactionKey));
      }
      await repo.checkpoint(work, { outcome: 'processing', intentionId: work.intentionId, recordId: work.recordId });
    }
    const record = await provider.getRecord(work.recordId);
    if (recordId(record) !== work.recordId || record.content.type !== (work.operation === 'cancellation' ? 'TRANSACTION::CANCELLATION' : 'TRANSACTION::RECEIPT')) {
      throw new FiskalyTestError('Unexpected receipt record', null, true);
    }
    const { state, mode } = record.content;
    const outcome = state === 'COMPLETED' && mode === 'FINISHED' ? 'completed' :
      ['FAILED', 'REJECTED'].includes(state || '') ? 'failed' : 'retry';
    await repo.checkpoint(work, { outcome, intentionId: work.intentionId, recordId: work.recordId,
      state, mode, errorCode: outcome === 'failed' ? 'PROVIDER_RECORD_FAILED' : undefined,
      delaySeconds: 30 });
  } catch (error) {
    if (error instanceof FiscalLeaseLost) return 'lease_lost';
    const uncertain = error instanceof FiskalyTestError && error.uncertain;
    const transient = error instanceof FiskalyTestError &&
      (error.status === null || error.status === 429 || (error.status !== null && error.status >= 500));
    const outcome = uncertain ? 'uncertain' : transient ? 'retry' : 'failed';
    try {
      await repo.checkpoint(work, { outcome, intentionId: work.intentionId, recordId: work.recordId,
        errorCode: error instanceof FiskalyTestError ? 'FISKALY_' + (error.status ?? 'NETWORK') : 'WORKER_ERROR',
        delaySeconds: Math.min(3600, 30 * 2 ** Math.min(work.attempts, 6)) });
    } catch (checkpointError) {
      if (checkpointError instanceof FiscalLeaseLost) return 'lease_lost';
      throw checkpointError; // Lease expiry allows recovery if persistence is unavailable.
    }
  }
  return 'processed';
}
