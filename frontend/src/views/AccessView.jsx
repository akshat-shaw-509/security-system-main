import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "../components/LucideIcon.jsx";
import { readImageAsDataUrl } from "../utils/helpers.js";

const PROFILE_PHOTO_KEY = "smart_home_profile_photo";

function profilePhotoKey(username) {
  return `${PROFILE_PHOTO_KEY}_${username || "guest"}`;
}

function formatMemberSince(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export default function AccessView() {
  const {
    token,
    currentUser,
    metrics,
    devices,
    events,
    authTab,
    setAuthTab,
    switchView,
    login,
    register,
    requestPasswordReset,
    verifyPasswordOtp,
    resetPassword,
    logout,
    toast,
  } = useApp();
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetSessionToken, setResetSessionToken] = useState("");
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetStep, setResetStep] = useState("email");
  const [accountPanel, setAccountPanel] = useState("profile");
  const [profilePhoto, setProfilePhoto] = useState("");
  const fileInputRef = useRef(null);
  const displayName = currentUser?.username || "Krishna";
  const displayEmail = currentUser?.email || "krishna.home@gmail.com";
  const displayPhone = currentUser?.phone || "Not added";
  const memberSince = formatMemberSince(currentUser?.createdAt);
  const initials = displayName
    .split(/\s|_/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "K";
  const accountRows = [
    ["profile", "UserRound", "Personal Information", "Update your personal details"],
    ["devices", "Monitor", "Connected Devices", `${metrics.total} connected device${metrics.total === 1 ? "" : "s"}`],
    ["security", "ShieldCheck", "Account Security", "Password and recovery settings"],
    ["free", "ReceiptText", "Free Access", "No subscriptions or invoices"],
  ];
  const panelTitle = {
    profile: "Account Information",
    security: "Account Security",
    free: "Free Access",
  }[accountPanel] || "Account Information";
  const accountDetails = accountPanel === "security"
    ? [
        ["Login Email", displayEmail],
        ["Phone Alerts", displayPhone],
        ["Password", "Protected"],
        ["Recovery", "OTP password reset available"],
        ["Session", token ? "Signed in" : "Signed out"],
        ["Security Alerts", metrics.alerts ? `${metrics.alerts} active` : "No active alerts"],
      ]
    : accountPanel === "free"
    ? [
        ["Plan", "Free for everyone"],
        ["Devices", "Unlimited within your home server"],
        ["Billing", "No billing required"],
        ["Invoices", "None"],
        ["Access", "All dashboard features included"],
      ]
    : [
        ["Full Name", displayName],
        ["Email", displayEmail],
        ["Phone", displayPhone],
        ["Member Since", memberSince],
        ["Role", "Home Owner"],
        ["Connected Devices", `${devices.length} device${devices.length === 1 ? "" : "s"}`],
      ];

  useEffect(() => {
    setProfilePhoto(localStorage.getItem(profilePhotoKey(displayName)) || "");
  }, [displayName]);

  const handleProfilePhotoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readImageAsDataUrl(file);
    if (!dataUrl) {
      toast("Could not read that image");
      return;
    }
    localStorage.setItem(profilePhotoKey(displayName), dataUrl);
    setProfilePhoto(dataUrl);
    toast("Profile photo updated");
    event.target.value = "";
  };

  const handleAccountRow = (panel) => {
    if (panel === "devices") {
      switchView("devices");
      return;
    }
    setAccountPanel(panel);
  };

  const openPasswordReset = () => {
    setResetEmail(displayEmail);
    setResetStep("email");
    setAuthTab("forgot");
    toast("Password reset is available from the account sign-in screen.");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await login(loginUsername, loginPassword, loginPhone);
      setLoginPhone("");
    } catch (error) {
      toast(error.message);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const username = await register(registerUsername, registerEmail, registerPhone, registerPassword);
      setLoginUsername(username);
      setRegisterUsername("");
      setRegisterEmail("");
      setRegisterPhone("");
      setRegisterPassword("");
    } catch (error) {
      toast(error.message);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    try {
      const data = await requestPasswordReset(resetEmail);
      setResetStep("otp");
      toast(data.message);
    } catch (error) {
      toast(error.message);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    try {
      const data = await verifyPasswordOtp(resetEmail, resetOtp);
      setResetSessionToken(data.reset_token);
      setResetStep("password");
      toast("OTP verified. Set your new password.");
    } catch (error) {
      toast(error.message);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    try {
      await resetPassword(resetEmail, resetSessionToken, resetPasswordValue, resetConfirmPassword);
      setLoginUsername(resetEmail);
      setResetOtp("");
      setResetSessionToken("");
      setResetPasswordValue("");
      setResetConfirmPassword("");
      setResetStep("email");
      setAuthTab("login");
      toast("Password reset complete. Sign in with the new password.");
    } catch (error) {
      toast(error.message);
    }
  };

  if (token) {
    return (
      <section className="view active account-page">
        <div className="account-layout">
          <section className="account-profile-card">
            <h3>Profile</h3>
            <div className="account-profile-hero">
              <div className="account-avatar-large">
                <span>
                  {profilePhoto ? <img src={profilePhoto} alt="" /> : initials}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleProfilePhotoChange}
                />
                <button
                  type="button"
                  aria-label="Update profile photo"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <LucideIcon name="Camera" />
                </button>
              </div>
              <div className="account-profile-copy">
                <h4>{displayName}</h4>
                <strong>Free Home Owner</strong>
                <span>{displayEmail}</span>
                <span>Member since {memberSince}</span>
              </div>
            </div>

            <div className="account-menu-list">
              {accountRows.map(([panel, icon, label, text]) => (
                <button
                  type="button"
                  key={label}
                  className={`account-menu-row${accountPanel === panel ? " active" : ""}`}
                  onClick={() => handleAccountRow(panel)}
                >
                  <span className="account-menu-icon">
                    <LucideIcon name={icon} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{text}</small>
                  </span>
                  <LucideIcon name="ChevronDown" />
                </button>
              ))}
            </div>
          </section>

          <section className="account-info-card">
            <h3>{panelTitle}</h3>
            <div className="account-info-list">
              {accountDetails.map(([label, value]) => (
                <article className="account-info-row" key={label}>
                  <strong>{label}</strong>
                  <span>{value}</span>
                </article>
              ))}
            </div>
            {accountPanel === "security" ? (
              <div className="account-panel-copy">
                <p>Use password reset to send an OTP to your email and set a new password.</p>
                <button className="btn secondary" type="button" onClick={openPasswordReset}>
                  <LucideIcon name="ShieldCheck" />
                  <span>Reset Password</span>
                </button>
              </div>
            ) : null}
            {accountPanel === "free" ? (
              <div className="account-panel-copy">
                <p>This dashboard has no paid subscription, invoice, or billing flow. Every account can use the full website.</p>
              </div>
            ) : null}
            {accountPanel === "profile" ? (
              <div className="account-panel-copy">
                <p>{events.length} recent activity event{events.length === 1 ? "" : "s"} are saved for this account.</p>
              </div>
            ) : null}
            <div className="account-info-actions">
              <button className="account-signout-btn" type="button" onClick={logout}>
                <LucideIcon name="LogOut" />
                <span>Sign Out</span>
              </button>
            </div>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="view active">
      <div className="auth-layout">
        <section className="panel pad">
          <div className="section-head">
            <div>
              <h3>Welcome</h3>
              <span>Sign in or create an account to use the smart home dashboard.</span>
            </div>
          </div>

          <div className="tabs">
            <button
              type="button"
              className={authTab === "login" ? "active" : ""}
              onClick={() => setAuthTab("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={authTab === "register" ? "active" : ""}
              onClick={() => setAuthTab("register")}
            >
              Register
            </button>
            <button
              type="button"
              className={authTab === "forgot" ? "active" : ""}
              onClick={() => setAuthTab("forgot")}
            >
              Forgot
            </button>
          </div>

          <form
            className={`form-grid${authTab !== "login" ? " hidden" : ""}`}
            onSubmit={handleLogin}
          >
            <div className="field full">
              <label htmlFor="loginUsername">Username, Email, or Phone</label>
              <input
                id="loginUsername"
                autoComplete="username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                required
              />
            </div>
            <div className="field full">
              <label htmlFor="loginPassword">Password</label>
              <input
                id="loginPassword"
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>
            <div className="field full">
              <label htmlFor="loginPhone">Phone Number for Alerts</label>
              <input
                id="loginPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
              />
            </div>
            <div className="field full">
              <button className="btn" type="submit">
                <LucideIcon name="LogIn" />
                <span>Login</span>
              </button>
            </div>
            <div className="field full">
              <p className="muted" style={{ margin: 0 }}>
                New here?{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setAuthTab("register")}
                >
                  Create an account
                </button>
                {" "}or{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setResetEmail(loginUsername.includes("@") ? loginUsername : "");
                    setResetStep("email");
                    setAuthTab("forgot");
                  }}
                >
                  reset password
                </button>
              </p>
            </div>
          </form>

          <form
            className={`form-grid${authTab !== "register" ? " hidden" : ""}`}
            onSubmit={handleRegister}
          >
            <div className="field full">
              <label htmlFor="registerUsername">Username</label>
              <input
                id="registerUsername"
                autoComplete="username"
                value={registerUsername}
                onChange={(e) => setRegisterUsername(e.target.value)}
                required
              />
            </div>
            <div className="field full">
              <label htmlFor="registerEmail">Email</label>
              <input
                id="registerEmail"
                type="email"
                autoComplete="email"
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                required
              />
            </div>
            <div className="field full">
              <label htmlFor="registerPhone">Phone Number</label>
              <input
                id="registerPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                value={registerPhone}
                onChange={(e) => setRegisterPhone(e.target.value)}
                required
              />
            </div>
            <div className="field full">
              <label htmlFor="registerPassword">Password</label>
              <input
                id="registerPassword"
                type="password"
                autoComplete="new-password"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                required
              />
            </div>
            <div className="field full">
              <button className="btn" type="submit">
                <LucideIcon name="UserPlus" />
                <span>Register</span>
              </button>
            </div>
            <div className="field full">
              <p className="muted" style={{ margin: 0 }}>
                Already have an account?{" "}
                <button type="button" className="link-btn" onClick={() => setAuthTab("login")}>
                  Sign in
                </button>
              </p>
            </div>
          </form>

          <div className={authTab !== "forgot" ? " hidden" : ""}>
            <div className="reset-steps">
              <span className={resetStep === "email" ? "active" : ""}>Email</span>
              <span className={resetStep === "otp" ? "active" : ""}>OTP</span>
              <span className={resetStep === "password" ? "active" : ""}>Password</span>
            </div>

            <form
              className={`form-grid${resetStep !== "email" ? " hidden" : ""}`}
              onSubmit={handleForgotPassword}
            >
              <div className="field full">
                <label htmlFor="resetEmail">Email</label>
                <input
                  id="resetEmail"
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field full">
                <button className="btn secondary" type="submit">
                  <LucideIcon name="Mail" />
                  <span>Send OTP</span>
                </button>
              </div>
            </form>

            <form
              className={`form-grid reset-form${resetStep !== "otp" ? " hidden" : ""}`}
              onSubmit={handleVerifyOtp}
            >
              <div className="field full">
                <label htmlFor="resetOtp">OTP</label>
                <input
                  id="resetOtp"
                  inputMode="numeric"
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value)}
                  required
                />
              </div>
              <div className="field full">
                <button className="btn" type="submit">
                  <LucideIcon name="ShieldCheck" />
                  <span>Verify OTP</span>
                </button>
              </div>
            </form>

            <form
              className={`form-grid reset-form${resetStep !== "password" ? " hidden" : ""}`}
              onSubmit={handleResetPassword}
            >
              <div className="field full">
                <label htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={resetPasswordValue}
                  onChange={(e) => setResetPasswordValue(e.target.value)}
                  required
                />
              </div>
              <div className="field full">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <div className="field full">
                <button className="btn" type="submit">
                  <LucideIcon name="ShieldCheck" />
                  <span>Save New Password</span>
                </button>
              </div>
              <div className="field full">
                <p className="muted" style={{ margin: 0 }}>
                  Remembered it?{" "}
                  <button type="button" className="link-btn" onClick={() => setAuthTab("login")}>
                    Sign in
                  </button>
                </p>
              </div>
            </form>
          </div>
        </section>
        <div className="auth-visual" aria-hidden="true" />
      </div>
    </section>
  );
}
