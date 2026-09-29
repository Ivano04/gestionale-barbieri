import { describe, it, expect } from 'vitest';
import { makeCancelToken, verifyCancelToken } from './token';

const SECRET = 'super-secret';
const APPT = '1a5aef13-e4a0-4d99-961f-36bd3fb79a04';

describe('cancel token', () => {
  it('round-trip: un token valido restituisce l\'appointmentId', () => {
    const token = makeCancelToken(APPT, SECRET);
    expect(verifyCancelToken(token, SECRET)).toBe(APPT);
  });

  it('rifiuta un token con firma manomessa', () => {
    const token = makeCancelToken(APPT, SECRET);
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyCancelToken(tampered, SECRET)).toBeNull();
  });

  it('rifiuta se l\'appointmentId viene cambiato', () => {
    const token = makeCancelToken(APPT, SECRET);
    const sig = token.split('.')[1];
    expect(verifyCancelToken(`altro-id.${sig}`, SECRET)).toBeNull();
  });

  it('rifiuta un token con secret diverso', () => {
    const token = makeCancelToken(APPT, SECRET);
    expect(verifyCancelToken(token, 'altro-secret')).toBeNull();
  });

  it('rifiuta un formato non valido', () => {
    expect(verifyCancelToken('senza-punto', SECRET)).toBeNull();
    expect(verifyCancelToken('', SECRET)).toBeNull();
  });
});
