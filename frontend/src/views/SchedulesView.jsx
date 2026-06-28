import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "../components/LucideIcon.jsx";

const DAY_OPTIONS = [
  ["0", "Mon"],
  ["1", "Tue"],
  ["2", "Wed"],
  ["3", "Thu"],
  ["4", "Fri"],
  ["5", "Sat"],
  ["6", "Sun"],
];

const REPEAT_LABELS = {
  once: "Once",
  daily: "Every day",
  weekly: "Weekly",
  monthly: "Monthly",
};

const ICONS = ["CalendarDays", "Clock3", "Sun", "Moon", "Lightbulb"];
const TONES = ["amber", "violet", "green"];

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
}

function toIsoDate(value, endOfDay = false) {
  if (!value) return null;
  const suffix = endOfDay ? "T23:59:59" : "T00:00:00";
  return `${value}${suffix}`;
}

function formatDateTime(value) {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTime(value) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function describeDays(value) {
  const selected = new Set((value || "").split(",").filter(Boolean));
  if (!selected.size) return "No days selected";
  if (selected.size === 7) return "Every day";
  return DAY_OPTIONS.filter(([id]) => selected.has(id)).map(([, label]) => label).join(", ");
}

function dateInputValue(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export default function SchedulesView() {
  const {
    schedules,
    scenes,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    enableSchedule,
    disableSchedule,
    runSchedule,
    getScheduleHistory,
    toast,
  } = useApp();

  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [historySchedule, setHistorySchedule] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    scene_id: "",
    repeat_type: "daily",
    days_of_week: "0,1,2,3,4,5,6",
    execution_time: "07:00",
    start_date: "",
    end_date: "",
    timezone: defaultTimezone(),
    enabled: true,
  });

  const scheduleCount = schedules.length;
  const activeCount = schedules.filter((schedule) => schedule.enabled).length;
  const inactiveCount = Math.max(scheduleCount - activeCount, 0);

  const sceneById = useMemo(
    () => new Map(scenes.map((scene) => [scene.scene_id, scene])),
    [scenes],
  );

  const visibleSchedules = schedules.filter((schedule) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && schedule.enabled) ||
      (filter === "inactive" && !schedule.enabled);
    const haystack = [
      schedule.name,
      schedule.scene_name,
      REPEAT_LABELS[schedule.repeat_type],
      schedule.execution_time,
      schedule.timezone,
    ].join(" ").toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  });

  const resetForm = () => {
    setEditingSchedule(null);
    setForm({
      name: "",
      scene_id: "",
      repeat_type: "daily",
      days_of_week: "0,1,2,3,4,5,6",
      execution_time: "07:00",
      start_date: "",
      end_date: "",
      timezone: defaultTimezone(),
      enabled: true,
    });
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleDay = (day) => {
    setForm((current) => {
      const selected = new Set((current.days_of_week || "").split(",").filter(Boolean));
      if (selected.has(day)) {
        selected.delete(day);
      } else {
        selected.add(day);
      }
      return {
        ...current,
        days_of_week: DAY_OPTIONS.map(([id]) => id).filter((id) => selected.has(id)).join(","),
      };
    });
  };

  const beginEdit = (schedule) => {
    setEditingSchedule(schedule);
    setShowCreate(true);
    setForm({
      name: schedule.name || "",
      scene_id: String(schedule.scene_id || ""),
      repeat_type: schedule.repeat_type || "daily",
      days_of_week: schedule.days_of_week || "0,1,2,3,4,5,6",
      execution_time: schedule.execution_time || "07:00",
      start_date: dateInputValue(schedule.start_date),
      end_date: dateInputValue(schedule.end_date),
      timezone: schedule.timezone || defaultTimezone(),
      enabled: Boolean(schedule.enabled),
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const sceneId = Number(form.scene_id || scenes[0]?.scene_id);
    if (!sceneId) {
      toast("Create a scene before adding a schedule", "error");
      return;
    }
    const linkedScene = sceneById.get(sceneId);
    const payload = {
      name: (form.name || linkedScene?.name || "Scheduled Scene").trim(),
      scene_id: sceneId,
      enabled: form.enabled,
      repeat_type: form.repeat_type,
      days_of_week: form.repeat_type === "weekly" ? form.days_of_week || "0" : null,
      execution_time: form.execution_time,
      start_date: toIsoDate(form.start_date),
      end_date: toIsoDate(form.end_date, true),
      timezone: form.timezone || defaultTimezone(),
    };

    if (editingSchedule) {
      await updateSchedule(editingSchedule.schedule_id, payload);
    } else {
      await createSchedule(payload);
    }
    resetForm();
    setShowCreate(false);
  };

  const handleToggle = async (schedule) => {
    if (schedule.enabled) {
      await disableSchedule(schedule.schedule_id);
    } else {
      await enableSchedule(schedule.schedule_id);
    }
  };

  const handleDelete = async (schedule) => {
    if (!window.confirm(`Delete ${schedule.name}?`)) return;
    await deleteSchedule(schedule.schedule_id);
  };

  const openHistory = async (schedule) => {
    setHistorySchedule(schedule);
    setHistoryItems([]);
    setHistoryLoading(true);
    try {
      const items = await getScheduleHistory(schedule.schedule_id);
      setHistoryItems(items);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setHistoryLoading(false);
    }
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search schedules..."
            />
          </label>

          <div className="schedule-tabs" role="tablist" aria-label="Schedule status">
            {[
              ["all", "All", scheduleCount],
              ["active", "Active", activeCount],
              ["inactive", "Inactive", inactiveCount],
            ].map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
                <span className="tab-count">{count}</span>
              </button>
            ))}
          </div>

          <button
            className="btn schedules-add"
            type="button"
            onClick={() => {
              if (showCreate) {
                resetForm();
              }
              setShowCreate((value) => !value);
            }}
          >
            <LucideIcon name="Plus" />
            <span>Add Schedule</span>
          </button>
        </div>

        {showCreate && (
          <section className="schedule-create-panel">
            <div className="section-head">
              <div>
                <h3>{editingSchedule ? "Edit Schedule" : "Create Schedule"}</h3>
                <span>Attach a saved scene to a repeatable time</span>
              </div>
            </div>
            <form className="schedule-form schedule-builder" onSubmit={handleSubmit}>
              <div className="schedule-form-row">
                <div className="field">
                  <label htmlFor="scheduleName">Name</label>
                  <input
                    id="scheduleName"
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    placeholder="Morning security check"
                  />
                </div>
                <div className="field">
                  <label htmlFor="scheduleScene">Scene</label>
                  <select
                    id="scheduleScene"
                    value={form.scene_id || (scenes[0] ? String(scenes[0].scene_id) : "")}
                    onChange={(event) => updateForm("scene_id", event.target.value)}
                    disabled={!scenes.length}
                    required
                  >
                    {!scenes.length ? <option value="">No scenes available</option> : null}
                    {scenes.map((scene) => (
                      <option key={scene.scene_id} value={scene.scene_id}>
                        {scene.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="scheduleRepeat">Repeat</label>
                  <select
                    id="scheduleRepeat"
                    value={form.repeat_type}
                    onChange={(event) => updateForm("repeat_type", event.target.value)}
                  >
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="scheduleTime">Time</label>
                  <input
                    id="scheduleTime"
                    type="time"
                    value={form.execution_time}
                    onChange={(event) => updateForm("execution_time", event.target.value)}
                    required
                  />
                </div>
              </div>

              {form.repeat_type === "weekly" && (
                <div className="field">
                  <label>Days</label>
                  <div className="schedule-day-pills">
                    {DAY_OPTIONS.map(([id, label]) => {
                      const selected = form.days_of_week.split(",").includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`day-pill${selected ? " active" : ""}`}
                          onClick={() => toggleDay(id)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="schedule-form-row">
                <div className="field">
                  <label htmlFor="scheduleStart">Start Date</label>
                  <input
                    id="scheduleStart"
                    type="date"
                    value={form.start_date}
                    onChange={(event) => updateForm("start_date", event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="scheduleEnd">End Date</label>
                  <input
                    id="scheduleEnd"
                    type="date"
                    value={form.end_date}
                    onChange={(event) => updateForm("end_date", event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="scheduleTimezone">Timezone</label>
                  <input
                    id="scheduleTimezone"
                    value={form.timezone}
                    onChange={(event) => updateForm("timezone", event.target.value)}
                    placeholder="Asia/Kolkata"
                  />
                </div>
                <div className="field schedule-enabled-row">
                  <label className="toggle-label">
                    <input
                      className="toggle-input"
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) => updateForm("enabled", event.target.checked)}
                    />
                    <span className="toggle-track" />
                    <span>Enabled</span>
                  </label>
                </div>
              </div>

              <div className="schedule-form-actions">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowCreate(false);
                  }}
                >
                  Cancel
                </button>
                <button className="btn" type="submit" disabled={!scenes.length}>
                  <LucideIcon name="Save" />
                  <span>{editingSchedule ? "Save Changes" : "Save Schedule"}</span>
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="schedule-list-panel">
          <div className="schedule-list" aria-live="polite">
            {!visibleSchedules.length ? (
              <div className="schedules-empty">
                <LucideIcon name="CalendarDays" />
                <p>{schedules.length ? "No schedules match your search" : "No schedules yet"}</p>
                <span>
                  {scenes.length
                    ? "Create a schedule from any saved scene."
                    : "Create a scene first, then attach it to a schedule."}
                </span>
                {scenes.length ? (
                  <button className="btn" type="button" onClick={() => setShowCreate(true)}>
                    <LucideIcon name="Plus" />
                    <span>Add Schedule</span>
                  </button>
                ) : null}
              </div>
            ) : (
              visibleSchedules.map((schedule, index) => {
                const repeatLabel = REPEAT_LABELS[schedule.repeat_type] || schedule.repeat_type;
                const icon = ICONS[index % ICONS.length];
                const tone = TONES[index % TONES.length];
                return (
                  <article
                    className={`schedule-row${schedule.enabled ? "" : " disabled"}`}
                    key={schedule.schedule_id}
                  >
                    <div className={`schedule-icon ${tone}`}>
                      <LucideIcon name={icon} />
                    </div>
                    <div className="schedule-copy">
                      <div className="schedule-name-row">
                        <h3>{schedule.name}</h3>
                        {!schedule.enabled ? <span className="demo-badge">Paused</span> : null}
                      </div>
                      <div className="schedule-meta">
                        <span className="meta-pill">
                          <LucideIcon name="Clock3" size={14} />
                          {formatTime(schedule.execution_time)}
                        </span>
                        <span className="meta-pill">
                          <LucideIcon name="CalendarDays" size={14} />
                          {repeatLabel}
                        </span>
                        {schedule.repeat_type === "weekly" ? (
                          <span className="meta-pill">{describeDays(schedule.days_of_week)}</span>
                        ) : null}
                      </div>
                      <div className="schedule-scene-ref">
                        <LucideIcon name="Clapperboard" size={14} />
                        <span>{schedule.scene_name || sceneById.get(schedule.scene_id)?.name || "Linked scene"}</span>
                      </div>
                      <div className="schedule-timing">
                        <span>
                          Next <strong>{formatDateTime(schedule.next_run)}</strong>
                        </span>
                        <span className="sep">/</span>
                        <span>
                          Last <strong>{formatDateTime(schedule.last_run)}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="schedule-actions">
                      <button
                        className={`schedule-status ${schedule.enabled ? "on" : "off"}`}
                        type="button"
                        onClick={() => handleToggle(schedule)}
                        title={schedule.enabled ? "Disable schedule" : "Enable schedule"}
                      >
                        {schedule.enabled ? "ON" : "OFF"}
                      </button>
                      <button
                        className="schedule-icon-btn run"
                        type="button"
                        onClick={() => runSchedule(schedule.schedule_id)}
                        title="Run now"
                        aria-label={`Run ${schedule.name}`}
                      >
                        <LucideIcon name="Play" />
                      </button>
                      <button
                        className="schedule-icon-btn edit"
                        type="button"
                        onClick={() => beginEdit(schedule)}
                        title="Edit schedule"
                        aria-label={`Edit ${schedule.name}`}
                      >
                        <LucideIcon name="Pencil" />
                      </button>
                      <button
                        className="schedule-icon-btn history"
                        type="button"
                        onClick={() => openHistory(schedule)}
                        title="View history"
                        aria-label={`View ${schedule.name} history`}
                      >
                        <LucideIcon name="Clock3" />
                      </button>
                      <button
                        className="schedule-icon-btn delete"
                        type="button"
                        onClick={() => handleDelete(schedule)}
                        title="Delete schedule"
                        aria-label={`Delete ${schedule.name}`}
                      >
                        <LucideIcon name="Trash2" />
                      </button>
                    </div>
                  </article>
                );
              })
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

      {historySchedule && (
        <aside className="schedule-history-drawer" aria-label={`${historySchedule.name} history`}>
          <header className="schedule-history-header">
            <h4>{historySchedule.name} History</h4>
            <button
              className="history-close"
              type="button"
              onClick={() => setHistorySchedule(null)}
              aria-label="Close history"
            >
              <LucideIcon name="X" size={18} />
            </button>
          </header>
          {historyLoading ? (
            <div className="schedule-history-loading">
              <LucideIcon name="Loader" size={16} />
              Loading history
            </div>
          ) : !historyItems.length ? (
            <div className="schedule-history-empty">No runs recorded yet</div>
          ) : (
            <ul className="schedule-history-list">
              {historyItems.map((item) => (
                <li
                  className={`history-row ${item.success ? "ok" : "fail"}`}
                  key={item.execution_id}
                >
                  <span className="history-dot" />
                  <div className="history-body">
                    <span className="history-time">{formatDateTime(item.executed_at)}</span>
                    <span className="history-scene">{item.scene_name || "Scene"}</span>
                    <span className="history-cmds">
                      {item.success
                        ? `${item.commands_created} command${item.commands_created === 1 ? "" : "s"} queued`
                        : item.error_message || "Run failed"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </section>
  );
}
