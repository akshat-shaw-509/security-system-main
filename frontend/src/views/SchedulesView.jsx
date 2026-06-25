import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "../components/LucideIcon.jsx";

const DEMO_SCHEDULES = [
  {
    id: "demo-morning",
    name: "Morning Lights",
    cadence: "Weekdays",
    time: "06:00 AM",
    description: "Turn on lights in Living Room and Kitchen",
    icon: "Sun",
    tone: "amber",
    active: true,
  },
  {
    id: "demo-evening",
    name: "Evening Lights",
    cadence: "Everyday",
    time: "07:00 PM",
    description: "Turn on all lights and set to warm light",
    icon: "Lightbulb",
    tone: "amber",
    active: true,
  },
  {
    id: "demo-night",
    name: "Good Night",
    cadence: "Everyday",
    time: "11:00 PM",
    description: "Turn off all lights and AC",
    icon: "Moon",
    tone: "violet",
    active: true,
  },
  {
    id: "demo-weekend",
    name: "Weekend Mode",
    cadence: "Sat, Sun",
    time: "08:00 AM",
    description: "Security system armed",
    icon: "Lock",
    tone: "violet",
    active: false,
  },
  {
    id: "demo-away",
    name: "Away Mode",
    cadence: "When away",
    time: "",
    description: "Optimize power and security when away",
    icon: "Plane",
    tone: "green",
    active: true,
  },
];

function describeActions(scene) {
  const count = scene.actions?.length || 0;
  if (!count) return "Ready to run from this dashboard";
  return `${count} device action${count === 1 ? "" : "s"} configured`;
}

function scheduleFromScene(scene, index) {
  const defaults = DEMO_SCHEDULES[index % DEMO_SCHEDULES.length];
  return {
    id: scene.scene_id,
    scene,
    name: scene.name,
    cadence: "Scene",
    time: "On demand",
    description: describeActions(scene),
    icon: defaults.icon,
    tone: defaults.tone,
    active: true,
  };
}

