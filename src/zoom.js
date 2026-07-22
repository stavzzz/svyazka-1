// Zoom Server-to-Server OAuth: токен + создание встречи → join_url.
// Креды — из вашего Server-to-Server OAuth приложения (marketplace.zoom.us).

export function createZoomClient({ accountId, clientId, clientSecret, fetchFn = fetch }) {
  let tok = { access: '', exp: 0 };
  const enabled = Boolean(accountId && clientId && clientSecret);

  async function token() {
    if (tok.access && Date.now() < tok.exp - 60_000) return tok.access;
    const r = await fetchFn(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
      {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') },
      },
    );
    const j = await r.json();
    if (!r.ok || !j.access_token) throw new Error(`zoom token failed: ${r.status}`);
    tok = { access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return tok.access;
  }

  return {
    enabled,
    // startLocalISO: '2026-07-23T15:00:00' (локальное время в tz, без смещения)
    async createMeeting(topic, startLocalISO, durationMin, tz) {
      const t = await token();
      const r = await fetchFn('https://api-us.zoom.us/v2/users/me/meetings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          type: 2,
          start_time: startLocalISO,
          duration: durationMin,
          timezone: tz,
          settings: { join_before_host: true, waiting_room: false, approval_type: 2 },
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.join_url) throw new Error(`zoom create failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
      return { joinUrl: j.join_url, meetingId: j.id };
    },
  };
}
