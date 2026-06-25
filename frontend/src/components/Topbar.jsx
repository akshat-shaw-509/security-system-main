import { useApp } from "../context/AppContext.jsx";
import { VIEW_TITLES } from "../utils/helpers.js";
import LucideIcon from "./LucideIcon.jsx";

export default function Topbar() {
  const {
    token,
    currentUser,
    currentView,
    metrics,
    listening,
    refreshAll,
    startVoice,
    switchView,
    logout,
    goToLogin,
    goToRegister,
  } = useApp();

  const [title, subtitle] = VIEW_TITLES[currentView] || VIEW_TITLES.overview;
  const displayName = currentUser?.username || "Account";
  const displayEmail = currentUser?.email || "Signed in";
  const pageTitle =
    currentView === "overview" && token ? `Welcome back, ${displayName}` : title;
  const pageSubtitle =
    currentView === "overview" && token
      ? "Here's what's happening in your smart home today."
      : subtitle;
  const initials = displayName
    .split(/\s|_/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";
  const openNotifications = () => {
    localStorage.setItem("smart_home_settings_active_tab", "notifications");
    window.dispatchEvent(new CustomEvent("smart-home-settings-tab", { detail: { tab: "notifications" } }));
    switchView("settings");
  };

  return (
    <header className="topbar">
      <div className="page-title">
        <h2>{pageTitle}</h2>
        <p>{pageSubtitle}</p>
      </div>
      <div className="toolbar">
        <div className="top-status">{metrics.homeStatusText}</div>
        {!token ? (
          <>
            <button className="btn secondary" type="button" onClick={goToLogin}>
              <LucideIcon name="LogIn" />
              <span>Login</span>
            </button>
            <button className="btn" type="button" onClick={goToRegister}>
              <LucideIcon name="UserPlus" />
              <span>Register</span>
            </button>
          </>
        ) : (
          <>
            <button className={`round-btn${listening ? " active" : ""}`} type="button" title="Voice command" onClick={startVoice}>
              <LucideIcon name="Mic" />
            </button>
            <button className="notification-btn" type="button" title="Notifications" onClick={openNotifications}>
              <LucideIcon name="Bell" />
            </button>
            <button className="account-chip" type="button" title={displayEmail} onClick={goToLogin}>
              <div className="avatar" aria-hidden="true">{initials}</div>
              <div className="account-copy">
                <strong>{displayName}</strong>
                <span>{displayEmail}</span>
              </div>
              <LucideIcon name="ChevronDown" size={16} />
            </button>
            <button
              className="btn secondary hidden"
              id="refreshBtn"
              type="button"
              title="Refresh"
              onClick={refreshAll}
            >
              <LucideIcon name="RefreshCw" />
              <span>Refresh</span>
            </button>
            <button className="round-btn signout-btn" id="logoutBtn" type="button" title="Sign out" onClick={logout}>
              <LucideIcon name="LogOut" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
