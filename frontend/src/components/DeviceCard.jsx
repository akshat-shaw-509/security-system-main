import { deviceIcon } from "../utils/helpers.js";
import LucideIcon from "./LucideIcon.jsx";

export default function DeviceCard({ device, onCommand, commands = [] }) {
  const isOn = String(device.state).toUpperCase() === "ON";
  const isSensor = device.device_type === "sensor";
  const stateLabel = isSensor ? String(device.state || "ACTIVE").toUpperCase() : isOn ? "ON" : "OFF";
  const latestCommand = commands[0];
  const isPending = latestCommand &&
    (latestCommand.status === "pending" || latestCommand.status === "delivered");
  const presenceLabel = device.presence_label || (device.is_online ? "Live now" : "Offline");

  return (
    <article className={`device-card ${isOn ? "is-on" : "is-off"} ${device.is_online ? "online" : "offline"}`}>
      <div className="device-icon" aria-hidden="true">
        <LucideIcon name={deviceIcon(device)} size={36} />
      </div>
      <div className="device-info">
        <div className="device-title-row">
          <h4>{device.device_name}</h4>
          <span className={`device-state ${isOn || isSensor ? "on" : "off"}`}>
            {stateLabel}
          </span>
        </div>
        {!isSensor ? (
          <div className="power-control" aria-label={`${device.device_name} power control`}>
            <button
              type="button"
              className={`power-btn ${isOn ? "active" : ""}`}
              aria-pressed={isOn}
              onClick={() => onCommand(device.device_id, "TURN_ON")}
            >
              <LucideIcon name="Power" size={18} />
              <span>On</span>
            </button>
            <button
              type="button"
              className={`power-btn off ${!isOn ? "active" : ""}`}
              aria-pressed={!isOn}
              onClick={() => onCommand(device.device_id, "TURN_OFF")}
            >
              <LucideIcon name="PowerOff" size={18} />
              <span>Off</span>
            </button>
          </div>
        ) : (
          <div className="sensor-pill">Sensor monitoring</div>
        )}
        <div className="device-health">
          <span className={`green-dot ${device.is_online ? "" : "offline"}`} />
          <strong>{device.is_online ? "Online" : "Offline"}</strong>
          <span>{presenceLabel}</span>
          {device.room ? <span>{device.room}</span> : null}
        </div>
        {isPending ? (
          <div className="command-status pending">
            ⏳ {latestCommand.command_type === "TURN_ON" ? "Turning on" : "Turning off"}… waiting for hardware
          </div>
        ) : latestCommand ? (
          <div className={`command-status ${latestCommand.status}`}>
            {latestCommand.status === "executed"
              ? `✅ ${latestCommand.command_type === "TURN_ON" ? "Turn On" : "Turn Off"} confirmed`
              : `${latestCommand.command_type} — ${latestCommand.status}`}
          </div>
        ) : null}
      </div>
    </article>
  );
}