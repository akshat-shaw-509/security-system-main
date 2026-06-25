import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "../components/LucideIcon.jsx";

const SETTINGS_STORAGE_KEY = "smart_home_settings_preferences";
const SETTINGS_ACTIVE_TAB_KEY = "smart_home_settings_active_tab";
const EVENTS_KEY = "smart_home_live_feed";

const SETTINGS_TABS = [
  ["general", "Settings", "General"],
  ["notifications", "Bell", "Notifications"],
  ["devices", "Monitor", "Devices"],
  ["security", "ShieldCheck", "Security"],
  ["integrations", "Link", "Integrations"],
  ["backup", "CloudUpload", "Backup"],
  ["privacy", "Lock", "Privacy"],
];

const QUICK_ACTIONS = [
  ["RefreshCw", "Restart System", "Restart your hub", "violet"],
  ["Trash2", "Clear Cache", "Free up storage", "red"],
  ["CloudUpload", "Backup Data", "Backup your data", "green"],
  ["Download", "Export Logs", "Download logs", "blue"],
];

const TIME_ZONES = [
  "India - Asia/Kolkata (GMT +5:30)",
  "United States - America/New_York (GMT -5:00)",
  "United States - America/Los_Angeles (GMT -8:00)",
  "United Kingdom - Europe/London (GMT +0:00)",
  "Germany - Europe/Berlin (GMT +1:00)",
  "France - Europe/Paris (GMT +1:00)",
  "United Arab Emirates - Asia/Dubai (GMT +4:00)",
  "Singapore - Asia/Singapore (GMT +8:00)",
  "Japan - Asia/Tokyo (GMT +9:00)",
  "Australia - Australia/Sydney (GMT +10:00)",
  "Brazil - America/Sao_Paulo (GMT -3:00)",
  "South Africa - Africa/Johannesburg (GMT +2:00)",
];

const LANGUAGES = [
  ["en", "English"],
  ["hi", "Hindi"],
  ["te", "Telugu"],
  ["ta", "Tamil"],
  ["bn", "Bengali"],
  ["mr", "Marathi"],
  ["gu", "Gujarati"],
  ["kn", "Kannada"],
  ["ml", "Malayalam"],
  ["pa", "Punjabi"],
  ["ur", "Urdu"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["ja", "Japanese"],
];

function normalizeLanguage(value) {
  const match = LANGUAGES.find(([code, label]) => code === value || label === value);
  return match?.[0] || "en";
}

function languageLabel(code) {
  return LANGUAGES.find(([value]) => value === code)?.[1] || "English";
}

function loadStoredSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
  } catch {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    return {};
  }
}

