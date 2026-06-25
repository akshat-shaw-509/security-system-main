import { useEffect } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "./LucideIcon.jsx";

export default function TelemetryPanel({ title = "Live sensor readings" }) {
  const {
    token,
    devices,
    telemetryDeviceId,
    setTelemetryDeviceId,
    initTelemetryCharts,
    loadTelemetryHistory,
    tempCanvasRef,
    humidityCanvasRef,
    backendStatus,
  } = useApp();
  useEffect(() => {
    if (!token || backendStatus !== "online") return undefined;

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (initTelemetryCharts()) {
        loadTelemetryHistory();
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [token, telemetryDeviceId, backendStatus, initTelemetryCharts, loadTelemetryHistory]);

  const sensorDevices = devices.filter((device) => {
    const type = String(device.device_type || "").toLowerCase();
    return type.includes("sensor") || type.includes("motion");
  });
  const selectableDevices = sensorDevices.length ? sensorDevices : devices;

  return (
    <section className="panel pad energy-telemetry-panel">
      <div className="section-head">
        <div>
          <h3>{title}</h3>
          <span>Live temperature and humidity from your hardware telemetry stream.</span>
        </div>
        <label className="telemetry-device-picker">
          <LucideIcon name="Radar" />
          <select
            value={telemetryDeviceId}
            onChange={(event) => setTelemetryDeviceId(event.target.value)}
            disabled={!selectableDevices.length}
          >
            {!selectableDevices.length ? (
              <option value="">No devices registered</option>
            ) : (
              selectableDevices.map((device) => (
                <option key={device.device_id} value={String(device.device_id)}>
                  {device.device_name}
                </option>
              ))
            )}
          </select>
        </label>
      </div>
      {!selectableDevices.length ? (
        <div className="empty">
          Register a sensor device and run the device simulator (or your MCU firmware) to see live charts.
        </div>
      ) : (
        <div className="telemetry-chart-grid">
          <article className="telemetry-chart-card">
            <h4>Temperature (°C)</h4>
            <div className="telemetry-chart-wrap">
              <canvas ref={tempCanvasRef} />
            </div>
          </article>
          <article className="telemetry-chart-card">
            <h4>Humidity (%)</h4>
            <div className="telemetry-chart-wrap">
              <canvas ref={humidityCanvasRef} />
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
