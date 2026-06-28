import { useCallback, useState } from "react";

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

function CredentialRow({ label, value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }, [value]);

  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <div style={styles.rowValue}>
        <code style={styles.code}>{value}</code>
        <button
          type="button"
          onClick={handleCopy}
          style={{ ...styles.copyButton, ...(copied ? styles.copyButtonActive : {}) }}
          aria-label={`Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function ProvisioningCredentialsModal({ credential, onClose }) {
  const [allCopied, setAllCopied] = useState(false);

  if (!credential) return null;

  const { type, name, data, createdAt } = credential;
  const isEsp = type === "esp";
  const fields = fieldsFor(type);
  const title = isEsp ? "ESP Module Registered" : "Device Registered";
  const jsonPayload = Object.fromEntries(fields.map(({ key }) => [key, data?.[key] ?? ""]));
  const filename = `${isEsp ? "esp" : "device"}-credentials-${Date.now()}.json`;

  const handleCopyAll = () => {
    const text = fields.map(({ label, key }) => `${label}: ${data?.[key] ?? ""}`).join("\n");
    copyText(text).then(() => {
      setAllCopied(true);
      window.setTimeout(() => setAllCopied(false), 1800);
    });
  };

  return (
    <div style={styles.backdrop} onClick={onClose} role="presentation">
      <section
        style={styles.panel}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provisioning-modal-title"
      >
        <header style={styles.header}>
          <div>
            <span style={styles.successBadge}>Saved</span>
            <h2 id="provisioning-modal-title" style={styles.title}>{title}</h2>
            {name ? <p style={styles.subtitle}>{name}</p> : null}
            {createdAt ? <p style={styles.timestamp}>{new Date(createdAt).toLocaleString()}</p> : null}
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            x
          </button>
        </header>

        <div style={styles.warning}>
          These credentials are shown after provisioning. Copy or download them before using the simulator or firmware.
        </div>

        <div style={styles.credentials}>
          {fields.map(({ label, key }) => (
            <CredentialRow key={key} label={label} value={data?.[key] ?? "(not returned)"} />
          ))}
        </div>

        <footer style={styles.actions}>
          <button type="button" style={styles.secondaryButton} onClick={handleCopyAll}>
            {allCopied ? "Copied All" : "Copy All"}
          </button>
          <button type="button" style={styles.primaryButton} onClick={() => downloadJson(filename, jsonPayload)}>
            Download JSON
          </button>
        </footer>

        <p style={styles.hint}>
          You can review saved credentials later from Provisioning Credentials in the sidebar.
        </p>
      </section>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    background: "rgba(15, 23, 42, 0.58)",
    backdropFilter: "blur(4px)",
  },
  panel: {
    width: "min(540px, 100%)",
    padding: 28,
    borderRadius: 16,
    background: "var(--modal-bg, #ffffff)",
    color: "var(--text-primary, #0f172a)",
    boxShadow: "0 24px 64px rgba(15, 23, 42, 0.28)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 16,
  },
  successBadge: {
    display: "inline-flex",
    marginBottom: 8,
    padding: "3px 8px",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#15803d",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
  },
  subtitle: {
    margin: "6px 0 0",
    color: "var(--text-secondary, #475569)",
    fontSize: 14,
    fontWeight: 600,
  },
  timestamp: {
    margin: "4px 0 0",
    color: "var(--text-muted, #94a3b8)",
    fontSize: 12,
  },
  closeButton: {
    width: 32,
    height: 32,
    border: "1px solid var(--border, #e2e8f0)",
    borderRadius: 8,
    background: "transparent",
    color: "var(--text-secondary, #475569)",
    cursor: "pointer",
    fontWeight: 700,
  },
  warning: {
    marginBottom: 18,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #fed7aa",
    background: "#fff7ed",
    color: "#92400e",
    fontSize: 13,
    lineHeight: 1.5,
  },
  credentials: {
    display: "grid",
    gap: 12,
  },
  row: {
    display: "grid",
    gap: 6,
  },
  rowLabel: {
    color: "var(--text-muted, #64748b)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
  },
  rowValue: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    border: "1px solid var(--field-border, #e2e8f0)",
    borderRadius: 8,
    background: "var(--field-bg, #f8fafc)",
  },
  code: {
    flex: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    color: "var(--text-primary, #0f172a)",
    fontFamily: "Consolas, 'Cascadia Code', monospace",
    fontSize: 13,
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
    fontWeight: 700,
  },
  copyButtonActive: {
    borderColor: "#86efac",
    background: "#dcfce7",
    color: "#15803d",
  },
  actions: {
    display: "flex",
    gap: 10,
    marginTop: 20,
  },
  secondaryButton: {
    flex: 1,
    padding: "10px 14px",
    border: "1px solid var(--btn-secondary-border, #e2e8f0)",
    borderRadius: 8,
    background: "var(--btn-secondary-bg, #f1f5f9)",
    color: "var(--text-secondary, #475569)",
    cursor: "pointer",
    fontWeight: 800,
  },
  primaryButton: {
    flex: 1,
    padding: "10px 14px",
    border: 0,
    borderRadius: 8,
    background: "var(--accent, #2563eb)",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
  },
  hint: {
    margin: "14px 0 0",
    textAlign: "center",
    color: "var(--text-muted, #94a3b8)",
    fontSize: 12,
  },
};
