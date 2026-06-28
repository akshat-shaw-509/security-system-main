export function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatTime(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function roomImage(room) {
  const value = normalizeText(room);
  if (value.includes("bed")) return "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=700&q=80";
  if (value.includes("kitchen")) return "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=700&q=80";
  if (value.includes("bath")) return "https://images.unsplash.com/photo-1620626011761-996317b8d101?auto=format&fit=crop&w=700&q=80";
  if (value.includes("balcony")) return "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=700&q=80";
  if (value.includes("dining")) return "https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=700&q=80";
  if (value.includes("study")) return "https://images.unsplash.com/photo-1593476550610-87baa860004a?auto=format&fit=crop&w=700&q=80";
  if (value.includes("entrance") || value.includes("entry")) return "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=700&q=80";
  return "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=700&q=80";
}

export function roomIcon(room) {
  const value = normalizeText(room);
  if (value.includes("bed")) return "BedDouble";
  if (value.includes("kitchen")) return "CookingPot";
  if (value.includes("bath")) return "Bath";
  if (value.includes("entrance") || value.includes("entry")) return "DoorOpen";
  if (value.includes("study") || value.includes("office")) return "Monitor";
  if (value.includes("dining")) return "Utensils";
  if (value.includes("balcony")) return "Landmark";
  return "Sofa";
}

export function deviceImage(device) {
  const value = normalizeText(`${device.device_name} ${device.device_type}`);
  if (value.includes("ac") || value.includes("air")) return "https://img.icons8.com/clouds/160/air-conditioner.png";
  if (value.includes("fan")) return "https://img.icons8.com/clouds/160/fan.png";
  if (value.includes("tv")) return "https://img.icons8.com/clouds/160/tv.png";
  if (value.includes("curtain")) return "https://img.icons8.com/clouds/160/curtains.png";
  if (value.includes("speaker")) return "https://img.icons8.com/clouds/160/speaker.png";
  if (value.includes("socket") || value.includes("plug")) return "https://img.icons8.com/clouds/160/electrical.png";
  if (value.includes("lock")) return "https://img.icons8.com/clouds/160/lock.png";
  if (value.includes("camera")) return "https://img.icons8.com/clouds/160/camera.png";
  if (value.includes("sensor") || value.includes("motion")) return "https://img.icons8.com/clouds/160/sensor.png";
  return "https://img.icons8.com/clouds/160/light.png";
}

export function deviceIcon(device) {
  const value = normalizeText(`${device.device_name} ${device.device_type}`);
  if (value.includes("ac") || value.includes("air")) return "Snowflake";
  if (value.includes("fan")) return "Fan";
  if (value.includes("tv")) return "Monitor";
  if (value.includes("curtain")) return "Blinds";
  if (value.includes("speaker")) return "Volume2";
  if (value.includes("socket") || value.includes("plug")) return "Plug";
  if (value.includes("lock")) return "Lock";
  if (value.includes("camera")) return "Cctv";
  if (value.includes("sensor") || value.includes("motion")) return "Radar";
  return "Lightbulb";
}

export function findBestDevice(devices, commandText) {
  const normalizedCommand = normalizeText(commandText);
  const words = normalizedCommand.split(" ");

  let best = null;
  let bestScore = 0;

  devices.forEach((device) => {
    const fields = [
      device.device_name,
      device.device_type,
      device.room,
      `${device.room || ""} ${device.device_name}`,
      `${device.room || ""} ${device.device_type}`,
    ].map((value) => normalizeText(value || ""));

    let score = 0;
    fields.forEach((field) => {
      if (!field) return;
      if (normalizedCommand.includes(field)) score += field.split(" ").length + 4;
      field.split(" ").forEach((part) => {
        if (part && words.includes(part)) score += 1;
      });
    });

    if (score > bestScore) {
      best = device;
      bestScore = score;
    }
  });

  return bestScore > 0 ? best : null;
}

export function findBestScene(scenes, commandText) {
  const normalizedCommand = normalizeText(commandText);
  return scenes.find((scene) => normalizedCommand.includes(normalizeText(scene.name)));
}

export function commandTypeFromSpeech(commandText) {
  const normalized = normalizeText(commandText);
  if (
    normalized.includes("turn on") ||
    normalized.includes("switch on") ||
    normalized.includes("start") ||
    normalized.includes("open")
  ) {
    return "TURN_ON";
  }
  if (
    normalized.includes("turn off") ||
    normalized.includes("switch off") ||
    normalized.includes("stop") ||
    normalized.includes("close")
  ) {
    return "TURN_OFF";
  }
  return null;
}

export function readImageAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

export const VIEW_TITLES = {
  overview: ["Dashboard", "All systems are running smoothly."],
  rooms: ["Rooms", "Control every room from one place."],
  devices: ["Devices", "Register, monitor, and control connected hardware."],
  energy: ["Energy", "Track usage and reduce wasted power."],
  security: ["Security", "Monitor safety, motion, and home protection."],
  schedules: ["Schedules", "Create scenes for repeatable routines."],
  automation: ["Automation", "Create and manage smart automations."],
  provisioning: ["Provisioning", "Review device and ESP credentials."],
  settings: ["Settings", "Manage your smart home preferences and system."],
  access: ["Account", "Manage your account and preferences."],
};

export const NAV_ITEMS = [
  { id: "overview", label: "Dashboard", icon: "House" },
  { id: "rooms", label: "Rooms", icon: "Sofa" },
  { id: "devices", label: "Devices", icon: "PanelTop" },
  { id: "energy", label: "Energy", icon: "Zap" },
  { id: "security", label: "Security", icon: "ShieldCheck" },
  { id: "schedules", label: "Schedules", icon: "CalendarDays" },
  { id: "automation", label: "Automation", icon: "Sun" },
  { id: "provisioning", label: "Provisioning", icon: "ReceiptText" },
  { id: "settings", label: "Settings", icon: "Settings" },
];

export const AUTH_NAV_ITEM = { id: "access", label: "Account", icon: "CircleUser" };

export const DEVICE_TYPES = [
  "light",
  "fan",
  "sensor",
  "ac",
  "tv",
  "curtains",
  "speaker",
  "socket",
  "plug",
  "lock",
  "camera",
];

export const PERSON_ROLES = ["Owner", "Family", "Guest", "Staff", "Blocked"];
