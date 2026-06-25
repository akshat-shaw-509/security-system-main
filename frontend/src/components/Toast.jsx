import { useApp } from "../context/AppContext.jsx";

export default function Toast() {
  const { toasts } = useApp();
  return (
    <div className="toast">
      {toasts.map((t) => (
        <div key={t.id}>{t.message}</div>
      ))}
    </div>
  );
}
