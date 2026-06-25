const useDevProxy = import.meta.env.DEV;
const backendPort = import.meta.env.VITE_BACKEND_PORT || "8001";

export const API_BASE = useDevProxy ? "/api" : "";
export const BACKEND_PORT = backendPort;

export const WS_URL = useDevProxy
  ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${backendPort}/ws`;
