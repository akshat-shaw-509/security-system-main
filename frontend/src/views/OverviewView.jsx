import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import DeviceCard from "../components/DeviceCard.jsx";
import LucideIcon from "../components/LucideIcon.jsx";
import { deviceIcon, roomIcon } from "../utils/helpers.js";
import { formatKwh, timelineToChartPoints } from "../utils/energyUtils.js";

export default function OverviewView() {
  const {
    devices,
    rules,
    scenes,
    events,
    roomEntries,
    commandsByDevice,
    metrics,
    energySummary,
    switchView,
    startVoice,
    runScene,
    sendCommand,
  } = useApp();

  const chartSeries = useMemo(
    () => timelineToChartPoints(energySummary?.timeline, [0, 0, 0, 0, 0]),
    [energySummary],
  );

  const [chartPoint, setChartPoint] = useState({
    index: 0,
    x: 0,
    value: chartSeries[0] || 0,
    time: energySummary?.timeline?.[0]?.label || "00:00",
  });

  const activeAutomations = rules.filter((rule) => rule.is_active).length + scenes.length;
  const topDevices = devices.slice(0, 4);
  const topRooms = roomEntries.slice(0, 4);
  const recentEvents = events.slice(0, 3);
  const cameraDevice = devices.find((device) =>
    String(`${device.device_name} ${device.device_type}`).toLowerCase().includes("camera"),
  );

  const quickActions = [
    ["Moon", "Good Night", scenes[0]?.scene_id],
    ["Plane", "Away Mode", scenes[1]?.scene_id],
    ["Clapperboard", "Movie Time", scenes[2]?.scene_id],
    ["Sun", "Morning Lights", scenes[3]?.scene_id],
  ];

  const resetChartPoint = () => {
    const index = Math.min(6, Math.max(chartSeries.length - 1, 0));
    setChartPoint({
      index,
      x: chartSeries.length > 1 ? (index / (chartSeries.length - 1)) * 100 : 0,
      value: chartSeries[index] || 0,
      time: energySummary?.timeline?.[index]?.label || "00:00",
    });
  };

  const handleChartPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    const index = Math.round(ratio * Math.max(chartSeries.length - 1, 0));
    setChartPoint({
      index,
      x: chartSeries.length > 1 ? (index / (chartSeries.length - 1)) * 100 : 0,
      value: chartSeries[index] || 0,
      time: energySummary?.timeline?.[index]?.label || "00:00",
    });
  };

  return (
    <section className="view active">
      <div className="dashboard-home">
        <div className="room-summary-row">
          {topRooms.length ? topRooms.map((room, index) => (
            <article className="room-summary-card" key={room.name}>
              <div className="summary-icon">
                <LucideIcon name={roomIcon(room.name)} />
              </div>
              <div>
                <h3>{room.name}</h3>
                <span>{room.count} Device{room.count === 1 ? "" : "s"}</span>
                <small>
                  <i className={room.online < room.count ? "offline" : ""} />
                  {room.count === 0
                    ? "No devices"
                    : room.online === room.count
                    ? "All Online"
                    : `${room.online} Online`}
                </small>
              </div>
              <strong>
                {room.temperature != null ? `${room.temperature}°C` : "—"}
              </strong>
              <svg className="sparkline" viewBox="0 0 110 34" aria-hidden="true">
                <path d="M2 24 C18 16, 25 20, 37 18 S58 9, 70 16 87 25 108 8" />
              </svg>
            </article>
          )) : (
            <div className="empty">Register devices to build room summaries</div>
          )}
        </div>

        <div className="dashboard-columns">
          <div className="dashboard-main-col">
            <section className="panel dashboard-card">
              <div className="section-head">
                <h3>Top Devices</h3>
                <button className="link-btn" type="button" onClick={() => switchView("devices")}>View all</button>
              </div>
              <div className="dashboard-device-grid featured-devices">
                {!topDevices.length ? (
                  <div className="empty">Register a device to see live controls</div>
                ) : (
                  topDevices.map((device) => (
                    <DeviceCard
                      key={device.device_id}
                      device={device}
                      commands={commandsByDevice[device.device_id] || []}
                      onCommand={sendCommand}
                    />
                  ))
                )}
              </div>
            </section>

            <section className="panel metric-strip">
              <div className="metric-tile">
                <LucideIcon name="LayoutDashboard" />
                <strong>{metrics.total}</strong>
                <span>Total Devices</span>
                <small>{metrics.homeStatusText}</small>
              </div>
              <div className="metric-tile">
                <LucideIcon name="Wifi" />
                <strong>{metrics.online}</strong>
                <span>Online</span>
                <small>{metrics.energyLoad}</small>
              </div>
              <div className="metric-tile">
                <LucideIcon name="WifiOff" />
                <strong>{metrics.offline}</strong>
                <span>Offline</span>
                <small>{metrics.safeStatusText}</small>
              </div>
              <div className="metric-tile">
                <LucideIcon name="ShieldCheck" />
                <strong>{metrics.alerts}</strong>
                <span>Alerts</span>
                <small>{metrics.alerts ? `${metrics.alerts} active` : "No new alerts"}</small>
              </div>
            </section>

            <section className="panel energy-overview-card">
              <div className="section-head">
                <div className="energy-title">
                  <LucideIcon name="Zap" />
                  <div>
                    <h3>Energy Overview</h3>
                    <span>Live usage from device telemetry</span>
                  </div>
                </div>
                <button className="btn secondary" type="button" onClick={() => switchView("energy")}>Today</button>
              </div>
              <div className="energy-body">
                <div className="energy-copy">
                  <span>Current Load</span>
                  <strong>{formatKwh(energySummary?.current_kw ?? 0)} <small>kW</small></strong>
                  <em>{energySummary?.has_hardware_power ? "Hardware power meter" : "Estimated until power_w is sent"}</em>
                  <span>This Month</span>
                  <strong>{formatKwh(energySummary?.month_total_kwh ?? 0, 0)} <small>kWh</small></strong>
                  <em>Bill est. Rs {Math.round(energySummary?.estimated_bill || 0).toLocaleString()}</em>
                  <button className="btn secondary" type="button" onClick={() => switchView("energy")}>View Detailed Report</button>
                </div>
                <div
                  className="energy-chart"
                  onPointerMove={handleChartPointer}
                  onPointerLeave={resetChartPoint}
                >
                  <span className="chart-cursor" style={{ left: `${chartPoint.x}%` }} />
                  <span className="chart-badge" style={{ left: `clamp(58px, ${chartPoint.x}%, calc(100% - 58px))` }}>
                    {chartPoint.time}<br /><strong>{formatKwh(chartPoint.value)} kWh</strong>
                  </span>
                  <svg viewBox="0 0 620 210" aria-hidden="true">
                    <defs>
                      <linearGradient id="energyFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#2563ff" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#2563ff" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path className="chart-fill" d="M0 160 C35 130 55 128 88 135 S145 75 188 95 250 160 296 112 345 128 376 104 430 174 465 98 528 150 620 96 V210 H0 Z" />
                    <path className="chart-line" d="M0 160 C35 130 55 128 88 135 S145 75 188 95 250 160 296 112 345 128 376 104 430 174 465 98 528 150 620 96" />
                  </svg>
                </div>
              </div>
            </section>

            <section className="panel automation-status-card">
              <div className="energy-title">
                <LucideIcon name="Workflow" />
                <div>
                  <h3>Automation Status</h3>
                  <span>{activeAutomations ? "Automations are active" : "Create rules or scenes to automate"}</span>
                </div>
              </div>
              <div className="automation-count">
                <span>Active Automations</span>
                <strong>{activeAutomations}</strong>
              </div>
            </section>
          </div>

          <aside className="dashboard-side-col">
            <section className="panel live-camera-card">
              <div className="section-head">
                <h3>Live Feed</h3>
                <button className="link-btn" type="button" onClick={() => switchView("security")}>View all</button>
              </div>
              <div className="camera-frame">
                {cameraDevice?.stream_url ? (
                  <img alt="" src={cameraDevice.stream_url} />
                ) : (
                  <div className="camera-placeholder">
                    <LucideIcon name="Camera" />
                    <p>Connect a camera device and set its stream URL in device settings.</p>
                  </div>
                )}
                {cameraDevice?.is_online ? <span>LIVE</span> : null}
              </div>
              <div className="camera-caption">
                <span className="green-dot" />
                {cameraDevice?.device_name || "No camera device"}
                <small>{cameraDevice?.is_online ? "Live" : "Offline"}</small>
              </div>
            </section>

            <section className="panel quick-actions-card">
              <h3>Quick Actions</h3>
              <div className="quick-actions-grid">
                {quickActions.map(([icon, label, sceneId]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => (sceneId ? runScene(sceneId) : startVoice())}
                  >
                    <LucideIcon name={icon} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel recent-activity-card">
              <div className="section-head">
                <h3>Recent Activity</h3>
                <button className="link-btn" type="button" onClick={() => switchView("settings")}>View all</button>
              </div>
              <div className="activity-list">
                {recentEvents.length ? recentEvents.map((item, index) => (
                  <article key={`${item.time}-${index}`} className="activity-row">
                    <LucideIcon name={deviceIcon(item.data || {}) || "Bell"} />
                    <div>
                      <strong>{item.data?.message || item.data?.event || "Activity"}</strong>
                      <span>{item.data?.room || "Smart Home"} - {new Date(item.time).toLocaleTimeString()}</span>
                    </div>
                    <i />
                  </article>
                )) : (
                  <div className="empty">No recent activity</div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
