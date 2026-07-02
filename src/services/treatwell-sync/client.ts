export class TreatwellClient {
  private baseUrl: string;
  private venueId: string;
  private token: string;
  private clientAuth: string;

  constructor(config: {
    baseUrl: string;
    venueId: string;
    token: string;
    clientAuth: string;
  }) {
    this.baseUrl = config.baseUrl;
    this.venueId = config.venueId;
    this.token = config.token;
    this.clientAuth = config.clientAuth;
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'X-Client-Auth': this.clientAuth,
      Accept: 'application/json',
      ...(options?.headers as Record<string, string>),
    };
    if (options?.body) headers['Content-Type'] = 'application/json';
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(10000),
    });
  }

  /** Find customer by phone, or create if not found */
  async findOrCreateCustomer(
    name: string,
    phone: string,
  ): Promise<number> {
    const [firstName, ...lastParts] = name.trim().split(' ');
    const lastName = lastParts.join(' ') || '';

    const createRes = await this.fetch(`/venues/${this.venueId}/customers`, {
      method: 'POST',
      body: JSON.stringify({
        first_name: firstName || 'Cliente',
        last_name: lastName || '',
        phone,
        by_venue: true,
      }),
    });
    const data = await createRes.json();

    // Return existing customer ID on conflict (409)
    if (!createRes.ok && data?.data?.conflictual_customer?.id) {
      return data.data.conflictual_customer.id;
    }

    if (!createRes.ok) {
      throw new Error(
        `Uala createCustomer failed: ${createRes.status} ${JSON.stringify(data)}`,
      );
    }
    return data.data.customer.id;
  }

  /** Create an appointment on the Uala calendar */
  async createAppointment(params: {
    staffMemberId: number;
    staffMemberTreatmentId: number;
    time: string; // ISO 8601 with timezone
    customerId: number;
    notes?: string;
  }): Promise<number> {
    const body: Record<string, any> = {
      staff_member_id: params.staffMemberId,
      staff_member_treatment_id: params.staffMemberTreatmentId,
      time: params.time,
      customer_id: params.customerId,
      by_venue: true,
      state: 'requested',
    };
    if (params.notes) body.notes = params.notes;

    const res = await this.fetch(`/venues/${this.venueId}/appointments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        `Uala createAppointment failed: ${res.status} ${JSON.stringify(data)}`,
      );
    }
    return data.data.appointment.id;
  }

  /** Delete an appointment from the Uala calendar */
  async deleteAppointment(appointmentId: number): Promise<void> {
    const res = await this.fetch(
      `/venues/${this.venueId}/appointments/${appointmentId}`,
      { method: 'DELETE' },
    );
    const data = await res.json();
    if (!data.success) {
      throw new Error(`Uala deleteAppointment failed: ${JSON.stringify(data)}`);
    }
  }

  /** Get available slots for a staff member on a given date */
  async getAppointments(date: string): Promise<any[]> {
    const res = await this.fetch(
      `/venues/${this.venueId}/appointments?date=${date}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.appointments || [];
  }
}
