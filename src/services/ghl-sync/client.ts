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

    const createRes = await this.fetch('/contacts/', {
      method: 'POST',
      body: JSON.stringify({
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        locationId: subaccountId,
      }),
    });
    const data = await createRes.json();
    return data.contact.id;
  }

  async createAppointment(
    subaccountId: string,
    appointment: {
      contactId: string;
      title: string;
      startTime: string;
      endTime: string;
    },
  ): Promise<string> {
    const res = await this.fetch('/appointments/', {
      method: 'POST',
      body: JSON.stringify({
        contactId: appointment.contactId,
        title: appointment.title,
        appointmentStatus: 'confirmed',
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        locationId: subaccountId,
      }),
    });
    const data = await res.json();
    return data.appointment.id;
  }
}
