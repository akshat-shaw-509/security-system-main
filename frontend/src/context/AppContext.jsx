import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Chart from "chart.js/auto";
import { api, authHeaders } from "../api/client.js";
import { BACKEND_PORT, WS_URL } from "../api/config.js";
import {
  commandTypeFromSpeech,
  findBestDevice,
  findBestScene,
  normalizeText,
} from "../utils/helpers.js";
import { buildRoomEntries, normalizeDashboard } from "../utils/energyUtils.js";

const AppContext = createContext(null);

const KNOWN_PEOPLE_KEY = "smart_home_known_people";
const TOKEN_KEY = "smart_home_token";
const EVENTS_KEY = "smart_home_live_feed";
const EVENT_RETENTION_MS = 72 * 60 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 5000;

function pruneEvents(items) {
  const cutoff = Date.now() - EVENT_RETENTION_MS;
  return items.filter((item) => new Date(item.time).getTime() >= cutoff);
}

function loadStoredEvents() {
  try {
    return pruneEvents(JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]"));
  } catch {
    localStorage.removeItem(EVENTS_KEY);
    return [];
  }
}

export function AppProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [currentUser, setCurrentUser] = useState(null);
  const [currentView, setCurrentView] = useState("overview");
  const [devices, setDevices] = useState([]);
  const [espModules, setEspModules] = useState([]);
  const [dashboard, setDashboard] = useState({});
  const [scenes, setScenes] = useState([]);
  const [rules, setRules] = useState([]);
  const [commandsByDevice, setCommandsByDevice] = useState({});
  const [events, setEvents] = useState(loadStoredEvents);
  const [alerts, setAlerts] = useState(0);
  const [knownPeople, setKnownPeople] = useState(() =>
    JSON.parse(localStorage.getItem(KNOWN_PEOPLE_KEY) || "[]"),
  );
  const [provisioningLog, setProvisioningLog] = useState([]);
  const [toasts, setToasts] = useState([]);

  const [backendStatus, setBackendStatus] = useState("checking");
  const [socketStatus, setSocketStatus] = useState("offline");
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("Speak a device or scene command.");
  const [voiceResult, setVoiceResult] = useState("Voice is ready");
  const [listening, setListening] = useState(false);

  const [telemetryDeviceId, setTelemetryDeviceId] = useState("");
  const [energySummary, setEnergySummary] = useState(null);
  const [motionEvents, setMotionEvents] = useState([]);
  const [authTab, setAuthTab] = useState("login");

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const wsShouldReconnectRef = useRef(true);
  const energyRefreshTimerRef = useRef(null);
  const recognitionRef = useRef(null);
  const refreshInFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const tempChartRef = useRef(null);
  const humidityChartRef = useRef(null);
  const tempCanvasRef = useRef(null);
  const humidityCanvasRef = useRef(null);

  const closeSocket = useCallback(() => {
    wsShouldReconnectRef.current = false;
    const socket = socketRef.current;
    if (!socket) return;
    socketRef.current = null;

    if (socket.readyState === WebSocket.CONNECTING) {
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = () => setSocketStatus("offline");
      socket.onopen = () => socket.close();
      return;
    }

    socket.close();
  }, []);

  const toast = useCallback((message) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const addEvent = useCallback((eventData) => {
    setEvents((prev) => {
      const next = pruneEvents([
        { time: new Date().toISOString(), data: eventData },
        ...prev,
      ]).slice(0, 100);
      localStorage.setItem(EVENTS_KEY, JSON.stringify(next));
      return next;
    });
    if (
      eventData.event === "rule_triggered" ||
      (eventData.event === "telemetry" && eventData.motion_detected)
    ) {
      setAlerts((a) => a + 1);
    }
  }, []);

  const switchView = useCallback(
    (viewId, options = {}) => {
      if (viewId !== "access" && !token) {
        setCurrentView("access");
        if (options.authTab) setAuthTab(options.authTab);
        return;
      }
      setCurrentView(viewId);
    },
    [token],
  );

  const goToLogin = useCallback(() => {
    setAuthTab("login");
    setCurrentView("access");
  }, []);

  const goToRegister = useCallback(() => {
    setAuthTab("register");
    setCurrentView("access");
  }, []);

  const checkBackend = useCallback(async () => {
    setBackendStatus("checking");
    try {
      await api("/health");
      setBackendStatus("online");
      return true;
    } catch {
      setBackendStatus("offline");
      toast(`Backend is not reachable. Start: python -m uvicorn app.main:app --reload --port ${BACKEND_PORT}`);
      return false;
    }
  }, [toast]);

  const loadDevices = useCallback(async () => {
    if (!token) return;
    const data = await api("/devices", { headers: authHeaders(token) });
    setDevices(data);
    if (data.length && !telemetryDeviceId) {
      setTelemetryDeviceId(String(data[0].device_id));
    }
  }, [token, telemetryDeviceId]);

  const loadEspModules = useCallback(async (authToken = token) => {
    if (!authToken) return [];
    const data = await api("/esp/modules", { headers: authHeaders(authToken) });
    setEspModules(data);
    return data;
  }, [token]);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    const data = await api("/dashboard", { headers: authHeaders(token) });
    setDashboard(normalizeDashboard(data));
  }, [token]);

  const loadEnergySummary = useCallback(async (range = "today", authToken = token, options = {}) => {
    if (!authToken) return null;
    try {
      const data = await api(`/energy/summary?range=${encodeURIComponent(range)}`, {
        headers: authHeaders(authToken),
      });
      setEnergySummary(data);
      return data;
    } catch (error) {
      if (!options.silent) {
        toast(error.message);
      }
      return null;
    }
  }, [token, toast]);

  const scheduleEnergyRefresh = useCallback(
    (range = "today") => {
      if (!token) return;
      if (energyRefreshTimerRef.current) {
        window.clearTimeout(energyRefreshTimerRef.current);
      }
      energyRefreshTimerRef.current = window.setTimeout(() => {
        loadEnergySummary(range, token, { silent: true });
      }, 2000);
    },
    [token, loadEnergySummary],
  );

  const loadScenes = useCallback(async () => {
    if (!token) return;
    const data = await api("/scenes", { headers: authHeaders(token) });
    setScenes(data);
  }, [token]);

  const loadRules = useCallback(async () => {
    if (!token) return;
    const data = await api("/rules", { headers: authHeaders(token) });
    setRules(data);
  }, [token]);

  const normalizeBackendEvents = useCallback((items) =>
    items.map((item) => ({
      time: item.created_at,
      data: {
        event: item.event,
        message: item.message,
        ...(item.payload || {}),
      },
    })),
  []);

  const loadEvents = useCallback(async (authToken = token) => {
    if (!authToken) return;
    const data = await api("/events?limit=100", { headers: authHeaders(authToken) });
    const normalized = normalizeBackendEvents(data);
    setEvents(normalized);
    localStorage.setItem(EVENTS_KEY, JSON.stringify(normalized));
  }, [token, normalizeBackendEvents]);

  const loadCurrentUser = useCallback(async (authToken = token) => {
    if (!authToken) return null;
    const data = await api("/protected", { headers: authHeaders(authToken) });
    const user = {
      username: data.user,
      email: data.email,
      phone: data.phone,
      organizationId: data.organization_id,
      createdAt: data.created_at,
    };
    setCurrentUser(user);
    return user;
  }, [token]);

  const loadCommandStatus = useCallback(async (deviceData, authToken = token) => {
    if (!authToken || !deviceData.length) {
      setCommandsByDevice({});
      return;
    }

    const entries = await Promise.all(
      deviceData.map(async (device) => {
        try {
          const commands = await api(`/devices/${device.device_id}/commands?limit=5`, {
            headers: authHeaders(authToken),
          });
          return [device.device_id, commands];
        } catch {
          return [device.device_id, []];
        }
      }),
    );

    setCommandsByDevice(Object.fromEntries(entries));
  }, [token]);

  const loadTelemetryHistory = useCallback(async (authToken = token, deviceId = telemetryDeviceId) => {
    if (!authToken || !deviceId || !tempChartRef.current || !humidityChartRef.current) return;

    try {
      const telemetry = await api(`/devices/${deviceId}/telemetry?limit=30`, {
        headers: authHeaders(authToken),
      });

      const sorted = [...telemetry].reverse();
      const labels = sorted.map((item) => new Date(item.created_at).toLocaleTimeString());
      tempChartRef.current.data.labels = labels;
      tempChartRef.current.data.datasets[0].data = sorted.map((item) => Number(item.temperature));
      humidityChartRef.current.data.labels = labels;
      humidityChartRef.current.data.datasets[0].data = sorted.map((item) => Number(item.humidity));
      tempChartRef.current.update();
      humidityChartRef.current.update();
    } catch (error) {
      toast(error.message);
    }
  }, [token, telemetryDeviceId, toast]);

  const refreshAll = useCallback(
    async (authToken = token, options = {}) => {
      const now = Date.now();
      if (refreshInFlightRef.current) return;
      if (!options.force && now - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return;
      refreshInFlightRef.current = true;
      lastRefreshAtRef.current = now;

      if (!authToken) {
        switchView("access");
        refreshInFlightRef.current = false;
        return;
      }
      try {
        const headers = authHeaders(authToken);
        if (!currentUser) {
          loadCurrentUser(authToken).catch(() => null);
        }
        const [deviceData, espData, dashboardData, sceneData, ruleData, eventData] = await Promise.all([
          api("/devices", { headers }),
          api("/esp/modules", { headers }),
          api("/dashboard", { headers }),
          api("/scenes", { headers }),
          api("/rules", { headers }),
          api("/events?limit=100", { headers }),
        ]);
        setDevices(deviceData);
        setEspModules(espData);
        setDashboard(normalizeDashboard(dashboardData));
        await loadEnergySummary("today", authToken);
        setScenes(sceneData);
        setRules(ruleData);
        const normalizedEvents = normalizeBackendEvents(eventData);
        setEvents(normalizedEvents);
        localStorage.setItem(EVENTS_KEY, JSON.stringify(normalizedEvents));
        await loadCommandStatus(deviceData, authToken);
        const selectedDeviceId =
          telemetryDeviceId || (deviceData[0] ? String(deviceData[0].device_id) : "");
        if (selectedDeviceId && !telemetryDeviceId) {
          setTelemetryDeviceId(selectedDeviceId);
        }
        if (selectedDeviceId) {
          await loadTelemetryHistory(authToken, selectedDeviceId);
        }
        setBackendStatus("online");
      } catch (error) {
        if (String(error.message).toLowerCase().includes("credentials")) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setCurrentUser(null);
          switchView("access");
          toast("Session expired. Please log in again.");
          return;
        }
        if (!String(error.message).includes("Too many requests")) {
          toast(error.message);
        }
      } finally {
        refreshInFlightRef.current = false;
      }
    },
    [token, switchView, telemetryDeviceId, loadTelemetryHistory, loadEnergySummary, toast, normalizeBackendEvents, loadCommandStatus, loadCurrentUser, currentUser],
  );

  const sendCommand = useCallback(
    async (deviceId, commandType, source = "manual") => {
      try {
        const data = await api(
          `/devices/${deviceId}/command?command_type=${encodeURIComponent(commandType)}`,
          { method: "POST", headers: authHeaders(token) },
        );
        const nextState = data.state || (commandType === "TURN_ON" ? "ON" : "OFF");
        const hasOnlineStatus = Object.prototype.hasOwnProperty.call(data, "is_online");
        const nextOnline = hasOnlineStatus ? Boolean(data.is_online) : commandType === "TURN_ON";
        const nextPresence = {
          state: nextState,
          is_online: nextOnline,
          presence_label: data.presence_label || (nextOnline ? "Live now" : "Offline"),
          presence_age_seconds: data.presence_age_seconds ?? 0,
          last_seen: data.last_seen || new Date().toISOString(),
        };
        setDevices((prev) =>
          prev.map((device) =>
            device.device_id === deviceId
              ? { ...device, ...nextPresence }
              : device,
          ),
        );
        setDashboard((prev) =>
          Object.fromEntries(
            Object.entries(normalizeDashboard(prev)).map(([room, roomData]) => [
              room,
              {
                ...roomData,
                devices: roomData.devices.map((device) =>
                  device.device_id === deviceId
                    ? { ...device, ...nextPresence }
                    : device,
                ),
              },
            ]),
          ),
        );
        setCommandsByDevice((prev) => ({
          ...prev,
          [deviceId]: [
            {
              command_id: data.command_id,
              command_type: commandType,
              payload: null,
              status: data.status || "pending",
              created_at: new Date().toISOString(),
            },
            ...(prev[deviceId] || []),
          ].slice(0, 5),
        }));
        addEvent({
          event: `${source}_command_sent`,
          device_id: deviceId,
          command_type: commandType,
          response: data,
        });
        toast(`${commandType} sent`);
        await refreshAll(token, { force: true });
      } catch (error) {
        toast(error.message);
      }
    },
    [token, addEvent, toast, refreshAll],
  );

  const runScene = useCallback(
    async (sceneId, source = "manual") => {
      try {
        const data = await api(`/scenes/${sceneId}/run`, {
          method: "POST",
          headers: authHeaders(token),
        });
        addEvent({ event: `${source}_scene_run`, scene_id: sceneId, response: data });
        toast("Scene started");
        await refreshAll(token, { force: true });
      } catch (error) {
        toast(error.message);
      }
    },
    [token, addEvent, toast, refreshAll],
  );

  const addLiveTelemetry = useCallback(
    (data) => {
      const matchesDevice =
        !telemetryDeviceId || data.device_id === Number(telemetryDeviceId);

      if (matchesDevice && tempChartRef.current && humidityChartRef.current) {
        const time = new Date().toLocaleTimeString();
        tempChartRef.current.data.labels.push(time);
        tempChartRef.current.data.datasets[0].data.push(Number(data.temperature));
        humidityChartRef.current.data.labels.push(time);
        humidityChartRef.current.data.datasets[0].data.push(Number(data.humidity));

        [tempChartRef, humidityChartRef].forEach((ref) => {
          if (ref.current.data.labels.length > 30) {
            ref.current.data.labels.shift();
            ref.current.data.datasets[0].data.shift();
          }
          ref.current.update();
        });
      }

      if (data.motion_detected) {
        setMotionEvents((prev) =>
          [
            { created_at: new Date().toISOString(), device_id: data.device_id, motion_detected: true },
            ...prev,
          ].slice(0, 50),
        );
      }
    },
    [telemetryDeviceId],
  );

  const connectWebSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    closeSocket();

    wsShouldReconnectRef.current = true;
    setSocketStatus("connecting");
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      setSocketStatus("online");
    };

    socket.onmessage = (message) => {
      let data;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      if (data.event === "websocket_connected") return;
      addEvent(data);
      if (data.event === "telemetry") {
        addLiveTelemetry(data);
        scheduleEnergyRefresh("today");
        return;
      }
      if (data.event !== "heartbeat") {
        refreshAll(undefined, { force: true });
      }
    };

    socket.onerror = () => {
      setSocketStatus("offline");
    };

    socket.onclose = () => {
      setSocketStatus("offline");
      socketRef.current = null;
      if (!wsShouldReconnectRef.current || !token) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        if (wsShouldReconnectRef.current && token) {
          connectWebSocket();
        }
      }, 4000);
    };
  }, [addEvent, addLiveTelemetry, scheduleEnergyRefresh, refreshAll, token, closeSocket]);

  const handleVoiceCommand = useCallback(
    async (spokenText) => {
      if (!token) {
        switchView("access");
        toast("Login first");
        return;
      }

      const normalized = normalizeText(spokenText);
      setVoiceTranscript(spokenText);
      addEvent({ event: "voice_heard", text: spokenText });

      if (
        normalized.includes("scene") ||
        normalized.includes("mode") ||
        normalized.includes("activate") ||
        normalized.includes("start")
      ) {
        const scene = findBestScene(scenes, spokenText);
        if (scene) {
          setVoiceResult(`Running scene: ${scene.name}`);
          await runScene(scene.scene_id, "voice");
          return;
        }
      }

      const commandType = commandTypeFromSpeech(spokenText);
      const device = findBestDevice(devices, spokenText);

      if (!commandType || !device) {
        setVoiceResult(
          "Command not matched. Try: turn on AC, turn off bedroom light, start night mode.",
        );
        addEvent({ event: "voice_not_matched", text: spokenText });
        return;
      }

      setVoiceResult(`${commandType} sent to ${device.device_name}`);
      await sendCommand(device.device_id, commandType, "voice");
    },
    [token, scenes, devices, switchView, toast, addEvent, runScene, sendCommand],
  );

  const initVoiceRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus("unsupported");
      setVoiceResult(
        "Speech recognition is not supported in this browser. Use Chrome or Edge.",
      );
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language?.startsWith("en") ? navigator.language : "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      setListening(true);
      setVoiceStatus("listening");
      setVoiceTranscript("Listening now...");
      setVoiceResult("Speak a command clearly.");
    };

    recognition.onspeechstart = () => {
      setVoiceResult("Speech detected. Converting to text...");
    };

    recognition.onspeechend = () => {
      setVoiceResult("Processing command...");
    };

    recognition.onresult = (event) => {
      const results = Array.from(event.results);
      const transcript = results
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();

      if (transcript) {
        setVoiceTranscript(transcript);
      }

      const finalResult = results.find((result) => result.isFinal);
      if (finalResult?.[0]?.transcript) {
        handleVoiceCommand(finalResult[0].transcript);
      }
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone permission is blocked. Allow mic access in the browser and try again.",
        "no-speech": "No speech was detected. Try again closer to the mic, or type the command below.",
        "audio-capture": "No microphone was found. Check your input device.",
        network: "Speech recognition service is unavailable. Type the command below.",
      };
      const message = messages[event.error] || `Voice error: ${event.error}`;
      toast(message);
      setVoiceStatus("ready");
      setListening(false);
      setVoiceResult(message);
    };

    recognition.onend = () => {
      setListening(false);
      setVoiceStatus((status) => (status === "unsupported" ? status : "ready"));
    };

    recognitionRef.current = recognition;
    setVoiceStatus("ready");
  }, [handleVoiceCommand, toast]);

  const startVoice = useCallback(async () => {
    if (!recognitionRef.current) initVoiceRecognition();
    if (!recognitionRef.current || listening) return;
    switchView("overview");

    if (!window.isSecureContext) {
      setVoiceStatus("unsupported");
      setVoiceResult("Microphone needs localhost or HTTPS. Open the app at http://localhost:5173.");
      return;
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
      setVoiceTranscript("Listening now...");
      recognitionRef.current.start();
    } catch (error) {
      setListening(false);
      setVoiceStatus("ready");
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      setVoiceResult(
        denied
          ? "Microphone permission is blocked. Allow it in the browser and try again."
          : "Voice is already active or unavailable. Stop it and try again.",
      );
    }
  }, [initVoiceRecognition, listening, switchView]);

  const stopVoice = useCallback(() => {
    if (recognitionRef.current && listening) recognitionRef.current.stop();
  }, [listening]);

  const logout = useCallback(() => {
    closeSocket();
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (energyRefreshTimerRef.current) {
      window.clearTimeout(energyRefreshTimerRef.current);
      energyRefreshTimerRef.current = null;
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setCurrentUser(null);
    setDevices([]);
    setDashboard({});
    setEnergySummary(null);
    setMotionEvents([]);
    setCommandsByDevice({});
    setSocketStatus("offline");
    switchView("access");
  }, [switchView, closeSocket]);

  const login = useCallback(
    async (username, password, phone = "") => {
      const data = await api("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, phone }),
      });
      const accessToken = data.access_token;
      localStorage.setItem(TOKEN_KEY, accessToken);
      setToken(accessToken);
      setCurrentUser({
        username: data.user?.username || username,
        email: data.user?.email || (username.includes("@") ? username : ""),
        phone: data.user?.phone || "",
        organizationId: data.user?.organization_id,
        createdAt: data.user?.created_at,
      });
      setBackendStatus("online");
      connectWebSocket();
      setCurrentView("overview");
      await refreshAll(accessToken);
      toast("Signed in");
      return accessToken;
    },
    [connectWebSocket, switchView, toast, refreshAll],
  );

  const register = useCallback(
    async (username, email, phone, password) => {
      await api("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, phone, password }),
      });
      setAuthTab("login");
      setCurrentView("access");
      toast("Account created. Log in with your new credentials.");
      return username;
    },
    [toast],
  );

  const requestPasswordReset = useCallback(async (email) => {
    return api("/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  }, []);

  const verifyPasswordOtp = useCallback(async (email, otp) => {
    return api("/password/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp }),
    });
  }, []);

  const resetPassword = useCallback(async (email, resetToken, newPassword, confirmPassword) => {
    return api("/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        reset_token: resetToken,
        new_password: newPassword,
        confirm_password: confirmPassword,
      }),
    });
  }, []);

  const registerDevice = useCallback(
    async (payload) => {
      const data = await api("/devices/register", {
        method: "POST",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      setProvisioningLog((prev) => [
        { id: Date.now(), label: "Device credentials", data },
        ...prev,
      ]);
      await refreshAll(token, { force: true });
      toast("Device registered");
    },
    [token, refreshAll, toast],
  );

  const registerEspModule = useCallback(
    async (payload) => {
      const data = await api("/esp/register", {
        method: "POST",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      setProvisioningLog((prev) => [
        { id: Date.now(), label: "ESP module credentials", data },
        ...prev,
      ]);
      await refreshAll(token, { force: true });
      toast("ESP module registered");
      return data;
    },
    [token, refreshAll, toast],
  );

  const updateDevice = useCallback(
    async (deviceId, payload) => {
      await api(`/devices/${deviceId}`, {
        method: "PATCH",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      await refreshAll(token, { force: true });
      toast("Device updated");
    },
    [token, refreshAll, toast],
  );

  const deleteDevice = useCallback(
    async (deviceId) => {
      await api(`/devices/${deviceId}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      await refreshAll(token, { force: true });
      toast("Device deleted");
    },
    [token, refreshAll, toast],
  );

  const createScene = useCallback(
    async (payload) => {
      await api("/scenes", {
        method: "POST",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      await refreshAll();
      toast("Scene created");
    },
    [token, refreshAll, toast],
  );

  const updateScene = useCallback(
    async (sceneId, payload) => {
      await api(`/scenes/${sceneId}`, {
        method: "PATCH",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      await refreshAll();
      toast("Scene updated");
    },
    [token, refreshAll, toast],
  );

  const deleteScene = useCallback(
    async (sceneId) => {
      await api(`/scenes/${sceneId}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      await refreshAll();
      toast("Scene deleted");
    },
    [token, refreshAll, toast],
  );

  const createRule = useCallback(
    async (payload) => {
      await api("/rules", {
        method: "POST",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      await refreshAll();
      toast("Rule created");
    },
    [token, refreshAll, toast],
  );

  const updateRule = useCallback(
    async (ruleId, payload) => {
      await api(`/rules/${ruleId}`, {
        method: "PATCH",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      await refreshAll();
      toast("Rule updated");
    },
    [token, refreshAll, toast],
  );

  const deleteRule = useCallback(
    async (ruleId) => {
      await api(`/rules/${ruleId}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      await refreshAll();
      toast("Rule deleted");
    },
    [token, refreshAll, toast],
  );

  const addKnownPerson = useCallback((person) => {
    setKnownPeople((prev) => {
      const next = [person, ...prev];
      localStorage.setItem(KNOWN_PEOPLE_KEY, JSON.stringify(next));
      return next;
    });
    toast("Person added to security records");
  }, [toast]);

  const removeKnownPerson = useCallback((id) => {
    setKnownPeople((prev) => {
      const next = prev.filter((p) => p.id !== id);
      localStorage.setItem(KNOWN_PEOPLE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const runVoiceCommand = useCallback(
    async (commandText) => {
      const text = commandText.trim();
      if (!text) return;
      switchView("overview");
      await handleVoiceCommand(text);
    },
    [handleVoiceCommand, switchView],
  );

  const clearEvents = useCallback(async () => {
    if (token) {
      try {
        await api("/events", { method: "DELETE", headers: authHeaders(token) });
      } catch (error) {
        toast(error.message);
      }
    }
    localStorage.removeItem(EVENTS_KEY);
    setEvents([]);
  }, [token, toast]);

  const initTelemetryCharts = useCallback(() => {
    if (!tempCanvasRef.current || !humidityCanvasRef.current) return false;
    if (tempChartRef.current && humidityChartRef.current) return true;

    const isDark = document.body.classList.contains("smart-home-dark-mode");
    const tickColor = isDark ? "#a8b4c8" : "#475569";
    const gridColor = isDark ? "#2d3b55" : "#e5e7eb";
    const legendColor = isDark ? "#f8fafc" : "#1f2937";

    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: legendColor } } },
      scales: {
        x: { ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor }, grid: { color: gridColor } },
      },
    };

    tempChartRef.current = new Chart(tempCanvasRef.current, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Temperature",
            data: [],
            borderColor: "#fb7185",
            backgroundColor: "rgba(251,113,133,0.12)",
            tension: 0.32,
            fill: true,
          },
        ],
      },
      options: baseOptions,
    });

    humidityChartRef.current = new Chart(humidityCanvasRef.current, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Humidity",
            data: [],
            borderColor: "#22d3ee",
            backgroundColor: "rgba(34,211,238,0.12)",
            tension: 0.32,
            fill: true,
          },
        ],
      },
      options: baseOptions,
    });

    return true;
  }, []);

  const metrics = useMemo(() => {
    const rooms = new Set(devices.map((d) => d.room || "Unassigned"));
    const online = devices.filter((d) => d.is_online).length;
    const offline = Math.max(devices.length - online, 0);
    const homeStatusText = !devices.length
      ? "No Devices Registered"
      : offline === 0 ? "All Devices Online" : `${offline} Device${offline === 1 ? "" : "s"} Offline`;
    const safeStatusTitle = !devices.length
      ? "Setup Needed"
      : offline === 0 ? "All Systems Normal" : "Attention Needed";
    const safeStatusText =
      !devices.length
        ? "Register devices to start monitoring."
        : offline === 0
        ? "Your home is safe and smart."
        : "Some devices are offline or not responding.";
    const energyLoad = devices.length
      ? `${online} active across ${rooms.size} room${rooms.size === 1 ? "" : "s"}`
      : "No active devices yet";
    return {
      total: devices.length,
      online,
      offline,
      alerts,
      homeStatusText,
      safeStatusTitle,
      safeStatusText,
      energyLoad,
    };
  }, [devices, alerts]);

  const roomEntries = useMemo(() => buildRoomEntries(dashboard), [dashboard]);
  const selectedRoom = roomEntries[0]?.name ?? "Rooms";
  const selectedRoomCount = roomEntries[0]?.count ?? 0;

  useEffect(() => {
    initVoiceRecognition();
    checkBackend();
  }, [initVoiceRecognition, checkBackend]);

  useEffect(() => {
    const prune = () => {
      setEvents((prev) => {
        const next = pruneEvents(prev);
        if (next.length !== prev.length) {
          localStorage.setItem(EVENTS_KEY, JSON.stringify(next));
        }
        return next;
      });
    };

    prune();
    const intervalId = window.setInterval(prune, 60 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (token) {
      checkBackend().then((online) => {
        if (cancelled || !online) return;
        connectWebSocket();
        refreshAll(token, { force: true });
      });
    } else {
      switchView("access");
    }

    return () => {
      cancelled = true;
      closeSocket();
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (energyRefreshTimerRef.current) window.clearTimeout(energyRefreshTimerRef.current);
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token || backendStatus !== "online") return undefined;
    const intervalId = window.setInterval(() => {
      refreshAll(token);
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [token, backendStatus, refreshAll]);

  const value = {
    token,
    currentUser,
    currentView,
    switchView,
    goToLogin,
    goToRegister,
    devices,
    espModules,
    dashboard,
    scenes,
    rules,
    events,
    commandsByDevice,
    knownPeople,
    provisioningLog,
    toasts,
    backendStatus,
    socketStatus,
    voiceStatus,
    voiceTranscript,
    voiceResult,
    listening,
    telemetryDeviceId,
    setTelemetryDeviceId,
    energySummary,
    loadEnergySummary,
    motionEvents,
    authTab,
    setAuthTab,
    metrics,
    roomEntries,
    selectedRoom,
    selectedRoomCount,
    toast,
    refreshAll,
    loadEvents,
    loadEspModules,
    loadTelemetryHistory,
    sendCommand,
    runScene,
    runVoiceCommand,
    startVoice,
    stopVoice,
    logout,
    login,
    register,
    requestPasswordReset,
    verifyPasswordOtp,
    resetPassword,
    registerEspModule,
    registerDevice,
    updateDevice,
    deleteDevice,
    createScene,
    updateScene,
    deleteScene,
    createRule,
    updateRule,
    deleteRule,
    addKnownPerson,
    removeKnownPerson,
    clearEvents,
    initTelemetryCharts,
    tempCanvasRef,
    humidityCanvasRef,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
