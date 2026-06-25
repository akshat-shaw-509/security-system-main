import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "../components/LucideIcon.jsx";
import { DEVICE_TYPES, deviceIcon, normalizeText } from "../utils/helpers.js";

const CATEGORY_TABS = [
  { id: "all", label: "All Devices", icon: "LayoutDashboard" },
  { id: "hubs", label: "ESP Hubs", icon: "Cpu" },
  { id: "light", label: "Lights" },
  { id: "sensor", label: "Sensors" },
  { id: "switch", label: "Switches" },
  { id: "camera", label: "Cameras" },
  { id: "lock", label: "Locks" },
  { id: "other", label: "Others" },
];

const DEVICES_PER_PAGE = 8;

function categoryFor(device) {
  const value = normalizeText(`${device.device_name} ${device.device_type}`);
  if (value.includes("light")) return "light";
  if (value.includes("sensor") || value.includes("motion")) return "sensor";
  if (value.includes("camera") || value.includes("cctv")) return "camera";
  if (value.includes("lock")) return "lock";
  if (value.includes("switch") || value.includes("socket") || value.includes("plug")) return "switch";
  return "other";
}

function toneFor(device) {
  const category = categoryFor(device);
  if (category === "light") return "amber";
  if (category === "sensor") return "blue";
  if (category === "camera") return "cyan";
  if (category === "lock") return "purple";
  if (device.device_type === "ac") return "red";
  return "green";
}

function statusFor(device) {
  const type = normalizeText(device.device_type || "");
  const state = String(device.state || "").toUpperCase();
  if (type.includes("lock")) return state === "OFF" ? "UNLOCKED" : "LOCKED";
  if (type.includes("camera")) return device.is_online ? "LIVE" : "OFFLINE";
  if (type.includes("sensor")) return state || (device.is_online ? "ACTIVE" : "CLOSED");
  return state === "ON" ? "ON" : "OFF";
}

function footerMeta(device) {
  const category = categoryFor(device);
  const age = device.presence_age_seconds;
  const lastSeen = age == null ? "Now" : age < 60 ? `${Math.max(age, 1)}s ago` : `${Math.round(age / 60)}m ago`;

  if (device.device_type === "ac") {
    return { icon: "Snowflake", text: "24 C", detail: "Cool" };
  }
  if (category === "camera") {
    return { icon: "Wifi", text: "Wi-Fi", detail: lastSeen };
  }
  if (category === "lock") {
    return { icon: "Lock", text: "Battery: 80%", detail: "" };
  }
  if (category === "switch") {
    return { icon: "Plug", text: device.is_online ? "Connected" : "Disconnected", detail: lastSeen };
  }
  if (category === "sensor") {
    return { icon: "Zap", text: device.is_online ? "100%" : "Idle", detail: lastSeen };
  }
  return { icon: device.device_type === "tv" ? "Wifi" : "Zap", text: device.device_type === "tv" ? "Wi-Fi" : "100%", detail: lastSeen };
}

