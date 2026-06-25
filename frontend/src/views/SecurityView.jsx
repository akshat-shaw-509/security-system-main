import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "../components/LucideIcon.jsx";
import { deviceIcon, normalizeText } from "../utils/helpers.js";

const DEMO_ALERTS = [
  { id: "demo-motion", icon: "Radar", tone: "purple", title: "Entry Motion Sensor", place: "Living Room", time: "Sample" },
  { id: "demo-door", icon: "Lock", tone: "green", title: "Front Door locked", place: "Main Entrance", time: "Sample" },
];

const DEMO_SENSORS = [
  { icon: "Radar", tone: "purple", name: "Entry Motion Sensor", room: "Living Room", status: "ACTIVE", statusTone: "green" },
  { icon: "DoorOpen", tone: "blue", name: "Door Sensor", room: "Front Door", status: "CLOSED", statusTone: "blue" },
];

const CAMERA_FEEDS = [
  {
    id: "living",
    name: "Living Room",
    src: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "entrance",
    name: "Main Entrance",
    src: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "garage",
    name: "Garage",
    src: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1200&q=80",
  },
];

function isSecurityDevice(device) {
  const value = normalizeText(`${device.device_name} ${device.device_type}`);
  return (
    value.includes("sensor") ||
    value.includes("motion") ||
    value.includes("camera") ||
    value.includes("lock") ||
    value.includes("door") ||
    value.includes("window") ||
    value.includes("smoke")
  );
}

function statusLabel(device) {
  const value = normalizeText(`${device.device_name} ${device.device_type}`);
  const state = String(device.state || "").toUpperCase();
  if (value.includes("lock")) return state === "OFF" ? "UNLOCKED" : "LOCKED";
  if (value.includes("camera")) return device.is_online ? "LIVE" : "OFFLINE";
  if (state === "ACTIVE") return "ACTIVE";
  if (value.includes("smoke")) return "NORMAL";
  return device.is_online ? "ACTIVE" : "CLOSED";
}