export default function SchedulesView() {
  const { scenes, devices, runScene, createScene, updateScene, deleteScene } = useApp();
  const [sceneName, setSceneName] = useState("");
  const [sceneDevice, setSceneDevice] = useState("");
  const [sceneCommand, setSceneCommand] = useState("TURN_ON");
  const [scenePayload, setScenePayload] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const deviceId = sceneDevice || (devices[0] ? String(devices[0].device_id) : "");
  const usingSampleSchedules = !scenes.length;
  const schedules = useMemo(
    () => (scenes.length ? scenes.map(scheduleFromScene) : DEMO_SCHEDULES),
    [scenes],
  );

  const visibleSchedules = schedules.filter((schedule) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && schedule.active) ||
      (filter === "inactive" && !schedule.active);
    const haystack = `${schedule.name} ${schedule.cadence} ${schedule.time} ${schedule.description}`.toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!deviceId) return;
    await createScene({
      name: sceneName,
      actions: [
        {
          device_id: Number(deviceId),
          command_type: sceneCommand,
          payload: scenePayload || null,
        },
      ],
    });
    setSceneName("");
    setScenePayload("");
    setShowCreate(false);
  };

  const handleRename = async (schedule) => {
    if (!schedule.scene) return;
    const name = window.prompt("Schedule name", schedule.name);
    if (!name || name === schedule.name) return;
    await updateScene(schedule.scene.scene_id, { name });
  };

  const handleDelete = async (schedule) => {
    if (!schedule.scene) return;
    if (!window.confirm(`Delete ${schedule.name}?`)) return;
    await deleteScene(schedule.scene.scene_id);
  };

  const handleRun = (schedule) => {
    if (schedule.scene) runScene(schedule.scene.scene_id);
  };

  return (
    <section className="view active view-schedules">
      <div className="schedules-page">
        <div className="schedules-tools">
          <label className="schedules-search" htmlFor="scheduleSearch">
            <LucideIcon name="Search" />
            <input
              id="scheduleSearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search schedules..."
            />
          </label>

          <div className="schedule-tabs" role="tablist" aria-label="Schedule status">
            {[
              ["all", "All Schedules"],
              ["active", "Active"],
              ["inactive", "Inactive"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            className="btn schedules-add"
            type="button"
            onClick={() => setShowCreate((value) => !value)}
          >
            <LucideIcon name="Plus" />
            <span>Add Schedule</span>
          </button>
        </div>

        {showCreate && (
          <section className="schedule-create-panel">
            <div className="section-head">
              <div>
                <h3>Create Schedule</h3>
                <span>Build a repeatable scene from one device action</span>
              </div>
            </div>
            <form className="schedule-form" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="sceneName">Name</label>
                <input
                  id="sceneName"
                  value={sceneName}
                  onChange={(e) => setSceneName(e.target.value)}
                  placeholder="Movie Time"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="sceneDevice">Device</label>
                <select
                  id="sceneDevice"
                  value={deviceId}
                  onChange={(e) => setSceneDevice(e.target.value)}
                >
                  {devices.map((device) => (
                    <option key={device.device_id} value={device.device_id}>
                      {device.device_name} ({device.device_type})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sceneCommand">Command</label>
                <select
                  id="sceneCommand"
                  value={sceneCommand}
                  onChange={(e) => setSceneCommand(e.target.value)}
                >
                  <option value="TURN_ON">Turn on</option>
                  <option value="TURN_OFF">Turn off</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="scenePayload">Payload</label>
                <input
                  id="scenePayload"
                  value={scenePayload}
                  onChange={(e) => setScenePayload(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <button className="btn" type="submit" disabled={!devices.length}>
                <LucideIcon name="Save" />
                <span>Save Schedule</span>
              </button>
            </form>
          </section>
        )}

        <section className="schedule-list-panel">
          {usingSampleSchedules ? (
            <p className="sample-data-banner">Sample schedules shown — add a schedule to create real scenes.</p>
          ) : null}
          <div className="schedule-list" aria-live="polite">
            {!visibleSchedules.length ? (
              <div className="empty">
                {scenes.length
                  ? "No schedules match your search"
                  : "Create a schedule (scene) to run device commands on demand from the dashboard."}
              </div>
            ) : (
              visibleSchedules.map((schedule) => (
                <article className="schedule-row" key={schedule.id}>
                  <div className={`schedule-icon ${schedule.tone}`}>
                    <LucideIcon name={schedule.icon} />
                  </div>
                  <div className="schedule-copy">
                    <h3>{schedule.name}</h3>
                    <span>
                      {schedule.cadence}
                      {schedule.time ? `  -  ${schedule.time}` : ""}
                    </span>
                    <p>{schedule.description}</p>
                  </div>
                  <div className="schedule-actions">
                    <button
                      className={`schedule-status ${schedule.active ? "on" : "off"}`}
                      type="button"
                      onClick={() => handleRun(schedule)}
                      disabled={!schedule.scene}
                      title={schedule.scene ? "Run schedule now" : "Example schedule"}
                    >
                      {schedule.active ? "ON" : "OFF"}
                    </button>
                    <button
                      className="schedule-icon-btn edit"
                      type="button"
                      onClick={() => handleRename(schedule)}
                      disabled={!schedule.scene}
                      title={schedule.scene ? "Rename schedule" : "Example schedule"}
                      aria-label={`Rename ${schedule.name}`}
                    >
                      <LucideIcon name="Pencil" />
                    </button>
                    <button
                      className="schedule-icon-btn delete"
                      type="button"
                      onClick={() => handleDelete(schedule)}
                      disabled={!schedule.scene}
                      title={schedule.scene ? "Delete schedule" : "Example schedule"}
                      aria-label={`Delete ${schedule.name}`}
                    >
                      <LucideIcon name="Trash2" />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
          <footer className="schedule-footer">
            <span>
              Showing {visibleSchedules.length ? 1 : 0} to {visibleSchedules.length} of{" "}
              {schedules.length} schedules
            </span>
            <div className="schedule-pagination" aria-label="Pagination">
              <button type="button" disabled aria-label="Previous page">
                <LucideIcon name="ArrowLeft" size={18} />
              </button>
              <strong>1</strong>
              <button type="button" disabled aria-label="Next page">
                <LucideIcon name="ChevronDown" size={18} />
              </button>
            </div>
          </footer>
        </section>
      </div>
    </section>
  );
}