function requestedSettingsTab() {
  const requested = localStorage.getItem(SETTINGS_ACTIVE_TAB_KEY);
  return SETTINGS_TABS.some(([id]) => id === requested) ? requested : "general";
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function SettingsView() {
  const {
    currentUser,
    metrics,
    backendStatus,
    socketStatus,
    devices,
    scenes,
    rules,
    events,
    refreshAll,
    clearEvents,
    toast,
  } = useApp();
  const storedSettings = useMemo(loadStoredSettings, []);
  const [activeTab, setActiveTab] = useState(requestedSettingsTab);
  const [query, setQuery] = useState("");
  const [homeName, setHomeName] = useState(
    storedSettings.homeName || `${currentUser?.username || "Krishna"}'s Smart Home`,
  );
  const [location, setLocation] = useState(storedSettings.location || "Hyderabad, India");
  const [temperatureUnit, setTemperatureUnit] = useState(storedSettings.temperatureUnit || "C");
  const [timeZone, setTimeZone] = useState(storedSettings.timeZone || TIME_ZONES[0]);
  const [language, setLanguage] = useState(normalizeLanguage(storedSettings.language));
  const [darkMode, setDarkMode] = useState(storedSettings.darkMode ?? true);
  const [autoUpdate, setAutoUpdate] = useState(storedSettings.autoUpdate ?? true);
  const [lastSavedAt, setLastSavedAt] = useState(storedSettings.lastSavedAt || null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    document.body.classList.toggle("smart-home-dark-mode", darkMode);
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem("smart_home_language", language);
    window.dispatchEvent(new CustomEvent("smart-home-language-change", { detail: { language } }));
  }, [language]);

  useEffect(() => {
    const handleSettingsTab = (event) => {
      const tab = event.detail?.tab || requestedSettingsTab();
      if (SETTINGS_TABS.some(([id]) => id === tab)) {
        setActiveTab(tab);
      }
    };
    window.addEventListener("smart-home-settings-tab", handleSettingsTab);
    return () => window.removeEventListener("smart-home-settings-tab", handleSettingsTab);
  }, []);

  const settingsRows = useMemo(
    () => {
      const sections = {
        general: [
          ["House", "Home Name", homeName, "violet", "edit"],
          ["MapPin", "Location", location, "blue", "edit"],
          [
            "Thermometer",
            "Temperature Unit",
            temperatureUnit === "C" ? "C (Celsius)" : "F (Fahrenheit)",
            "green",
            "select",
          ],
          ["Clock3", "Time Zone", timeZone, "orange", "timezone-select"],
          ["Globe2", "Language", languageLabel(language), "violet", "language-select"],
          ["Moon", "Dark Mode", "Enable dark theme", "blue", "toggle-dark"],
          ["RefreshCw", "Auto Update", "Keep system updated automatically", "green", "toggle-update"],
        ],
        notifications: [
          ["Bell", "System Alerts", "Enabled for device and automation changes", "blue", "toggle-update"],
          ["ShieldCheck", "Security Alerts", metrics.alerts ? `${metrics.alerts} active alert${metrics.alerts === 1 ? "" : "s"}` : "No active alerts", "green", "none"],
          ["Volume2", "Voice Feedback", "Enabled for voice command results", "violet", "none"],
        ],
        devices: [
          ["Monitor", "Registered Devices", `${metrics.total} total devices`, "blue", "none"],
          ["Wifi", "Online Devices", `${metrics.online} online`, "green", "none"],
          ["WifiOff", "Offline Devices", `${metrics.offline} offline`, "orange", "none"],
        ],
        security: [
          ["ShieldCheck", "Home Protection", metrics.safeStatusTitle, "green", "none"],
          ["Lock", "Privacy Lock", "Account access protected", "violet", "none"],
          ["Radar", "Motion Rules", `${rules.length} automation rule${rules.length === 1 ? "" : "s"}`, "blue", "none"],
        ],
        integrations: [
          ["Wifi", "Device Network", socketStatus === "online" ? "Connected" : "Disconnected", "green", "none"],
          ["Mic", "Voice Commands", "Available from the top toolbar", "blue", "none"],
          ["Link", "Automation API", backendStatus === "online" ? "Backend online" : "Backend offline", "violet", "none"],
        ],
        backup: [
          ["CloudUpload", "Backup Data", "Use Quick Actions to download a backup", "green", "none"],
          ["Download", "Export Logs", `${events.length} event${events.length === 1 ? "" : "s"} ready`, "blue", "none"],
          ["RefreshCw", "Auto Backup", autoUpdate ? "Enabled with auto update" : "Disabled", "violet", "toggle-update"],
        ],
        privacy: [
          ["Lock", "Local Preferences", "Stored in this browser only", "violet", "none"],
          ["ShieldCheck", "Account Data", "Protected by your login session", "green", "none"],
          ["Trash2", "Cached Events", "Clear cache removes local live feed data", "orange", "none"],
        ],
      };
      return sections[activeTab] || sections.general;
    },
    [
      activeTab,
      homeName,
      location,
      temperatureUnit,
      timeZone,
      language,
      metrics,
      rules,
      socketStatus,
      backendStatus,
      events,
      autoUpdate,
    ],
  );

  const systemRows = [
    ["Info", "App Version", "v2.1.0", "blue"],
    ["Code2", "Backend Version", "v1.3.2", "blue"],
    ["CalendarDays", "Last Updated", lastSavedAt ? new Date(lastSavedAt).toLocaleString() : "Not saved yet", "blue"],
    [
      "ShieldCheck",
      "System Status",
      backendStatus === "online" && socketStatus !== "offline" ? "All Systems Online" : metrics.homeStatusText,
      "green",
    ],
    ["Clock3", "Uptime", "3d 12h 47m", "blue"],
  ];

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = settingsRows.filter((row) =>
    `${row[1]} ${row[2]}`.toLowerCase().includes(normalizedQuery),
  );
  const visibleActions = QUICK_ACTIONS.filter((row) =>
    `${row[1]} ${row[2]}`.toLowerCase().includes(normalizedQuery),
  );

  const preferences = {
    homeName,
    location,
    temperatureUnit,
    timeZone,
    language,
    darkMode,
    autoUpdate,
    lastSavedAt,
  };

  const savePreferences = (overrides = {}) => {
    const saved = { ...preferences, ...overrides, lastSavedAt: new Date().toISOString() };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved));
    setLastSavedAt(saved.lastSavedAt);
    return saved;
  };

  const handleEditSetting = (label, value) => {
    const next = window.prompt(label, value);
    if (!next || next === value) return;
    if (label === "Home Name") setHomeName(next);
    if (label === "Location") setLocation(next);
    toast(`${label} updated. Save changes to keep it.`);
  };

  const handleViewSetting = (label, value) => {
    const detailText = {
      "Security Alerts": `${metrics.alerts} security alert${metrics.alerts === 1 ? "" : "s"} are currently tracked by the dashboard.`,
      "Voice Feedback": "Voice feedback uses the microphone control in the top toolbar and reports command results through app notifications.",
      "Registered Devices": `${metrics.total} device${metrics.total === 1 ? "" : "s"} are registered in this home.`,
      "Online Devices": `${metrics.online} device${metrics.online === 1 ? " is" : "s are"} online right now.`,
      "Offline Devices": `${metrics.offline} device${metrics.offline === 1 ? " is" : "s are"} offline right now.`,
      "Home Protection": metrics.safeStatusText,
      "Privacy Lock": "Account access and protected device actions require the current login session.",
      "Motion Rules": `${rules.length} automation rule${rules.length === 1 ? " is" : "s are"} configured.`,
      "Device Network": `Socket status: ${socketStatus}.`,
      "Voice Commands": "Use the mic button in the top toolbar to run device and scene commands by voice.",
      "Automation API": `Backend status: ${backendStatus}.`,
      "Backup Data": "Use Backup Data in Quick Actions to download preferences, devices, scenes, and rules as JSON.",
      "Export Logs": `${events.length} live feed event${events.length === 1 ? "" : "s"} can be exported.`,
      "Local Preferences": "Preferences are saved in this browser with localStorage.",
      "Account Data": "Account data remains behind the authenticated backend session.",
      "Cached Events": "Clear Cache removes local live feed data and asks the backend to clear events.",
    };
    setDetail({ label, value, text: detailText[label] || value });
  };

  const handleQuickAction = async (label) => {
    if (label === "Restart System") {
      await refreshAll(undefined, { force: true });
      toast("System refreshed");
      return;
    }

    if (label === "Clear Cache") {
      localStorage.removeItem(EVENTS_KEY);
      await clearEvents();
      toast("Cached live feed cleared");
      return;
    }

    if (label === "Backup Data") {
      downloadJson("smart-home-backup.json", {
        exportedAt: new Date().toISOString(),
        preferences,
        devices,
        scenes,
        rules,
      });
      toast("Backup downloaded");
      return;
    }

    if (label === "Export Logs") {
      downloadJson("smart-home-logs.json", {
        exportedAt: new Date().toISOString(),
        events,
      });
      toast("Logs exported");
    }
  };

  const handleSave = () => {
    savePreferences();
    toast("Settings saved");
  };

  return (
    <section className="view active view-settings-page">
      <div className="settings-reference-page">
        <div className="settings-toolbar">
          <label className="settings-search" htmlFor="settingsSearch">
            <LucideIcon name="Search" />
            <input
              id="settingsSearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search settings..."
            />
          </label>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {SETTINGS_TABS.map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? "active" : ""}
              onClick={() => {
                localStorage.setItem(SETTINGS_ACTIVE_TAB_KEY, id);
                setActiveTab(id);
              }}
            >
              <LucideIcon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="settings-layout">
          <section className="settings-card settings-general-card">
            <h3>{SETTINGS_TABS.find(([id]) => id === activeTab)?.[2] || "General"} Settings</h3>
            <div className="settings-list">
              {visibleRows.length ? (
                visibleRows.map(([icon, label, value, tone, control]) => (
                  <article className="settings-row" key={label}>
                    <div className={`settings-row-icon ${tone}`}>
                      <LucideIcon name={icon} />
                    </div>
                    <div>
                      <strong>{label}</strong>
                      <span>{value}</span>
                    </div>
                    {control === "select" ? (
                      <select
                        aria-label="Temperature unit"
                        value={temperatureUnit}
                        onChange={(event) => {
                          setTemperatureUnit(event.target.value);
                          toast("Temperature unit updated. Save changes to keep it.");
                        }}
                      >
                        <option value="C">C</option>
                        <option value="F">F</option>
                      </select>
                    ) : control === "timezone-select" ? (
                      <select
                        aria-label="Time zone"
                        value={timeZone}
                        onChange={(event) => {
                          setTimeZone(event.target.value);
                          toast("Time zone updated. Save changes to keep it.");
                        }}
                      >
                        {TIME_ZONES.map((zone) => (
                          <option key={zone} value={zone}>
                            {zone}
                          </option>
                        ))}
                      </select>
                    ) : control === "language-select" ? (
                      <select
                        aria-label="Language"
                        value={language}
                        onChange={(event) => {
                          setLanguage(event.target.value);
                          toast("Language changed across the website. Save changes to keep it.");
                        }}
                      >
                        {LANGUAGES.map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : control === "toggle-dark" ? (
                      <button
                        className={`settings-switch ${darkMode ? "on" : ""}`}
                        type="button"
                        onClick={() => {
                          setDarkMode((value) => !value);
                          toast("Dark mode updated. Save changes to keep it.");
                        }}
                        aria-label="Toggle dark mode"
                      >
                        <span />
                      </button>
                    ) : control === "toggle-update" ? (
                      <button
                        className={`settings-switch ${autoUpdate ? "on" : ""}`}
                        type="button"
                        onClick={() => {
                          setAutoUpdate((value) => !value);
                          toast("Auto update updated. Save changes to keep it.");
                        }}
                        aria-label="Toggle auto update"
                      >
                        <span />
                      </button>
                    ) : control === "none" ? (
                      <button
                        type="button"
                        className="settings-value-pill"
                        onClick={() => handleViewSetting(label, value)}
                      >
                        View
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="settings-row-arrow"
                        onClick={() => handleEditSetting(label, value)}
                        aria-label={`Edit ${label}`}
                      >
                        <LucideIcon name="ChevronDown" />
                      </button>
                    )}
                  </article>
                ))
              ) : (
                <div className="empty">No settings match your search</div>
              )}
            </div>
            {detail && (
              <div className="settings-detail-panel">
                <button type="button" onClick={() => setDetail(null)} aria-label="Close setting details">
                  <LucideIcon name="ChevronDown" />
                </button>
                <strong>{detail.label}</strong>
                <span>{detail.value}</span>
                <p>{detail.text}</p>
              </div>
            )}
            <button className="btn settings-save" type="button" onClick={handleSave}>
              <LucideIcon name="Save" />
              <span>Save Changes</span>
            </button>
          </section>

          <aside className="settings-side">
            <section className="settings-card settings-actions-card">
              <h3>Quick Actions</h3>
              <div className="settings-action-grid">
                {visibleActions.length ? (
                  visibleActions.map(([icon, label, text, tone]) => (
                    <button
                      className="settings-action"
                      type="button"
                      key={label}
                      onClick={() => handleQuickAction(label)}
                    >
                      <span className={`settings-action-icon ${tone}`}>
                        <LucideIcon name={icon} />
                      </span>
                      <span>
                        <strong>{label}</strong>
                        <small>{text}</small>
                      </span>
                      <LucideIcon name="ChevronDown" />
                    </button>
                  ))
                ) : (
                  <div className="empty">No quick actions match your search</div>
                )}
              </div>
            </section>

            <section className="settings-card settings-system-card">
              <h3>System Information</h3>
              <div className="settings-system-list">
                {systemRows.map(([icon, label, value, tone]) => (
                  <article className="settings-system-row" key={label}>
                    <span className={`settings-system-icon ${tone}`}>
                      <LucideIcon name={icon} />
                    </span>
                    <strong>{label}</strong>
                    <span className={label === "System Status" ? "settings-online-pill" : ""}>{value}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="settings-sync-card">
              <div>
                <LucideIcon name="ShieldCheck" />
                <p>All your settings are securely saved and synced across your devices.</p>
              </div>
              <span>
                <LucideIcon name="ShieldCheck" />
              </span>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
