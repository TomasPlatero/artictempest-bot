const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

async function fetchWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function createSupabaseClient(baseUrl, anonKey) {
  async function query(table, options = {}) {
    const { select = '*', filters = [], order, limit, single } = options;

    let url = `${baseUrl.replace(/\/$/, '')}/rest/v1/${table}?select=${select}`;

    for (const filter of filters) {
      url += `&${filter.column}=${encodeURIComponent(filter.value)}`;
    }

    if (order) {
      url += `&order=${order.column}.${order.direction || 'asc'}`;
    }

    if (limit) {
      url += `&limit=${limit}`;
    }

    const response = await fetchWithRetry(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
        Prefer: single ? 'return=representation' : 'return=representation',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Supabase query failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }

    const data = await response.json();
    return single ? (Array.isArray(data) ? data[0] : data) : data;
  }

  async function update(table, id, fields) {
    const url = `${baseUrl.replace(/\/$/, '')}/rest/v1/${table}?id=eq.${id}`;

    const response = await fetchWithRetry(url, {
      method: 'PATCH',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Supabase update failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }
  }

  return { query, update };
}

module.exports = { createSupabaseClient };
