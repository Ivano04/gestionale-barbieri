export class GHLClient {
  private apiKey: string;
  private baseUrl = 'https://services.leadconnectorhq.com';
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
        ...options?.headers,
      },
    });
  }

  async findOrCreateContact(
    subaccountId: string,
    contact: {
      firstName: string;
      lastName: string;
      phone: string;
      email?: string;
    },
  ): Promise<string> {
    const query = encodeURIComponent(contact.phone || contact.email || '');
    const searchRes = await this.fetch(
      `/contacts/?locationId=${subaccountId}&query=${query}`,
    );
    const searchData = await searchRes.json();
    if (searchData.contacts?.length) return searchData.contacts[0].id;

    const body: Record<string, any> = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      locationId: subaccountId,
    };
    if (contact.email) body.email = contact.email;

    const createRes = await this.fetch('/contacts/', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await createRes.json();

    // Handle duplicate contact: GHL returns 400 with the existing contactId
    if (!createRes.ok && data.contactId) {
      return data.contactId;
    }

    return data.contact?.id;
  }

  async createAppointment(
    subaccountId: string,
    appointment: {
      contactId: string;
      title: string;
      startTime: string;
      endTime: string;
      calendarId: string;
    },
  ): Promise<string> {
    const res = await this.fetch('/calendars/events/appointments/', {
      method: 'POST',
      body: JSON.stringify({
        contactId: appointment.contactId,
        title: appointment.title,
        appointmentStatus: 'confirmed',
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        locationId: subaccountId,
        calendarId: appointment.calendarId,
      }),
    });
    const data = await res.json();
    return data.appointment?.id || data.id;
  }

  async updateAppointment(
    ghlAppointmentId: string,
    appointment: {
      title?: string;
      startTime?: string;
      endTime?: string;
    },
  ): Promise<void> {
    await this.fetch(`/calendars/events/appointments/${ghlAppointmentId}`, {
      method: 'PUT',
      body: JSON.stringify(appointment),
    });
  }

  async deleteAppointment(ghlAppointmentId: string): Promise<void> {
    await this.fetch(`/calendars/events/appointments/${ghlAppointmentId}`, {
      method: 'DELETE',
    });
  }
}
