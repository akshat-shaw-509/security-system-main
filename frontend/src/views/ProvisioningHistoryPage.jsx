import { useCallback, useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  return Promise.resolve();
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fieldsFor(type) {
  return type === "esp"
    ? [
        { label: "ESP UID", key: "esp_uid" },
        { label: "ESP Token", key: "esp_token" },
      ]
    : [
        { label: "Device UID", key: "device_uid" },
        { label: "Device Token", key: "device_token" },
      ];
}

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }, [value]);

  return (
    <button type="button" onClick={handleCopy} style={styles.copyButton} aria-label={`Copy ${label}`}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CredentialCard({ entry }) {
  const fields = fieldsFor(entry.type);
  const isEsp = entry.type === "esp";
  const jsonPayload = Object.fromEntries(fields.map(({ key }) => [key, entry.data?.[key] ?? ""]));
  const filename = `${isEsp ? "esp" : "device"}-credentials-${entry.id}.json`;

  return (
    <article style={styles.card}>
      <header style={styles.cardHeader}>
        <span style={{ ...styles.badge, ...(isEsp ? styles.espBadge : styles.deviceBadge) }}>
          {isEsp ? "ESP Module" : "Device"}
        </span>
        <strong style={styles.cardName}>{entry.name || "Unnamed"}</strong>
        <span style={styles.cardTime}>{formatDate(entry.createdAt)}</span>
        <button type="button" onClick={() => downloadJson(filename, jsonPayload)} style={styles.downloadButton}>
          JSON
        </button>
      </header>

      <div style={styles.fieldGrid}>
        {fields.map(({ label, key }) => (
          <div key={key} style={styles.fieldGroup}>
            <span style={styles.fieldLabel}>{label}</span>
            <div style={styles.fieldRow}>
              <code style={styles.fieldCode}>{entry.data?.[key] ?? "(not returned)"}</code>
              <CopyButton value={entry.data?.[key] ?? ""} label={label} />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div style={styles.empty}>
      <strong>No provisioning records yet</strong>
      <span>Register a device or ESP module and its credentials will appear here.</span>
    </div>
  );
}

export default function ProvisioningHistoryPage() {
  const { provisioningLog, clearProvisioningLog } = useApp();
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(
    () => provisioningLog.filter((entry) => (filter === "all" ? true : entry.type === filter)),
    [filter, provisioningLog],
  );

  const counts = useMemo(
    () => ({
      all: provisioningLog.length,
      device: provisioningLog.filter((entry) => entry.type === "device").length,
      esp: provisioningLog.filter((entry) => entry.type === "esp").length,
    }),
    [provisioningLog],
  );

  const handleClear = () => {
    if (window.confirm("Clear all provisioning records?")) {
      clearProvisioningLog();
    }
  };

  return (
    <section className="view active" style={styles.page}>
      <header style={styles.pageHeader}>
        <div>
          <h2 style={styles.pageTitle}>Provisioning Credentials</h2>
          <p style={styles.pageSubtitle}>
            Credentials issued when devices and ESP modules are registered. They are stored locally in this browser.
          </p>
        </div>
        {provisioningLog.length ? (
          <button type="button" onClick={handleClear} style={styles.clearButton}>
            Clear history
          </button>
        ) : null}
      </header>

      {provisioningLog.length ? (
        <div style={styles.tabs} role="tablist" aria-label="Provisioning credential filters">
          {[
            ["all", "All"],
            ["device", "Devices"],
            ["esp", "ESP Modules"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              style={{ ...styles.tab, ...(filter === id ? styles.activeTab : {}) }}
            >
              {label}
              <span style={styles.tabCount}>{counts[id]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length ? (
        <div style={styles.list}>
          {filtered.map((entry) => (
            <CredentialCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

const styles = {
  page: {
    maxWidth: 880,
    margin: "0 auto",
    padding: "28px",
    color: "var(--text-primary, #0f172a)",
  },
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 22,
  },
  pageTitle: {
    margin: "0 0 6px",
    fontSize: 24,
    fontWeight: 800,
  },
  pageSubtitle: {
    margin: 0,
    color: "var(--text-muted, #64748b)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  clearButton: {
    flexShrink: 0,
    padding: "8px 12px",
    border: "1px solid #fca5a5",
    borderRadius: 8,
    background: "transparent",
    color: "#dc2626",
    cursor: "pointer",
    fontWeight: 800,
  },
  tabs: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
    borderBottom: "1px solid var(--border, #e2e8f0)",
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 12px",
    border: 0,
    borderBottom: "2px solid transparent",
    background: "transparent",
    color: "var(--text-muted, #64748b)",
    cursor: "pointer",
    fontWeight: 700,
  },
  activeTab: {
    borderBottomColor: "var(--accent, #2563eb)",
    color: "var(--accent, #2563eb)",
  },
  tabCount: {
    minWidth: 20,
    padding: "2px 6px",
    borderRadius: 999,
    background: "var(--badge-bg, #f1f5f9)",
    color: "inherit",
    fontSize: 11,
  },
  list: {
    display: "grid",
    gap: 14,
  },
  card: {
    overflow: "hidden",
    border: "1px solid var(--border, #e2e8f0)",
    borderRadius: 12,
    background: "var(--card-bg, #ffffff)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border, #f1f5f9)",
    background: "var(--card-header-bg, #f8fafc)",
    flexWrap: "wrap",
  },
  badge: {
    padding: "3px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
  },
  deviceBadge: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  espBadge: {
    background: "#dcfce7",
    color: "#15803d",
  },
  cardName: {
    flex: 1,
    minWidth: 140,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardTime: {
    color: "var(--text-muted, #94a3b8)",
    fontSize: 12,
  },
  downloadButton: {
    padding: "5px 10px",
    border: "1px solid var(--border, #e2e8f0)",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text-secondary, #475569)",
    cursor: "pointer",
    fontWeight: 800,
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  },
  fieldGroup: {
    display: "grid",
    gap: 6,
    padding: 16,
    borderRight: "1px solid var(--border, #f1f5f9)",
  },
  fieldLabel: {
    color: "var(--text-muted, #64748b)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
  },
  fieldRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  fieldCode: {
    flex: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    fontFamily: "Consolas, 'Cascadia Code', monospace",
    fontSize: 12,
  },
  copyButton: {
    flexShrink: 0,
    padding: "5px 10px",
    border: "1px solid var(--btn-secondary-border, #e2e8f0)",
    borderRadius: 6,
    background: "var(--btn-secondary-bg, #f1f5f9)",
    color: "var(--text-secondary, #475569)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 800,
  },
  empty: {
    display: "grid",
    gap: 8,
    justifyItems: "center",
    padding: "64px 24px",
    color: "var(--text-muted, #64748b)",
    textAlign: "center",
  },
};
