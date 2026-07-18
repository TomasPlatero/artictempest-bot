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

    const response = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
        Prefer: single ? 'return=representation' : 'return=representation',
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase query failed (${response.status})`);
    }

    const data = await response.json();
    return single ? (Array.isArray(data) ? data[0] : data) : data;
  }

  async function update(table, id, fields) {
    const url = `${baseUrl.replace(/\/$/, '')}/rest/v1/${table}?id=eq.${id}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
    });

    if (!response.ok) {
      throw new Error(`Supabase update failed (${response.status})`);
    }
  }

  return { query, update };
}

module.exports = { createSupabaseClient };
