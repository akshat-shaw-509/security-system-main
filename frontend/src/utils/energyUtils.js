export function normalizeDashboard(data) {
  const normalized = {};
  Object.entries(data || {}).forEach(([room, value]) => {
    if (Array.isArray(value)) {
      normalized[room] = { devices: value, temperature: null };
      return;
    }
    normalized[room] = {
      devices: value?.devices || [],
      temperature: value?.temperature ?? null,
    };
  });
  return normalized;
}

export function buildRoomEntries(dashboard) {
  return Object.entries(normalizeDashboard(dashboard)).map(([name, meta]) => ({
    name,
    devices: meta.devices,
    temperature: meta.temperature,
    count: meta.devices.length,
    online: meta.devices.filter((device) => device.is_online).length,
  }));
}

export function timelineToChartPoints(timeline, fallback = [0]) {
  if (!timeline?.length) return fallback;
  const values = timeline.map((point) => Number(point.kwh) || 0);
  return values.length ? values : fallback;
}

export function formatKwh(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0.0";
  return numeric.toFixed(digits);
}

export function breakdownColors(index) {
  const palette = ["#1764ff", "#2ec77e", "#8057ff", "#f59e0b", "#94a3b8"];
  return palette[index % palette.length];
}