export default function DevicesView() {
  const {
    devices,
    espModules,
    metrics,
    currentUser,
    registerEspModule,
    registerDevice,
    updateDevice,
    deleteDevice,
    sendCommand,
  } = useApp();
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEspForm, setShowEspForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [name, setName] = useState("");
  const [deviceType, setDeviceType] = useState("light");
  const [room, setRoom] = useState("");
  const [espUid, setEspUid] = useState("");
  const [espName, setEspName] = useState("");
  const [espLocation, setEspLocation] = useState("");

  const filteredDevices = useMemo(() => {
    const query = normalizeText(search);
    return devices.filter((device) => {
      const matchesCategory = activeCategory === "all" || activeCategory === "hubs" || categoryFor(device) === activeCategory;
      const haystack = normalizeText(`${device.device_name} ${device.device_type} ${device.room || ""} ${device.esp_name || ""}`);
      const matchesSearch = !query || haystack.includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [devices, activeCategory, search]);

  const groupedDevices = useMemo(() => {
    const query = normalizeText(search);
    const childrenByEsp = new Map();
    const standalone = [];

    filteredDevices.forEach((device) => {
      if (device.esp_uid) {
        const current = childrenByEsp.get(device.esp_uid) || [];
        childrenByEsp.set(device.esp_uid, [...current, device]);
      } else {
        standalone.push(device);
      }
    });

    const hubs = espModules
      .map((hub) => {
        const children = childrenByEsp.get(hub.esp_uid) || [];
        const hubMatches = !query || normalizeText(`${hub.esp_name} ${hub.location || ""} ${hub.esp_uid}`).includes(query);
        const visibleChildren = hubMatches && activeCategory === "all"
          ? devices.filter((device) => device.esp_uid === hub.esp_uid)
          : children;
        return { ...hub, children: visibleChildren, hubMatches };
      })
      .filter((hub) => {
        if (activeCategory === "hubs") {
          return !query || hub.hubMatches || hub.children.length > 0;
        }
        return hub.children.length > 0 || (activeCategory === "all" && hub.hubMatches);
      });

    return { hubs, standalone };
  }, [devices, espModules, filteredDevices, activeCategory, search]);

  const showHubLayout = activeCategory === "all" || activeCategory === "hubs";
  const flatListDevices = showHubLayout ? groupedDevices.standalone : filteredDevices;
  const pageCount = Math.max(1, Math.ceil(flatListDevices.length / DEVICES_PER_PAGE));
  const pagedDevices = activeCategory === "hubs"
    ? []
    : flatListDevices.slice((currentPage - 1) * DEVICES_PER_PAGE, currentPage * DEVICES_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, search]);

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  const openAddForm = (hub = null) => {
    setEditingDevice(null);
    setName("");
    setRoom("");
    setDeviceType("light");
    setEspUid(hub?.esp_uid || "");
    setShowAddForm(true);
    setShowEspForm(false);
  };

  const openEditForm = (device) => {
    setEditingDevice(device);
    setName(device.device_name);
    setRoom(device.room || "");
    setDeviceType(device.device_type);
    setEspUid(device.esp_uid || "");
    setShowAddForm(true);
    setShowEspForm(false);
  };

  const closeForm = () => {
    setShowAddForm(false);
    setEditingDevice(null);
    setName("");
    setRoom("");
    setDeviceType("light");
    setEspUid("");
  };

  const openEspForm = () => {
    setShowEspForm(true);
    setShowAddForm(false);
    setEspName("");
    setEspLocation("");
  };

  const closeEspForm = () => {
    setShowEspForm(false);
    setEspName("");
    setEspLocation("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      device_type: deviceType,
      room: room.trim() || null,
      esp_uid: espUid || null,
    };
    if (!payload.name) return;

    if (editingDevice) {
      await updateDevice(editingDevice.device_id, payload);
    } else {
      await registerDevice(payload);
    }
    closeForm();
  };

  const handleEspSubmit = async (event) => {
    event.preventDefault();
    const payload = {
      name: espName.trim(),
      location: espLocation.trim() || null,
    };
    if (!payload.name) return;
    await registerEspModule(payload);
    closeEspForm();
  };

  const handleDelete = async (device) => {
    if (!window.confirm(`Delete ${device.device_name}? Rules, telemetry, and scene actions for it will also be removed.`)) return;
    await deleteDevice(device.device_id);
  };

  const handleToggle = async (device) => {
    if (categoryFor(device) === "sensor" || categoryFor(device) === "camera" || categoryFor(device) === "lock") return;
    const nextCommand = String(device.state).toUpperCase() === "ON" ? "TURN_OFF" : "TURN_ON";
    await sendCommand(device.device_id, nextCommand);
  };

  const renderDeviceCard = (device) => {
    const tone = toneFor(device);
    const status = statusFor(device);
    const isSwitchable = !["sensor", "camera", "lock"].includes(categoryFor(device));
    const isOn = status === "ON";
    const meta = footerMeta(device);

    return (
      <article className="reference-device-card" key={device.device_id}>
        <div className="reference-device-main">
          <div className={`reference-device-icon ${tone}`}>
            <LucideIcon name={deviceIcon(device)} />
          </div>
          <div className="reference-device-copy">
            <h3>{device.device_name}</h3>
            <p>{device.room || "Unassigned"}</p>
            {device.esp_name ? <small>via {device.esp_name}</small> : null}
          </div>
          <div className="reference-device-controls">
            <span className={`reference-status ${tone}`}>{status}</span>
            {isSwitchable ? (
              <button
                className={`reference-toggle ${isOn ? "on" : ""}`}
                type="button"
                aria-label={`Toggle ${device.device_name}`}
                aria-pressed={isOn}
                onClick={() => handleToggle(device)}
              >
                <span />
              </button>
            ) : null}
          </div>
        </div>
        <footer className="reference-device-footer">
          <span>
            <LucideIcon name={meta.icon} />
            {meta.text}
          </span>
          {meta.detail ? <i /> : null}
          {meta.detail ? <span>{meta.detail}</span> : null}
          <div className="reference-device-actions">
            <button type="button" title="Edit device" onClick={() => openEditForm(device)}>
              <LucideIcon name="Pencil" />
            </button>
            <button type="button" title="Delete device" onClick={() => handleDelete(device)}>
              <LucideIcon name="Trash2" />
            </button>
          </div>
        </footer>
      </article>
    );
  };

  const initials = (currentUser?.username || "K").slice(0, 1).toUpperCase();
  const firstShown = flatListDevices.length && activeCategory !== "hubs" ? (currentPage - 1) * DEVICES_PER_PAGE + 1 : 0;
  const lastShown = activeCategory === "hubs" ? 0 : Math.min(currentPage * DEVICES_PER_PAGE, flatListDevices.length);
  const visibleCount = activeCategory === "hubs" ? groupedDevices.hubs.length : flatListDevices.length;

  return (
    <section className="view active devices-reference-page">
      <header className="devices-reference-header">
        <div className="devices-reference-title">
          <h2>Devices</h2>
          <p>Manage ESP hubs and the devices connected to them.</p>
        </div>
        <label className="devices-reference-search" aria-label="Search devices">
          <LucideIcon name="Search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search hubs, rooms, devices..."
            type="search"
          />
        </label>
        <div className="devices-reference-tools">
          <div className="devices-online-pill">
            <span />
            {metrics.offline === 0 ? "All Devices Online" : `${metrics.offline} Offline`}
          </div>
          <button className="devices-round-btn" type="button" title="Notifications">
            <LucideIcon name="Bell" />
            <i />
          </button>
          <button className="devices-round-btn" type="button" title="Dark mode">
            <LucideIcon name="Moon" />
          </button>
          <div className="devices-avatar" aria-hidden="true">{initials}</div>
        </div>
      </header>

      <div className="devices-reference-nav">
        <div className="devices-tabs" aria-label="Device categories">
          {CATEGORY_TABS.map((tab) => (
            <button
              className={activeCategory === tab.id ? "active" : ""}
              type="button"
              key={tab.id}
              onClick={() => setActiveCategory(tab.id)}
            >
              {tab.icon ? <LucideIcon name={tab.icon} /> : null}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="devices-reference-actions">
          <button className="devices-add-btn secondary-action" type="button" onClick={openEspForm}>
            <LucideIcon name="Cpu" />
            <span>Add ESP Hub</span>
          </button>
          <button className="devices-add-btn" type="button" onClick={() => openAddForm()}>
            <LucideIcon name="Plus" />
            <span>Add Device</span>
          </button>
        </div>
      </div>

      {showEspForm ? (
        <form className="devices-add-panel esp-add-panel" onSubmit={handleEspSubmit}>
          <div className="field">
            <label htmlFor="espName">ESP hub name</label>
            <input
              id="espName"
              value={espName}
              onChange={(event) => setEspName(event.target.value)}
              placeholder="Living Room ESP"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="espLocation">Location</label>
            <input
              id="espLocation"
              value={espLocation}
              onChange={(event) => setEspLocation(event.target.value)}
              placeholder="Living Room"
            />
          </div>
          <button className="devices-add-btn" type="submit">
            <LucideIcon name="Save" />
            <span>Add Hub</span>
          </button>
          <button className="btn secondary" type="button" onClick={closeEspForm}>
            Cancel
          </button>
        </form>
      ) : null}

      {showAddForm ? (
        <form className="devices-add-panel" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="deviceName">{editingDevice ? "Edit device" : "Device name"}</label>
            <input
              id="deviceName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Smart Light"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="deviceType">Type</label>
            <select
              id="deviceType"
              value={deviceType}
              onChange={(event) => setDeviceType(event.target.value)}
            >
              {DEVICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="deviceRoom">Room</label>
            <input
              id="deviceRoom"
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              placeholder="Living Room"
            />
          </div>
          <div className="field">
            <label htmlFor="espHub">ESP hub</label>
            <select
              id="espHub"
              value={espUid}
              onChange={(event) => setEspUid(event.target.value)}
            >
              <option value="">Standalone device</option>
              {espModules.map((hub) => (
                <option key={hub.esp_uid} value={hub.esp_uid}>
                  {hub.esp_name}
                </option>
              ))}
            </select>
          </div>
          <button className="devices-add-btn" type="submit">
            <LucideIcon name="Save" />
            <span>{editingDevice ? "Save Device" : "Add Device"}</span>
          </button>
          <button className="btn secondary" type="button" onClick={closeForm}>
            Cancel
          </button>
        </form>
      ) : null}

      {showHubLayout && groupedDevices.hubs.length ? (
        <div className="esp-hub-list">
          {groupedDevices.hubs.map((hub) => (
            <section className="esp-hub-panel" key={hub.esp_uid}>
              <header className="esp-hub-header">
                <div className="esp-hub-title">
                  <span className="esp-hub-icon">
                    <LucideIcon name="Cpu" />
                  </span>
                  <div>
                    <h3>{hub.esp_name}</h3>
                    <p>{hub.location || "No location assigned"}</p>
                  </div>
                </div>
                <div className="esp-hub-meta">
                  <span>{hub.children.length} connected</span>
                  <span>{hub.is_active ? "Active" : "Inactive"}</span>
                  <button type="button" onClick={() => openAddForm(hub)}>
                    <LucideIcon name="Plus" />
                    <span>Add Child</span>
                  </button>
                </div>
              </header>
              {hub.children.length ? (
                <div className="devices-reference-grid hub-device-grid">
                  {hub.children.map((device) => renderDeviceCard(device))}
                </div>
              ) : (
                <div className="empty hub-empty">No child devices connected</div>
              )}
            </section>
          ))}
        </div>
      ) : null}

      {activeCategory !== "hubs" ? (
        <div className="devices-reference-grid">
          {pagedDevices.length ? pagedDevices.map((device) => renderDeviceCard(device)) : (
            !groupedDevices.hubs.length ? <div className="empty devices-empty">No devices match your filters</div> : null
          )}
        </div>
      ) : (
        !groupedDevices.hubs.length ? <div className="empty devices-empty">No ESP hubs match your filters</div> : null
      )}

      <footer className="devices-reference-footer">
        <span>
          {activeCategory === "hubs"
            ? `${visibleCount} ESP hub${visibleCount === 1 ? "" : "s"}`
            : `Showing ${firstShown} to ${lastShown} of ${visibleCount} standalone device${visibleCount === 1 ? "" : "s"}`}
        </span>
        {activeCategory !== "hubs" && pageCount > 1 ? (
          <div className="devices-pagination">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            >
              <LucideIcon name="ArrowLeft" />
            </button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <button
                className={currentPage === page ? "active" : ""}
                type="button"
                key={page}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage === pageCount}
              onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
            >
              <LucideIcon name="ChevronDown" />
            </button>
          </div>
        ) : null}
      </footer>
    </section>
  );
}
