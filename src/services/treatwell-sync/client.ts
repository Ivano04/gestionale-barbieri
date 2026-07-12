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

  private getHeaders(): Record<string, string> {
    return {
      authorization: `Token token="${this.token}"`,
      'x-client-auth': this.clientAuth,
      accept: '*/*',
      'accept-language': 'it',
      origin: 'https://pro.treatwell.it',
      referer: 'https://pro.treatwell.it/agenda/',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    };
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const headers = { ...this.getHeaders(), ...(options?.headers as Record<string, string>) };
    if (options?.body && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(15000),
    });
  }

  /** Legge gli appuntamenti di un giorno */
  async getAppointments(date: string): Promise<any[]> {
    const res = await this.fetch(
      `/venues/${this.venueId}/appointments.json?from_time=${date}T00:00:00Z&to_time=${date}T23:59:59Z`,
    );
    if (!res.ok) throw new Error(`Treatwell getAppointments failed: ${res.status}`);
    const data = await res.json();
    return data?.data?.appointments || [];
  }

  /** Sync incrementale: solo le modifiche dopo un timestamp */
  async getSync(updatedSince: string): Promise<any> {
    const res = await this.fetch(
      `/venues/${this.venueId}/synch.json?updated_since=${updatedSince}&only=appointments`,
    );
    if (!res.ok) throw new Error(`Treatwell getSync failed: ${res.status}`);
    return res.json();
  }

  /** Cerca cliente per nome/telefono */
  async findCustomer(query: string): Promise<number | null> {
    const res = await this.fetch(
      `/venues/${this.venueId}/customers/search.json?q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const customers = data?.data?.customers || [];
    return customers.length > 0 ? customers[0].id : null;
  }

  /** Trova o crea cliente */
  async findOrCreateCustomer(name: string, phone: string): Promise<number> {
    // Search by phone first
    if (phone) {
      const found = await this.findCustomer(phone);
      if (found) return found;
    }

    // Search by name
    if (name && name !== 'Cliente') {
      const found = await this.findCustomer(name);
      if (found) return found;
    }

    // Create new customer
    return this.createCustomer(name, phone);
  }

  /** Crea un nuovo cliente */
  async createCustomer(name: string, phone: string): Promise<number> {
    const [firstName, ...lastParts] = name.trim().split(' ');
    const lastName = lastParts.join(' ') || '';
    const res = await this.fetch(`/venues/${this.venueId}/customers`, {
      method: 'POST',
      body: JSON.stringify({
        first_name: firstName || 'Cliente',
        last_name: lastName || '',
        phone,
        by_venue: true,
      }),
    });
    const data = await res.json();
    if (!res.ok && data?.data?.conflictual_customer?.id) {
      return data.data.conflictual_customer.id;
    }
    if (!res.ok) {
      throw new Error(`Uala createCustomer failed: ${res.status} ${JSON.stringify(data)}`);
    }
    return data.data.customer.id;
  }

  /** Crea un appuntamento */
  async createAppointment(params: {
    staffMemberId: number;
    staffMemberTreatmentId: number;
    time: string;
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

    const res = await this.fetch(`/venues/${this.venueId}/appointments.json`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Uala createAppointment failed: ${res.status} ${JSON.stringify(data)}`);
    }
    return data.data.appointment.id;
  }

  /** Aggiorna la durata di un appuntamento (es. estensione manuale) */
  async updateAppointment(appointmentId: number, params: { time?: string; duration?: number }): Promise<void> {
    const body: Record<string, any> = {};
    if (params.time) body.time = params.time;
    if (params.duration) body.custom_duration = params.duration;
    const res = await this.fetch(`/venues/${this.venueId}/appointments/${appointmentId}.json`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(`Uala updateAppointment failed: ${res.status} ${JSON.stringify(data)}`);
    }
  }

  /** Cancella un appuntamento */
  async cancelAppointment(appointmentId: number): Promise<void> {
    const res = await this.fetch(
      `/venues/${this.venueId}/appointments/${appointmentId}/cancel.json`,
      { method: 'PUT' },
    );
    const data = await res.json();
    if (!data.success) {
      throw new Error(`Uala cancelAppointment failed: ${JSON.stringify(data)}`);
    }
  }

  /** Lista staff */
  async getStaffMembers(): Promise<any[]> {
    const res = await this.fetch(`/venues/${this.venueId}/staff_members.json`);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.staff_members || [];
  }

  /** Recupera i dettagli di un cliente (inclusa email) */
  async getCustomer(customerId: number): Promise<{ email?: string; phone?: string; first_name?: string; last_name?: string } | null> {
    const res = await this.fetch(`/venues/${this.venueId}/customers/${customerId}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data?.data?.customer;
    return c ? { email: c.email, phone: c.phone, first_name: c.first_name, last_name: c.last_name } : null;
  }

  /** Lista trattamenti per staff */
  async getStaffMemberTreatments(): Promise<any[]> {
    const res = await this.fetch(`/venues/${this.venueId}/staff_member_treatments.json`);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.staff_member_treatments || [];
  }
}
