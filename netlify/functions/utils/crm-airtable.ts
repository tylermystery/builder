const AIRTABLE_API = "https://api.airtable.com/v0";

type AirtableRecord<T = Record<string, unknown>> = {
  id: string;
  fields: T;
};

function config() {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId) throw new Error("Airtable is not configured");
  return { pat, baseId };
}

function formulaValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function airtableRequest<T>(
  table: string,
  options: {
    recordId?: string;
    params?: URLSearchParams;
    method?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const { pat, baseId } = config();
  const suffix = options.recordId ? `/${encodeURIComponent(options.recordId)}` : "";
  const url = new URL(
    `${AIRTABLE_API}/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}${suffix}`,
  );
  if (options.params) url.search = options.params.toString();
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${pat}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Airtable request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function findAirtableUserByEmail(email: string) {
  const params = new URLSearchParams({
    maxRecords: "1",
    filterByFormula: `LOWER({Email})='${formulaValue(email.toLowerCase())}'`,
  });
  const data = await airtableRequest<{ records: AirtableRecord[] }>("Users", { params });
  return data.records?.[0] || null;
}

export async function getAirtableUser(userId: string) {
  try {
    return await airtableRequest<AirtableRecord>("Users", { recordId: userId });
  } catch {
    return null;
  }
}

export async function getAirtableStore(storeId: string) {
  return airtableRequest<AirtableRecord>("Stores", { recordId: storeId });
}

export async function findPlansForClient(storeId: string, email: string) {
  const safeStoreId = formulaValue(storeId);
  const safeEmail = formulaValue(email.toLowerCase());
  const params = new URLSearchParams({
    maxRecords: "5",
    filterByFormula: `AND(LOWER({ClientEmail})='${safeEmail}',FIND('${safeStoreId}',ARRAYJOIN({Stores})))`,
  });
  try {
    const data = await airtableRequest<{ records: AirtableRecord[] }>("Sessions", {
      params,
    });
    return data.records || [];
  } catch {
    const fallbackParams = new URLSearchParams({
      maxRecords: "5",
      filterByFormula: `LOWER({ClientEmail})='${safeEmail}'`,
    });
    const data = await airtableRequest<{ records: AirtableRecord[] }>("Sessions", {
      params: fallbackParams,
    });
    return (data.records || []).filter((record) => {
      const stores = record.fields?.Stores;
      return !Array.isArray(stores) || stores.includes(storeId);
    });
  }
}

export type { AirtableRecord };
