import { SYNC_WINDOW_START, SYNC_WINDOW_END } from '@/lib/constants';

interface TreatwellConfig {
  baseUrl: string;
  salonId: string;
  cookies?: string;
}

export class TreatwellClient {
  private baseUrl: string;
  private salonId: string;
  private cookies?: string;

  constructor(config: TreatwellConfig) {
    this.baseUrl = config.baseUrl;
    this.salonId = config.salonId;
    this.cookies = config.cookies;
  }

  private isInSyncWindow(): boolean {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    return hour >= SYNC_WINDOW_START && hour < SYNC_WINDOW_END;
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'application/json',
      ...(options?.headers as Record<string, string>),
    };
    if (this.cookies) headers['Cookie'] = this.cookies;
    return fetch(`${this.baseUrl}${path}`, { ...options, headers });
  }

  async getAppointments(date: string): Promise<any[]> {
    if (!this.isInSyncWindow()) return [];
    const res = await this.fetch(
      `/salon/${this.salonId}/appointments?date=${date}`,
    );
    if (!res.ok) throw new Error(`Treatwell API error: ${res.status}`);
    return res.json();
  }

  async checkSlot(
    startTime: string,
    endTime: string,
    serviceId: string,
  ): Promise<boolean> {
    const res = await this.fetch(`/salon/${this.salonId}/slots/check`, {
      method: 'POST',
      body: JSON.stringify({
        start: startTime,
        end: endTime,
        serviceId,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    return res.ok;
  }

  async createAppointment(data: {
    start: string;
    end: string;
    serviceId: string;
    clientName: string;
    clientPhone: string;
  }): Promise<string | null> {
    const res = await this.fetch(`/salon/${this.salonId}/appointments`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error('RATE_LIMITED');
      throw new Error(`Write-back failed: ${res.status}`);
    }
    const result = await res.json();
    return result.id;
  }
}
