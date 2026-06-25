import { API_BASE } from "./config.js";

export async function api(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error(
      "Cannot reach backend. Start it with: python -m uvicorn app.main:app --reload --port 8001",
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    if (typeof data === "object" && data?.detail) {
      detail = Array.isArray(data.detail)
        ? data.detail.map((item) => item.msg || JSON.stringify(item)).join(", ")
        : data.detail;
    } else if (typeof data === "string" && data) {
      detail = data;
    }
    throw new Error(detail);
  }

  return data;
}

export function authHeaders(token, extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
  };
}
