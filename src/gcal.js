// Google Calendar API v3. Авторизация — реюз кредов Workspace MCP:
// файл с client_id/client_secret/refresh_token монтируется read-only.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const API = 'https://www.googleapis.com/calendar/v3';

export function createGcal({ credsFile, calendarId = 'primary', fetchFn = fetch }) {
  let tok = { access: '', exp: 0 };

  async function accessToken() {
    if (tok.access && Date.now() < tok.exp - 60_000) return tok.access;
    // Файл читаем при каждом refresh: если MCP перевыпустит refresh_token, подхватим.
    const c = JSON.parse(readFileSync(credsFile, 'utf8'));
    const body = new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
      refresh_token: c.refresh_token,
      grant_type: 'refresh_token',
    });
    const r = await fetchFn(c.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) throw new Error(`google token refresh failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    tok = { access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return tok.access;
  }

  async function call(method, path, { query, body } = {}) {
    const t = await accessToken();
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const r = await fetchFn(url, {
      method,
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`gcal ${method} ${path}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  }

  const cid = () => encodeURIComponent(calendarId);

  // PATCH не принимает алиас «primary» (404) — нужен реальный id календаря.
  let realId = null;
  async function resolveId() {
    if (calendarId !== 'primary') return calendarId;
    if (!realId) {
      const j = await call('GET', '/calendars/primary');
      realId = j.id;
    }
    return realId;
  }

  return {
    async getCalendarTz() {
      const j = await call('GET', `/calendars/${cid()}`);
      return j.timeZone;
    },
    async setCalendarTz(tz) {
      const id = await resolveId();
      await call('PATCH', `/calendars/${encodeURIComponent(id)}`, { body: { timeZone: tz } });
    },
    // → «сырые» события Google (singleEvents, по возрастанию старта)
    async listEvents(timeMinISO, timeMaxISO) {
      const j = await call('GET', `/calendars/${cid()}/events`, {
        query: {
          timeMin: timeMinISO, timeMax: timeMaxISO,
          singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
        },
      });
      return j.items || [];
    },
    // ev: {summary, startISO, endISO, tz, attendees?, location?, description?}
    async createEvent(ev, { meet = true } = {}) {
      const body = {
        summary: ev.summary,
        start: { dateTime: ev.startISO, timeZone: ev.tz },
        end: { dateTime: ev.endISO, timeZone: ev.tz },
      };
      if (ev.attendees?.length) body.attendees = ev.attendees.map((e) => ({ email: e }));
      if (ev.location) body.location = ev.location;
      if (ev.description) body.description = ev.description;
      if (meet) {
        body.conferenceData = {
          createRequest: {
            requestId: randomBytes(8).toString('hex'),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        };
      }
      return call('POST', `/calendars/${cid()}/events`, {
        query: { conferenceDataVersion: '1', sendUpdates: 'all' },
        body,
      });
    },
    async patchEvent(eventId, patch) {
      return call('PATCH', `/calendars/${cid()}/events/${encodeURIComponent(eventId)}`, {
        query: { conferenceDataVersion: '1', sendUpdates: 'all' },
        body: patch,
      });
    },
    async deleteEvent(eventId) {
      await call('DELETE', `/calendars/${cid()}/events/${encodeURIComponent(eventId)}`, {
        query: { sendUpdates: 'all' },
      });
    },
  };
}

// Ссылка на Meet из события Google.
export function meetLink(ev) {
  if (ev.hangoutLink) return ev.hangoutLink;
  const ep = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return ep?.uri || '';
}
