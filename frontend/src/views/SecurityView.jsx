import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "../components/LucideIcon.jsx";
import { deviceIcon, normalizeText } from "../utils/helpers.js";

function isSecurityDevice(device) {
  const value = normalizeText(`${device.device_name} ${device.device_type}`);
  return (
    value.includes("sensor") ||
    value.includes("motion") ||
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
  if (state === "ACTIVE") return "ACTIVE";
  if (value.includes("smoke")) return "NORMAL";
  return device.is_online ? "ACTIVE" : "CLOSED";
}

function formatDateTime(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTime(value) {
  if (!value) return "Now";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function SecurityView() {
  const {
    devices,
    cameras,
    cameraSnapshots,
    cameraRecordings,
    metrics,
    motionEvents,
    cameraStreamUrl,
    cameraSnapshotUrl,
    cameraRecordingUrl,
    registerCamera,
    updateCamera,
    uploadCameraSnapshot,
    uploadCameraRecording,
    reconnectCamera,
    toast,
  } = useApp();

  const [securityMode, setSecurityMode] = useState("home");
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [cameraMuted, setCameraMuted] = useState(true);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [sensorFilter, setSensorFilter] = useState("all");
  const [sensorSearch, setSensorSearch] = useState("");
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState(() => new Set());
  const [webcamStream, setWebcamStream] = useState(null);
  const [webcamCameraId, setWebcamCameraId] = useState(null);
  const [webcamError, setWebcamError] = useState("");
  const [isWebcamRecording, setIsWebcamRecording] = useState(false);
  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingStartedAtRef = useRef(null);
  const lastMotionCaptureRef = useRef(null);

  useEffect(() => {
    if (!cameras.length) {
      setSelectedCameraId(null);
      return;
    }
    if (!selectedCameraId || !cameras.some((camera) => camera.camera_id === selectedCameraId)) {
      const activeCamera = cameras.find((camera) => camera.status === "online") || cameras[0];
      setSelectedCameraId(activeCamera.camera_id);
    }
  }, [cameras, selectedCameraId]);

  useEffect(() => {
    if (videoRef.current && webcamStream) {
      videoRef.current.srcObject = webcamStream;
    }
  }, [webcamStream, selectedCameraId]);

  useEffect(() => {
    return () => {
      if (webcamStream) {
        webcamStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [webcamStream]);

  const selectedCamera =
    cameras.find((camera) => camera.camera_id === selectedCameraId) || cameras[0] || null;
  const selectedIsWebcam = selectedCamera?.camera_type === "webcam";
  const showWebcamLive = Boolean(
    webcamStream && selectedCamera && (selectedIsWebcam || selectedCamera.camera_id === webcamCameraId),
  );
  const hasWebcamCamera = cameras.some((camera) => camera.camera_type === "webcam");

  const securityDevices = useMemo(() => {
    const matched = devices.filter(isSecurityDevice);
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

  const systemTotal = metrics.total + metrics.cameraTotal;
  const onlineTotal = metrics.online + metrics.onlineCameras;
  const systemHealth = systemTotal ? Math.round((onlineTotal / systemTotal) * 100) : 100;
  const visibleSensors = securityDevices;
  const cameraStatusText = cameras.length
    ? `${metrics.onlineCameras} online / ${metrics.offlineCameras} offline`
    : "No cameras provisioned";

  const alerts = motionEvents.slice(0, 20).map((item, index) => ({
    icon: "Radar",
    tone: item.camera_id ? "red" : "purple",
    title: item.camera_id ? "Motion Detected" : "Motion detected",
    place: item.camera_name || item.device_name || item.room || `Device #${item.device_id}`,
    detail: item.room || item.motion_location || "Motion sensor",
    time: formatTime(item.created_at || item.motion_timestamp),
    id: `${item.camera_id || item.device_id || "motion"}-${item.created_at || index}`,
  }));

  const openAlerts = alerts.filter((alert) => !acknowledgedAlerts.has(alert.id));
  const visibleAlerts = showAllAlerts ? alerts : openAlerts.slice(0, 4);
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
    setAcknowledgedAlerts((prev) => {
      const next = new Set(prev);
      next.add(alert.id);
      return next;
    });
  };

  const startBrowserWebcam = useCallback(async (camera = selectedCamera) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setWebcamError("Browser webcam access is not supported in this browser.");
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (webcamStream) {
        webcamStream.getTracks().forEach((track) => track.stop());
      }

      let cameraId = camera?.camera_type === "webcam" ? camera.camera_id : null;
      if (!cameraId) {
        const created = await registerCamera({
          camera_name: "Browser Webcam",
          room: "Local Browser",
          camera_type: "webcam",
        });
        cameraId = created.camera_id;
      }

      setWebcamStream(stream);
      setWebcamCameraId(cameraId);
      setSelectedCameraId(cameraId);
      setWebcamError("");
      await updateCamera(cameraId, {
        status: "online",
        status_reason: "Active in this browser",
      });
      return { stream, cameraId };
    } catch (error) {
      setWebcamError(error.message || "Unable to access browser webcam.");
      toast(error.message || "Unable to access browser webcam.", "error");
      return null;
    }
  }, [selectedCamera, webcamStream, registerCamera, updateCamera, toast]);

  const stopBrowserWebcam = useCallback(async () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    if (webcamStream) {
      webcamStream.getTracks().forEach((track) => track.stop());
    }
    setWebcamStream(null);
    setIsWebcamRecording(false);
    if (webcamCameraId) {
      await updateCamera(webcamCameraId, {
        status: "offline",
        status_reason: "Stopped in browser",
      });
    }
  }, [webcamStream, webcamCameraId, updateCamera]);

  const captureWebcamSnapshot = useCallback(async (reason = "manual", motionDeviceId = null) => {
    const cameraId = webcamCameraId || selectedCamera?.camera_id;
    const video = videoRef.current;
    if (!cameraId || !video || !webcamStream) {
      toast("Start the browser webcam before taking a snapshot.", "error");
      return null;
    }
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);
    const image = canvas.toDataURL("image/jpeg", 0.86);
    const snapshot = await uploadCameraSnapshot(cameraId, image, {
      reason,
      motion_device_id: motionDeviceId,
    });
    if (reason === "manual") toast("Webcam snapshot saved", "success");
    return snapshot;
  }, [selectedCamera, webcamCameraId, webcamStream, uploadCameraSnapshot, toast]);

  const toggleWebcamRecording = useCallback(async (triggerReason = "manual", motionDeviceId = null) => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      return;
    }

    let stream = webcamStream;
    let cameraId = webcamCameraId || selectedCamera?.camera_id;
    if (!stream || !cameraId) {
      const started = await startBrowserWebcam(selectedCamera);
      if (!started) return;
      stream = started.stream;
      cameraId = started.cameraId;
    }

    if (!window.MediaRecorder) {
      toast("This browser cannot record webcam clips.", "error");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordingChunksRef.current = [];
    recordingStartedAtRef.current = Date.now();
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data?.size) recordingChunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - (recordingStartedAtRef.current || Date.now())) / 1000),
      );
      setIsWebcamRecording(false);
      const blob = new Blob(recordingChunksRef.current, { type: mimeType || "video/webm" });
      recordingChunksRef.current = [];
      if (!blob.size) return;
      try {
        const videoBase64 = await blobToDataUrl(blob);
        await uploadCameraRecording(cameraId, videoBase64, {
          mime_type: blob.type || "video/webm",
          duration_seconds: durationSeconds,
          motion_device_id: motionDeviceId,
          trigger_reason: triggerReason,
        });
        if (triggerReason === "manual") toast("Webcam recording saved", "success");
      } catch (error) {
        toast(error.message || "Unable to save webcam recording.", "error");
      }
    };

    recorder.start();
    setIsWebcamRecording(true);
    if (triggerReason === "manual") {
      window.setTimeout(() => {
        if (recorderRef.current === recorder && recorder.state === "recording") {
          recorder.stop();
        }
      }, 30000);
    }
  }, [selectedCamera, webcamCameraId, webcamStream, startBrowserWebcam, uploadCameraRecording, toast]);

  useEffect(() => {
    const latest = motionEvents[0];
    if (!latest?.created_at || !webcamStream) return;
    const motionKey = `${latest.camera_id || "motion"}-${latest.created_at}`;
    if (lastMotionCaptureRef.current === motionKey) return;
    const targetCamera = cameras.find((camera) => camera.camera_id === latest.camera_id);
    if (targetCamera?.camera_type !== "webcam" && selectedCamera?.camera_type !== "webcam") return;
    lastMotionCaptureRef.current = motionKey;
    captureWebcamSnapshot("motion", latest.device_id);
    if (!isWebcamRecording) {
      toggleWebcamRecording("motion", latest.device_id);
    }
  }, [
    motionEvents,
    cameras,
    selectedCamera,
    webcamStream,
    isWebcamRecording,
    captureWebcamSnapshot,
    toggleWebcamRecording,
  ]);

  const openSnapshot = () => {
    if (selectedIsWebcam) {
      captureWebcamSnapshot();
      return;
    }
    const url = cameraSnapshotUrl(selectedCamera);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const openRecording = (recording) => {
    const url = cameraRecordingUrl(recording);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="view active security-reference-page">
      <div className="security-console-strip">
        <div>
          <span className="security-live-dot" />
          <strong>{metrics.offlineCameras ? `${metrics.offlineCameras} camera${metrics.offlineCameras === 1 ? "" : "s"} offline` : "Surveillance online"}</strong>
          <small>{cameraStatusText}</small>
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
                <strong>{openAlerts.length ? "Motion activity detected" : "Your home is secure"}</strong>
                <span>{modeCopy[securityMode]}</span>
              </div>
            </div>
            <div className="security-status-metrics">
              <div>
                <strong>{metrics.onlineCameras}</strong>
                <span>Online Cameras</span>
              </div>
              <div>
                <strong>{metrics.offlineCameras}</strong>
                <span>Offline Cameras</span>
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
                <article className={acknowledgedAlerts.has(alert.id) ? "acknowledged" : ""} key={alert.id}>
                  <div className={`security-row-icon ${alert.tone}`}>
                    <LucideIcon name={alert.icon} />
                  </div>
                  <div>
                    <strong>{alert.title}</strong>
                    <span>{alert.place}</span>
                    <small>{alert.detail}</small>
                  </div>
                  <div className="security-alert-actions">
                    <time>{alert.time}</time>
                    {!acknowledgedAlerts.has(alert.id) ? (
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
                  <span>Motion alerts appear when hardware sends motion telemetry.</span>
                </div>
              )}
            </div>
          </section>

          <section className="security-card security-media-card">
            <div className="security-card-head">
              <div>
                <h3>Motion Snapshots</h3>
                <span>{cameraSnapshots.length} recent capture{cameraSnapshots.length === 1 ? "" : "s"}</span>
              </div>
            </div>
            <div className="security-snapshot-grid">
              {cameraSnapshots.length ? cameraSnapshots.map((snapshot) => (
                <article key={snapshot.snapshot_id}>
                  <img alt="" src={cameraSnapshotUrl(snapshot)} />
                  <strong>{snapshot.camera_name || "Camera"}</strong>
                  <span>{formatDateTime(snapshot.captured_at)}</span>
                </article>
              )) : (
                <div className="security-clear-state">
                  <LucideIcon name="Camera" />
                  <strong>No snapshots yet</strong>
                  <span>Motion-triggered snapshots will appear here.</span>
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
                <span>{selectedCamera?.camera_name || "No camera selected"}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!selectedCamera) {
                    startBrowserWebcam();
                    return;
                  }
                  if (selectedIsWebcam) {
                    if (webcamStream) stopBrowserWebcam();
                    else startBrowserWebcam(selectedCamera);
                    return;
                  }
                  reconnectCamera(selectedCamera.camera_id);
                }}
              >
                {!selectedCamera || (selectedIsWebcam && !webcamStream) ? "Start Webcam" : selectedIsWebcam ? "Stop Webcam" : "Reconnect"}
              </button>
            </div>
            <div className="security-camera-frame">
              {showWebcamLive ? (
                <>
                  <video ref={videoRef} autoPlay playsInline muted />
                  <span className="security-live-badge">LIVE</span>
                  {isWebcamRecording ? <span className="security-recording-badge">REC</span> : null}
                  <div className="security-camera-actions">
                    <button type="button" title="Snapshot" onClick={openSnapshot}><LucideIcon name="Camera" /></button>
                    <button
                      type="button"
                      title={isWebcamRecording ? "Stop recording" : "Record for 30 seconds"}
                      onClick={() => toggleWebcamRecording()}
                    >
                      <LucideIcon name={isWebcamRecording ? "Square" : "Play"} />
                    </button>
                    <button type="button" title="Stop webcam" onClick={stopBrowserWebcam}><LucideIcon name="PowerOff" /></button>
                  </div>
                </>
              ) : !selectedCamera ? (
                <div className="security-camera-offline">
                  <LucideIcon name="Camera" />
                  <strong>No Cameras Registered</strong>
                  <span>Use your computer webcam here, or provision an ESP32-CAM for hardware streaming.</span>
                  <button type="button" onClick={() => startBrowserWebcam()}>Use Browser Webcam</button>
                </div>
              ) : selectedIsWebcam ? (
                <div className="security-camera-offline">
                  <LucideIcon name="Camera" />
                  <strong>{selectedCamera.camera_name}</strong>
                  <span>{webcamError || "Allow camera access in your browser to start the live feed."}</span>
                  <button type="button" onClick={() => startBrowserWebcam(selectedCamera)}>Start Webcam</button>
                </div>
              ) : selectedCamera.status === "online" && selectedCamera.has_stream ? (
                <>
                  <img src={cameraStreamUrl(selectedCamera)} alt={`${selectedCamera.camera_name} live stream`} />
                  <span className="security-live-badge">LIVE</span>
                  <div className="security-camera-actions">
                    <button type="button" title="Snapshot" onClick={openSnapshot}><LucideIcon name="Camera" /></button>
                    <button type="button" title={cameraMuted ? "Unmute audio" : "Mute audio"} onClick={() => setCameraMuted((value) => !value)}>
                      <LucideIcon name={cameraMuted ? "MicOff" : "Mic"} />
                    </button>
                    <button type="button" title="Fullscreen"><LucideIcon name="Square" /></button>
                  </div>
                </>
              ) : (
                <div className="security-camera-offline">
                  <LucideIcon name="WifiOff" />
                  <strong>Camera Offline</strong>
                  <span>Last Seen: {formatDateTime(selectedCamera.last_seen)}</span>
                  <span>Reason: {selectedCamera.status_reason || selectedCamera.presence_label || "Stream unavailable"}</span>
                  <button type="button" onClick={() => reconnectCamera(selectedCamera.camera_id)}>Reconnect</button>
                </div>
              )}
            </div>
            <div className="security-camera-picker" aria-label="Camera feeds">
              {cameras.length ? cameras.map((camera) => (
                <button
                  className={camera.camera_id === selectedCamera?.camera_id ? "active" : ""}
                  type="button"
                  key={camera.camera_id}
                  onClick={() => setSelectedCameraId(camera.camera_id)}
                >
                  {camera.camera_name}
                  <small>{camera.camera_type === "webcam" && webcamStream && camera.camera_id === webcamCameraId ? "live" : camera.status}</small>
                </button>
              )) : (
                <span>No registered cameras</span>
              )}
              {!hasWebcamCamera ? (
                <button type="button" className="security-webcam-add" onClick={() => startBrowserWebcam()}>
                  + Browser Webcam
                </button>
              ) : null}
            </div>
          </section>

          <section className="security-card security-media-card">
            <div className="security-card-head">
              <div>
                <h3>Recording History</h3>
                <span>{cameraRecordings.length} recent recording{cameraRecordings.length === 1 ? "" : "s"}</span>
              </div>
            </div>
            <div className="security-recording-list">
              {cameraRecordings.length ? cameraRecordings.map((recording) => (
                <article key={recording.recording_id}>
                  <div className="security-row-icon red">
                    <LucideIcon name="Cctv" />
                  </div>
                  <div>
                    <strong>{recording.camera_name || "Camera"}</strong>
                    <span>{formatDateTime(recording.started_at)}</span>
                    <small>{recording.duration_seconds || 0}s - {recording.status}</small>
                  </div>
                  <button type="button" disabled={!recording.recording_path} onClick={() => openRecording(recording)}>
                    View
                  </button>
                </article>
              )) : (
                <div className="security-clear-state">
                  <LucideIcon name="Cctv" />
                  <strong>No recordings yet</strong>
                  <span>Motion-triggered recordings will appear here.</span>
                </div>
              )}
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
                  Register motion, door, lock, or smoke devices to populate live security sensors.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
