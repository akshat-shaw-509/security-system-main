import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import EventList from "../components/EventList.jsx";
import LucideIcon from "../components/LucideIcon.jsx";

const DEMO_RULES = [
  {
    id: "demo-motion",
    name: "Motion detected at Entrance",
    summary: "When motion is detected -> Turn on entrance lights",
    icon: "Radar",
    tone: "blue",
    is_active: true,
  },
  {
    id: "demo-temp",
    name: "Temperature > 28C in Living Room",
    summary: "If temperature is high -> Turn on AC",
    icon: "Snowflake",
    tone: "blue",
    is_active: true,
  },
  {
    id: "demo-door",
    name: "If Front Door unlocked",
    summary: "Send notification to phone",
    icon: "Lock",
    tone: "violet",
    is_active: true,
  },
  {
    id: "demo-window",
    name: "If Window opened in Bedroom",
    summary: "Turn off AC",
    icon: "Square",
    tone: "amber",
    is_active: false,
  },
  {
    id: "demo-sunset",
    name: "At Sun set",
    summary: "Turn on porch lights",
    icon: "Sun",
    tone: "amber",
    is_active: true,
  },
  {
    id: "demo-night",
    name: "Every day at 10:00 PM",
    summary: "Turn off all lights and devices",
    icon: "Clock3",
    tone: "violet",
    is_active: true,
  },
];

const INTEGRATIONS = [
  ["Wifi", "Device Network", "Online device triggers"],
  ["Mic", "Voice Commands", "Scene and rule shortcuts"],
  ["ShieldCheck", "Security Events", "Motion and access alerts"],
];

function deviceLabel(devices, id) {
  const device = devices.find((item) => Number(item.device_id) === Number(id));
  return device?.device_name || `Device #${id}`;
}

function iconForRule(rule) {
  const text = `${rule.name} ${rule.condition_type}`.toLowerCase();
  if (text.includes("temperature")) return ["Snowflake", "blue"];
  if (text.includes("humidity")) return ["Fan", "blue"];
  if (text.includes("door") || text.includes("lock")) return ["Lock", "violet"];
  if (text.includes("window")) return ["Square", "amber"];
  if (text.includes("sun")) return ["Sun", "amber"];
  if (text.includes("time") || text.includes("day")) return ["Clock3", "violet"];
  return ["Radar", "blue"];
}

function summarizeRule(rule, devices) {
  const sensor = deviceLabel(devices, rule.device_id);
  const action = deviceLabel(devices, rule.action_device_id);
  const condition = [rule.condition_type, rule.operator, rule.value].filter(Boolean).join(" ");
  const command = rule.action_command === "TURN_OFF" ? "Turn off" : "Turn on";
  return `If ${condition || "condition matches"} on ${sensor} -> ${command} ${action}`;
}

function ruleViewModel(rule, devices) {
  const [icon, tone] = iconForRule(rule);
  return {
    id: rule.rule_id,
    rule,
    name: rule.name,
    summary: summarizeRule(rule, devices),
    icon,
    tone,
    is_active: rule.is_active,
  };
}