export default function SecurityView() {
  const { devices, metrics, motionEvents } = useApp();
  const [securityMode, setSecurityMode] = useState("home");
  const [selectedCameraId, setSelectedCameraId] = useState(CAMERA_FEEDS[0].id);
  const [cameraMuted, setCameraMuted] = useState(true);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [sensorFilter, setSensorFilter] = useState("all");
  const [sensorSearch, setSensorSearch] = useState("");
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState(() => new Set());

  const securityDevices = useMemo(() => {
    const matched = devices.filter(isSecurityDevice);
    if (!matched.length) return [];
    return matched.map((device) => ({
      id: device.device_id,
      icon: deviceIcon(device),
      tone: normalizeText(device.device_type).includes("lock") ? "green" : "blue",
      name: device.device_name,
      room: device.room || "Unassigned",
      status: statusLabel(device),
      statusTone: device.is_online ? "green" : "blue",
    }));
  }, [devices]);

  const usingSampleSensors = !securityDevices.length;
  const visibleSensors = securityDevices.length ? securityDevices : DEMO_SENSORS;
  const systemHealth = metrics.total ? Math.round((metrics.online / metrics.total) * 100) : 100;
  const alerts = motionEvents.length
    ? motionEvents.slice(0, 8).map((item, index) => {
        const device = devices.find((entry) => entry.device_id === item.device_id);
        return {
          icon: "Radar",
          tone: "purple",
          title: "Motion detected",
          place: device?.device_name || `Device #${item.device_id}`,
          time: new Date(item.created_at).toLocaleTimeString(),
          id: `${item.device_id}-${index}`,
        };
      })
    : usingSampleSensors
    ? DEMO_ALERTS
    : [];
  const usingSampleAlerts = usingSampleSensors && !motionEvents.length;
  const openAlerts = alerts.filter((alert) => !acknowledgedAlerts.has(alert.id || alert.title));
  const visibleAlerts = showAllAlerts ? alerts : openAlerts.slice(0, 4);
  const selectedCamera = CAMERA_FEEDS.find((camera) => camera.id === selectedCameraId) || CAMERA_FEEDS[0];
  const filteredSensors = visibleSensors.filter((sensor) => {
    const matchesStatus =
      sensorFilter === "all" ||
      (sensorFilter === "active" && ["ACTIVE", "LIVE"].includes(sensor.status)) ||
      (sensorFilter === "closed" && ["CLOSED", "LOCKED", "NORMAL"].includes(sensor.status));
    const matchesSearch = !sensorSearch || normalizeText(`${sensor.name} ${sensor.room} ${sensor.status}`).includes(normalizeText(sensorSearch));
    return matchesStatus && matchesSearch;
  });
  const modeCopy = {
    home: "Home mode keeps interior sensors calm while monitoring doors, windows, and cameras.",
    away: "Away mode watches all sensors and highlights motion immediately.",
    night: "Night mode prioritizes entry points and quiet alerts.",
  };

  const acknowledgeAlert = (alert) => {
    const alertId = alert.id || alert.title;
    setAcknowledgedAlerts((prev) => {
      const next = new Set(prev);
      next.add(alertId);
      return next;
    });
  };

  return (
    <section className="view active security-reference-page">
      {usingSampleSensors ? (
        <p className="sample-data-banner">Sample security data shown — register sensors and send telemetry for live alerts.</p>
      ) : null}
      <div className="security-console-strip">
        <div>
          <span className="security-live-dot" />
          <strong>{metrics.offline === 0 ? "All systems online" : `${metrics.offline} device${metrics.offline === 1 ? "" : "s"} need attention`}</strong>
          <small>Last sync just now</small>
        </div>
        <div className="security-mode-tabs" aria-label="Security mode">
          {["home", "away", "night"].map((mode) => (
            <button
              className={securityMode === mode ? "active" : ""}
              type="button"
              key={mode}
              onClick={() => setSecurityMode(mode)}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="security-reference-grid">
        <div className="security-left-column">
          <section className="security-card security-status-card">
            <h3>Security Status</h3>
            <div className="security-status-main">
              <div className="security-status-icon">
                <LucideIcon name="ShieldCheck" />
              </div>
              <div>
                <strong>Your home is secure</strong>
                <span>{modeCopy[securityMode]}</span>
              </div>
            </div>
            <div className="security-status-metrics">
              <div>
                <strong>24/7</strong>
                <span>Monitoring</span>
              </div>
              <div>
                <strong>{visibleSensors.length}</strong>
                <span>Active Sensors</span>
              </div>
              <div>
                <strong>{systemHealth}%</strong>
                <span>System Health</span>
              </div>
            </div>
          </section>

          <section className="security-card security-alerts-card">
            <div className="security-card-head">
              <div>
                <h3>Recent Alerts</h3>
                <span>{openAlerts.length} open alert{openAlerts.length === 1 ? "" : "s"}</span>
              </div>
              <button type="button" onClick={() => setShowAllAlerts((value) => !value)}>
                {showAllAlerts ? "Show open" : "View all alerts"}
              </button>
            </div>
            <div className="security-alert-list">
              {visibleAlerts.length ? visibleAlerts.map((alert) => (
                <article className={acknowledgedAlerts.has(alert.id || alert.title) ? "acknowledged" : ""} key={alert.id || alert.title}>
                  <div className={`security-row-icon ${alert.tone}`}>
                    <LucideIcon name={alert.icon} />
                  </div>
                  <div>
                    <strong>{alert.title}</strong>
                    <span>{alert.place}</span>
                  </div>
                  <div className="security-alert-actions">
                    <time>{alert.time}</time>
                    {!acknowledgedAlerts.has(alert.id || alert.title) ? (
                      <button type="button" onClick={() => acknowledgeAlert(alert)}>Acknowledge</button>
                    ) : (
                      <small>Resolved</small>
                    )}
                  </div>
                </article>
              )) : (
                <div className="security-clear-state">
                  <LucideIcon name="ShieldCheck" />
                  <strong>No motion alerts</strong>
                  <span>Alerts appear when hardware sends motion telemetry.</span>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="security-right-column">
          <section className="security-card security-camera-card">
            <div className="security-card-head">
              <div>
                <h3>Live Camera</h3>
                <span>{selectedCamera.name}</span>
              </div>
              <button type="button">View all cameras</button>
            </div>
            <div className="security-camera-frame">
              <img
                src={selectedCamera.src}
                alt=""
              />
              <span className="security-live-badge">LIVE</span>
              <div className="security-camera-actions">
                <button type="button" title="Snapshot"><LucideIcon name="Cctv" /></button>
                <button type="button" title={cameraMuted ? "Unmute audio" : "Mute audio"} onClick={() => setCameraMuted((value) => !value)}>
                  <LucideIcon name={cameraMuted ? "MicOff" : "Mic"} />
                </button>
                <button type="button" title="Fullscreen"><LucideIcon name="Square" /></button>
              </div>
            </div>
            <div className="security-camera-picker" aria-label="Camera feeds">
              {CAMERA_FEEDS.map((camera) => (
                <button
                  className={camera.id === selectedCameraId ? "active" : ""}
                  type="button"
                  key={camera.id}
                  onClick={() => setSelectedCameraId(camera.id)}
                >
                  {camera.name}
                </button>
              ))}
            </div>
          </section>

          <section className="security-card security-sensors-card">
            <div className="security-card-head">
              <div>
                <h3>Security Sensors</h3>
                <span>{filteredSensors.length} visible</span>
              </div>
              <button type="button" onClick={() => setSensorFilter("all")}>View all sensors</button>
            </div>
            <div className="security-sensor-toolbar">
              <label>
                <LucideIcon name="Search" />
                <input
                  value={sensorSearch}
                  onChange={(event) => setSensorSearch(event.target.value)}
                  placeholder="Search sensors..."
                  type="search"
                />
              </label>
              <div>
                {["all", "active", "closed"].map((filter) => (
                  <button
                    className={sensorFilter === filter ? "active" : ""}
                    type="button"
                    key={filter}
                    onClick={() => setSensorFilter(filter)}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="security-sensor-list">
              {filteredSensors.length ? filteredSensors.map((sensor) => (
                <article key={sensor.id || sensor.name}>
                  <div className={`security-row-icon ${sensor.tone}`}>
                    <LucideIcon name={sensor.icon} />
                  </div>
                  <div>
                    <strong>{sensor.name}</strong>
                    <span>{sensor.room}</span>
                  </div>
                  <small className={sensor.statusTone}>{sensor.status}</small>
                </article>
              )) : (
                <div className="empty">
                  Register motion, door, lock, or camera devices to populate live security sensors.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
