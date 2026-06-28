import { useApp } from "../context/AppContext.jsx";

const ICONS = {
  info:    "⏳",
  success: "✅",
  warning: "⚠️",
  error:   "❌",
};

export default function Toast() {
  const { toasts } = useApp();
  return (
    <div className="toast">
      {toasts.map((t) => {
        const type = t.type || "info";
        return (
          <div key={t.id} className={`toast-item toast-${type}`}>
            <span className="toast-icon" aria-hidden="true">{ICONS[type]}</span>
            <span className="toast-message">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}