export default function AutomationView() {
  const {
    rules,
    scenes,
    devices,
    events,
    createScene,
    createRule,
    updateRule,
    deleteRule,
    runScene,
    clearEvents,
  } = useApp();
  const [tab, setTab] = useState("rules");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [runningScenes, setRunningScenes] = useState({});
  const [ruleName, setRuleName] = useState("");
  const [ruleSensor, setRuleSensor] = useState("");
  const [conditionType, setConditionType] = useState("motion");
  const [conditionOperator, setConditionOperator] = useState("");
  const [conditionValue, setConditionValue] = useState("");
  const [actionDevice, setActionDevice] = useState("");
  const [actionCommand, setActionCommand] = useState("TURN_ON");
  const [sceneName, setSceneName] = useState("");
  const [sceneDevice, setSceneDevice] = useState("");
  const [sceneCommand, setSceneCommand] = useState("TURN_ON");
  const [scenePayload, setScenePayload] = useState("");

  const sensorId = ruleSensor || (devices[0] ? String(devices[0].device_id) : "");
  const actionId = actionDevice || (devices[0] ? String(devices[0].device_id) : "");
  const sceneDeviceId = sceneDevice || (devices[0] ? String(devices[0].device_id) : "");
  const canCreate = tab !== "integrations";
  const createLabel = tab === "scenes" ? "Create Scene" : "Create Rule";
  const usingSampleRules = !rules.length;
  const ruleRows = useMemo(
    () => (rules.length ? rules.map((rule) => ruleViewModel(rule, devices)) : DEMO_RULES),
    [rules, devices],
  );

  const filteredRules = ruleRows.filter((rule) =>
    `${rule.name} ${rule.summary}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const filteredScenes = scenes.filter((scene) =>
    scene.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (tab === "scenes") {
      if (!sceneDeviceId) return;
      await createScene({
        name: sceneName,
        actions: [
          {
            device_id: Number(sceneDeviceId),
            command_type: sceneCommand,
            payload: scenePayload || null,
          },
        ],
      });
      setSceneName("");
      setScenePayload("");
      setShowCreate(false);
      return;
    }

    if (!sensorId || !actionId) return;
    await createRule({
      name: ruleName,
      device_id: Number(sensorId),
      condition_type: conditionType,
      operator: conditionOperator || null,
      value: conditionValue || null,
      action_device_id: Number(actionId),
      action_command: actionCommand,
    });
    setRuleName("");
    setConditionValue("");
    setConditionOperator("");
    setShowCreate(false);
  };

  const handleToggle = async (item) => {
    if (!item.rule) return;
    await updateRule(item.rule.rule_id, { is_active: !item.rule.is_active });
  };

  const handleMore = async (item) => {
    if (!item.rule) return;
    const next = window.prompt("Rename rule, or type DELETE to remove it", item.name);
    if (!next || next === item.name) return;
    if (next === "DELETE") {
      if (window.confirm(`Delete ${item.name}?`)) await deleteRule(item.rule.rule_id);
      return;
    }
    await updateRule(item.rule.rule_id, { name: next });
  };

  const handleSceneControl = async (scene) => {
    if (runningScenes[scene.scene_id]) {
      setRunningScenes((current) => ({ ...current, [scene.scene_id]: false }));
      return;
    }

    setRunningScenes((current) => ({ ...current, [scene.scene_id]: true }));
    await runScene(scene.scene_id);
  };

  return (
    <section className="view active view-automation">
      <div className="automation-page">
        <div className="automation-tools">
          <label className="automation-search" htmlFor="automationSearch">
            <LucideIcon name="Search" />
            <input
              id="automationSearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search automation..."
            />
          </label>

          <div className="automation-tabs" role="tablist" aria-label="Automation sections">
            {[
              ["rules", "Rules"],
              ["scenes", "Scenes"],
              ["integrations", "Integrations"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? "active" : ""}
                onClick={() => {
                  setTab(id);
                  setShowCreate(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {canCreate ? (
            <button
              className="btn automation-add"
              type="button"
              onClick={() => setShowCreate((value) => !value)}
            >
              <LucideIcon name="Plus" />
              <span>{createLabel}</span>
            </button>
          ) : null}
        </div>

        {showCreate && canCreate && (
          <section className="automation-create-panel">
            <div className="section-head">
              <div>
                <h3>{createLabel}</h3>
                <span>
                  {tab === "scenes"
                    ? "Save a reusable device action that schedules can run later"
                    : "Use a sensor condition to trigger a device command"}
                </span>
              </div>
            </div>
            <form className="automation-form" onSubmit={handleSubmit}>
              {tab === "scenes" ? (
                <>
                  <div className="field">
                    <label htmlFor="automationSceneName">Name</label>
                    <input
                      id="automationSceneName"
                      value={sceneName}
                      onChange={(e) => setSceneName(e.target.value)}
                      placeholder="Evening lights"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="automationSceneDevice">Device</label>
                    <select
                      id="automationSceneDevice"
                      value={sceneDeviceId}
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
                    <label htmlFor="automationSceneAction">Action</label>
                    <select
                      id="automationSceneAction"
                      value={sceneCommand}
                      onChange={(e) => setSceneCommand(e.target.value)}
                    >
                      <option value="TURN_ON">Turn on</option>
                      <option value="TURN_OFF">Turn off</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="automationScenePayload">Payload</label>
                    <input
                      id="automationScenePayload"
                      value={scenePayload}
                      onChange={(e) => setScenePayload(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="automationRuleName">Name</label>
                    <input
                      id="automationRuleName"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      placeholder="Motion at entrance"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="automationSensor">Sensor</label>
                    <select
                      id="automationSensor"
                      value={sensorId}
                      onChange={(e) => setRuleSensor(e.target.value)}
                    >
                      {devices.map((device) => (
                        <option key={device.device_id} value={device.device_id}>
                          {device.device_name} ({device.device_type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="automationCondition">Condition</label>
                    <select
                      id="automationCondition"
                      value={conditionType}
                      onChange={(e) => setConditionType(e.target.value)}
                    >
                      <option value="motion">motion</option>
                      <option value="temperature">temperature</option>
                      <option value="humidity">humidity</option>
                    </select>
                  </div>
                  <div className="field compact">
                    <label htmlFor="automationOperator">Op</label>
                    <select
                      id="automationOperator"
                      value={conditionOperator}
                      onChange={(e) => setConditionOperator(e.target.value)}
                    >
                      <option value="">none</option>
                      <option value=">">&gt;</option>
                      <option value="<">&lt;</option>
                      <option value="=">=</option>
                    </select>
                  </div>
                  <div className="field compact">
                    <label htmlFor="automationValue">Value</label>
                    <input
                      id="automationValue"
                      value={conditionValue}
                      onChange={(e) => setConditionValue(e.target.value)}
                      placeholder="28"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="automationActionDevice">Action Device</label>
                    <select
                      id="automationActionDevice"
                      value={actionId}
                      onChange={(e) => setActionDevice(e.target.value)}
                    >
                      {devices.map((device) => (
                        <option key={device.device_id} value={device.device_id}>
                          {device.device_name} ({device.device_type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="automationAction">Action</label>
                    <select
                      id="automationAction"
                      value={actionCommand}
                      onChange={(e) => setActionCommand(e.target.value)}
                    >
                      <option value="TURN_ON">Turn on</option>
                      <option value="TURN_OFF">Turn off</option>
                    </select>
                  </div>
                </>
              )}
              <button className="btn" type="submit" disabled={!devices.length}>
                <LucideIcon name={tab === "scenes" ? "Clapperboard" : "Workflow"} />
                <span>{tab === "scenes" ? "Save Scene" : "Save Rule"}</span>
              </button>
            </form>
          </section>
        )}

        {tab === "rules" && (
          <section className="automation-list-panel">
            {usingSampleRules ? (
              <p className="sample-data-banner">Sample rules shown — create a real rule below to replace these.</p>
            ) : null}
            <div className="automation-list">
              {!filteredRules.length ? (
                <div className="empty">
                  {rules.length
                    ? "No automation rules match your search"
                    : "Create your first automation rule to react to sensor telemetry from hardware."}
                </div>
              ) : (
                filteredRules.map((item) => (
                  <article className={`automation-row ${item.is_active ? "is-running" : "is-paused"}`} key={item.id}>
                    <div className={`automation-row-icon ${item.tone} ${item.is_active ? "running" : ""}`}>
                      <LucideIcon name={item.icon} />
                    </div>
                    <div className="automation-copy">
                      <h3>{item.name}</h3>
                      <p>{item.summary}</p>
                    </div>
                    <div className="automation-actions">
                      <span className={`automation-state ${item.is_active ? "active" : "inactive"}`}>
                        {item.is_active ? "Running" : "Paused"}
                      </span>
                      <button
                        className={`automation-run-control ${item.is_active ? "pause" : "resume"}`}
                        type="button"
                        onClick={() => handleToggle(item)}
                        disabled={!item.rule}
                        aria-label={`${item.is_active ? "Pause" : "Resume"} ${item.name}`}
                      >
                        <LucideIcon name={item.is_active ? "Pause" : "Play"} size={16} />
                        <span>{item.is_active ? "Pause" : "Resume"}</span>
                      </button>
                      <button
                        className="automation-more"
                        type="button"
                        onClick={() => handleMore(item)}
                        disabled={!item.rule}
                        aria-label={`More actions for ${item.name}`}
                      >
                        <LucideIcon name="MoreHorizontal" />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
            <footer className="automation-footer">
              <span>
                Showing {filteredRules.length ? 1 : 0} to {filteredRules.length} of {ruleRows.length} rules
              </span>
              <div className="automation-pagination" aria-label="Pagination">
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
        )}

        {tab === "scenes" && (
          <section className="automation-list-panel">
            <div className="automation-scene-grid">
              {!filteredScenes.length ? (
                <div className="empty">
                  {scenes.length
                    ? "No scenes match your search"
                    : "Create a scene here, then choose it from the Schedule page."}
                </div>
              ) : (
                filteredScenes.map((scene) => {
                  const isRunning = Boolean(runningScenes[scene.scene_id]);
                  return (
                  <article className={`automation-scene-card ${isRunning ? "is-running" : ""}`} key={scene.scene_id}>
                    <div className={`automation-scene-icon ${isRunning ? "running" : ""}`}>
                      <LucideIcon name={isRunning ? "Workflow" : "Clapperboard"} />
                    </div>
                    <div>
                      <h3>{scene.name}</h3>
                      <p>
                        {isRunning
                          ? "Scene is running now"
                          : `${scene.actions?.length || 0} action${scene.actions?.length === 1 ? "" : "s"} configured`}
                      </p>
                    </div>
                    <button
                      className={`automation-run-control ${isRunning ? "pause" : "resume"}`}
                      type="button"
                      onClick={() => handleSceneControl(scene)}
                    >
                      <LucideIcon name={isRunning ? "Pause" : "Play"} size={16} />
                      <span>{isRunning ? "Pause" : "Run"}</span>
                    </button>
                  </article>
                  );
                })
              )}
            </div>
          </section>
        )}

        {tab === "integrations" && (
          <section className="automation-list-panel">
            <div className="automation-integration-grid">
              {INTEGRATIONS.map(([icon, name, text]) => (
                <article className="automation-integration-card" key={name}>
                  <LucideIcon name={icon} />
                  <h3>{name}</h3>
                  <p>{text}</p>
                  <span>Connected</span>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="automation-live-panel">
          <div className="section-head">
            <div>
              <h3>Live Feed</h3>
              <span>WebSocket messages, voice commands, and automation activity kept for 72 hours</span>
            </div>
            <button className="btn secondary" type="button" title="Clear events" onClick={clearEvents}>
              <LucideIcon name="Trash2" />
              <span>Clear</span>
            </button>
          </div>
          <div className="live-feed automation-live-feed">
            <EventList items={events} variant="live-feed" />
          </div>
        </section>
      </div>
    </section>
  );
}
