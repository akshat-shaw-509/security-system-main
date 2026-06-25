import { useEffect, useState } from "react";
import LucideIcon from "./components/LucideIcon.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Toast from "./components/Toast.jsx";
import Topbar from "./components/Topbar.jsx";
import { AppProvider, useApp } from "./context/AppContext.jsx";
import AccessView from "./views/AccessView.jsx";
import DevicesView from "./views/DevicesView.jsx";
import EnergyView from "./views/EnergyView.jsx";
import OverviewView from "./views/OverviewView.jsx";
import AutomationView from "./views/AutomationView.jsx";
import RoomsView from "./views/RoomsView.jsx";
import SchedulesView from "./views/SchedulesView.jsx";
import SecurityView from "./views/SecurityView.jsx";
import SettingsView from "./views/SettingsView.jsx";

const SETTINGS_STORAGE_KEY = "smart_home_settings_preferences";

const TRANSLATIONS = {
  hi: {
    Dashboard: "डैशबोर्ड",
    Rooms: "कमरे",
    Devices: "डिवाइस",
    Energy: "ऊर्जा",
    Security: "सुरक्षा",
    Schedules: "शेड्यूल",
    Automation: "ऑटोमेशन",
    Settings: "सेटिंग्स",
    Account: "खाता",
    General: "सामान्य",
    Notifications: "सूचनाएं",
    Integrations: "इंटीग्रेशन",
    Backup: "बैकअप",
    Privacy: "गोपनीयता",
    "Quick Actions": "त्वरित कार्य",
    "System Information": "सिस्टम जानकारी",
    "Save Changes": "बदलाव सहेजें",
    "Create Rule": "नियम बनाएं",
    "All Devices Online": "सभी डिवाइस ऑनलाइन",
    "Home Name": "घर का नाम",
    Location: "स्थान",
    "Temperature Unit": "तापमान इकाई",
    "Time Zone": "समय क्षेत्र",
    Language: "भाषा",
    "Dark Mode": "डार्क मोड",
    "Auto Update": "ऑटो अपडेट",
    View: "देखें",
    "Restart System": "सिस्टम पुनः शुरू करें",
    "Clear Cache": "कैश साफ करें",
    "Backup Data": "डेटा बैकअप",
    "Export Logs": "लॉग निर्यात करें",
  },
  te: {
    Dashboard: "డాష్‌బోర్డ్",
    Rooms: "గదులు",
    Devices: "పరికరాలు",
    Energy: "శక్తి",
    Security: "భద్రత",
    Schedules: "షెడ్యూల్స్",
    Automation: "ఆటోమేషన్",
    Settings: "సెట్టింగ్స్",
    Account: "ఖాతా",
    General: "సాధారణం",
    Notifications: "నోటిఫికేషన్లు",
    Integrations: "ఇంటిగ్రేషన్లు",
    Backup: "బ్యాకప్",
    Privacy: "గోప్యత",
    "Quick Actions": "త్వరిత చర్యలు",
    "System Information": "సిస్టమ్ సమాచారం",
    "Save Changes": "మార్పులు సేవ్ చేయండి",
    View: "చూడండి",
  },
  ta: {
    Dashboard: "டாஷ்போர்டு",
    Rooms: "அறைகள்",
    Devices: "சாதனங்கள்",
    Energy: "ஆற்றல்",
    Security: "பாதுகாப்பு",
    Schedules: "அட்டவணைகள்",
    Automation: "தானியக்கம்",
    Settings: "அமைப்புகள்",
    Account: "கணக்கு",
    General: "பொது",
    Notifications: "அறிவிப்புகள்",
    Privacy: "தனியுரிமை",
    "Save Changes": "மாற்றங்களை சேமிக்கவும்",
    View: "பார்க்க",
  },
  es: {
    Dashboard: "Panel",
    Rooms: "Habitaciones",
    Devices: "Dispositivos",
    Energy: "Energía",
    Security: "Seguridad",
    Schedules: "Horarios",
    Automation: "Automatización",
    Settings: "Ajustes",
    Account: "Cuenta",
    General: "General",
    Notifications: "Notificaciones",
    Privacy: "Privacidad",
    "Quick Actions": "Acciones rápidas",
    "System Information": "Información del sistema",
    "Save Changes": "Guardar cambios",
    View: "Ver",
  },
  fr: {
    Dashboard: "Tableau de bord",
    Rooms: "Pièces",
    Devices: "Appareils",
    Energy: "Énergie",
    Security: "Sécurité",
    Schedules: "Plannings",
    Automation: "Automatisation",
    Settings: "Paramètres",
    Account: "Compte",
    General: "Général",
    Notifications: "Notifications",
    Privacy: "Confidentialité",
    "Save Changes": "Enregistrer",
    View: "Voir",
  },
  de: {
    Dashboard: "Dashboard",
    Rooms: "Räume",
    Devices: "Geräte",
    Energy: "Energie",
    Security: "Sicherheit",
    Schedules: "Zeitpläne",
    Automation: "Automatisierung",
    Settings: "Einstellungen",
    Account: "Konto",
    General: "Allgemein",
    Notifications: "Benachrichtigungen",
    Privacy: "Datenschutz",
    "Save Changes": "Änderungen speichern",
    View: "Anzeigen",
  },
  ja: {
    Dashboard: "ダッシュボード",
    Rooms: "部屋",
    Devices: "デバイス",
    Energy: "エネルギー",
    Security: "セキュリティ",
    Schedules: "スケジュール",
    Automation: "自動化",
    Settings: "設定",
    Account: "アカウント",
    General: "一般",
    Notifications: "通知",
    Privacy: "プライバシー",
    "Save Changes": "変更を保存",
    View: "表示",
  },
};

const ALIAS_TRANSLATIONS = {
  bn: "hi",
  mr: "hi",
  gu: "hi",
  kn: "hi",
  ml: "hi",
  pa: "hi",
  ur: "hi",
};

const HINDI_TRANSLATIONS = {
  "Smart Home": "\u0938\u094d\u092e\u093e\u0930\u094d\u091f \u0939\u094b\u092e",
  "Dashboard": "\u0921\u0948\u0936\u092c\u094b\u0930\u094d\u0921",
  "Rooms": "\u0915\u092e\u0930\u0947",
  "Devices": "\u0921\u093f\u0935\u093e\u0907\u0938",
  "Energy": "\u090a\u0930\u094d\u091c\u093e",
  "Security": "\u0938\u0941\u0930\u0915\u094d\u0937\u093e",
  "Schedules": "\u0936\u0947\u0921\u094d\u092f\u0942\u0932",
  "Automation": "\u0911\u091f\u094b\u092e\u0947\u0936\u0928",
  "Settings": "\u0938\u0947\u091f\u093f\u0902\u0917",
  "Account": "\u0916\u093e\u0924\u093e",
  "Login / Register": "\u0932\u0949\u0917\u093f\u0928 / \u0930\u091c\u093f\u0938\u094d\u091f\u0930",
  "Create and manage smart automations.": "\u0938\u094d\u092e\u093e\u0930\u094d\u091f \u0911\u091f\u094b\u092e\u0947\u0936\u0928 \u092c\u0928\u093e\u090f\u0902 \u0914\u0930 \u092a\u094d\u0930\u092c\u0902\u0927\u093f\u0924 \u0915\u0930\u0947\u0902\u0964",
  "Create scenes for repeatable routines.": "\u0926\u094b\u0939\u0930\u093e\u090f \u091c\u093e\u0928\u0947 \u0935\u093e\u0932\u0947 \u0930\u0942\u091f\u0940\u0928 \u0915\u0947 \u0932\u093f\u090f \u0938\u0940\u0928 \u092c\u0928\u093e\u090f\u0902\u0964",
  "Monitor safety, motion, and home protection.": "\u0938\u0941\u0930\u0915\u094d\u0937\u093e, \u092e\u094b\u0936\u0928 \u0914\u0930 \u0918\u0930 \u0915\u0940 \u0930\u0915\u094d\u0937\u093e \u092a\u0930 \u0928\u091c\u0930 \u0930\u0916\u0947\u0902\u0964",
  "Track usage and reduce wasted power.": "\u0909\u092a\u092f\u094b\u0917 \u091f\u094d\u0930\u0948\u0915 \u0915\u0930\u0947\u0902 \u0914\u0930 \u092c\u093f\u091c\u0932\u0940 \u0915\u0940 \u092c\u0930\u094d\u092c\u093e\u0926\u0940 \u0918\u091f\u093e\u090f\u0902\u0964",
  "Register, monitor, and control connected hardware.": "\u0915\u0928\u0947\u0915\u094d\u091f\u0947\u0921 \u0939\u093e\u0930\u094d\u0921\u0935\u0947\u092f\u0930 \u091c\u094b\u0921\u093c\u0947\u0902, \u092e\u0949\u0928\u093f\u091f\u0930 \u0915\u0930\u0947\u0902 \u0914\u0930 \u0928\u093f\u092f\u0902\u0924\u094d\u0930\u093f\u0924 \u0915\u0930\u0947\u0902\u0964",
  "Control every room from one place.": "\u0939\u0930 \u0915\u092e\u0930\u0947 \u0915\u094b \u090f\u0915 \u091c\u0917\u0939 \u0938\u0947 \u0928\u093f\u092f\u0902\u0924\u094d\u0930\u093f\u0924 \u0915\u0930\u0947\u0902\u0964",
  "Here's what's happening in your smart home today.": "\u0906\u091c \u0906\u092a\u0915\u0947 \u0938\u094d\u092e\u093e\u0930\u094d\u091f \u0939\u094b\u092e \u092e\u0947\u0902 \u092f\u0939 \u0939\u094b \u0930\u0939\u093e \u0939\u0948\u0964",
  "Manage, monitor and control your devices.": "\u0905\u092a\u0928\u0947 \u0921\u093f\u0935\u093e\u0907\u0938 \u0915\u093e \u092a\u094d\u0930\u092c\u0902\u0927\u0928, \u092e\u0949\u0928\u093f\u091f\u0930 \u0914\u0930 \u0928\u093f\u092f\u0902\u0924\u094d\u0930\u0923 \u0915\u0930\u0947\u0902\u0964",
  "All Devices": "\u0938\u092d\u0940 \u0921\u093f\u0935\u093e\u0907\u0938",
  "Lights": "\u0932\u093e\u0907\u091f",
  "Sensors": "\u0938\u0947\u0902\u0938\u0930",
  "Switches": "\u0938\u094d\u0935\u093f\u091a",
  "Cameras": "\u0915\u0948\u092e\u0930\u0947",
  "Locks": "\u0932\u0949\u0915",
  "Others": "\u0905\u0928\u094d\u092f",
  "Add Device": "\u0921\u093f\u0935\u093e\u0907\u0938 \u091c\u094b\u0921\u093c\u0947\u0902",
  "Add Room": "\u0915\u092e\u0930\u093e \u091c\u094b\u0921\u093c\u0947\u0902",
  "Add Schedule": "\u0936\u0947\u0921\u094d\u092f\u0942\u0932 \u091c\u094b\u0921\u093c\u0947\u0902",
  "Create Rule": "\u0928\u093f\u092f\u092e \u092c\u0928\u093e\u090f\u0902",
  "Top Devices": "\u092e\u0941\u0916\u094d\u092f \u0921\u093f\u0935\u093e\u0907\u0938",
  "Live Feed": "\u0932\u093e\u0907\u0935 \u092b\u0940\u0921",
  "Quick Actions": "\u0924\u094d\u0935\u0930\u093f\u0924 \u0915\u093e\u0930\u094d\u092f",
  "Recent Activity": "\u0939\u093e\u0932 \u0915\u0940 \u0917\u0924\u093f\u0935\u093f\u0927\u093f",
  "View all": "\u0938\u092d\u0940 \u0926\u0947\u0916\u0947\u0902",
  "View": "\u0926\u0947\u0916\u0947\u0902",
  "Good Night": "\u0936\u0941\u092d \u0930\u093e\u0924\u094d\u0930\u093f",
  "Away Mode": "\u0905\u0935\u0947 \u092e\u094b\u0921",
  "Movie Time": "\u092e\u0942\u0935\u0940 \u091f\u093e\u0907\u092e",
  "Morning Lights": "\u0938\u0941\u092c\u0939 \u0915\u0940 \u0932\u093e\u0907\u091f",
  "Energy Overview": "\u090a\u0930\u094d\u091c\u093e \u0938\u093e\u0930\u093e\u0902\u0936",
  "Automation Status": "\u0911\u091f\u094b\u092e\u0947\u0936\u0928 \u0938\u094d\u0925\u093f\u0924\u093f",
  "Total Devices": "\u0915\u0941\u0932 \u0921\u093f\u0935\u093e\u0907\u0938",
  "Online": "\u0911\u0928\u0932\u093e\u0907\u0928",
  "Offline": "\u0911\u092b\u0932\u093e\u0907\u0928",
  "Alerts": "\u0905\u0932\u0930\u094d\u091f",
  "No new alerts": "\u0915\u094b\u0908 \u0928\u092f\u093e \u0905\u0932\u0930\u094d\u091f \u0928\u0939\u0940\u0902",
  "Current Usage": "\u0935\u0930\u094d\u0924\u092e\u093e\u0928 \u0909\u092a\u092f\u094b\u0917",
  "Daily Average": "\u0926\u0948\u0928\u093f\u0915 \u0914\u0938\u0924",
  "This Month": "\u0907\u0938 \u092e\u0939\u0940\u0928\u0947",
  "Estimated Bill": "\u0905\u0928\u0941\u092e\u093e\u0928\u093f\u0924 \u092c\u093f\u0932",
  "Usage by Devices": "\u0921\u093f\u0935\u093e\u0907\u0938 \u0905\u0928\u0941\u0938\u093e\u0930 \u0909\u092a\u092f\u094b\u0917",
  "Today": "\u0906\u091c",
  "Week": "\u0938\u092a\u094d\u0924\u093e\u0939",
  "Month": "\u092e\u0939\u0940\u0928\u093e",
  "Year": "\u0938\u093e\u0932",
  "Security Status": "\u0938\u0941\u0930\u0915\u094d\u0937\u093e \u0938\u094d\u0925\u093f\u0924\u093f",
  "Your home is secure": "\u0906\u092a\u0915\u093e \u0918\u0930 \u0938\u0941\u0930\u0915\u094d\u0937\u093f\u0924 \u0939\u0948",
  "Recent Alerts": "\u0939\u093e\u0932 \u0915\u0947 \u0905\u0932\u0930\u094d\u091f",
  "Live Camera": "\u0932\u093e\u0907\u0935 \u0915\u0948\u092e\u0930\u093e",
  "Home": "\u0939\u094b\u092e",
  "Away": "\u092c\u093e\u0939\u0930",
  "Night": "\u0930\u093e\u0924",
  "Rules": "\u0928\u093f\u092f\u092e",
  "Scenes": "\u0938\u0940\u0928",
  "Integrations": "\u0907\u0902\u091f\u0940\u0917\u094d\u0930\u0947\u0936\u0928",
  "General": "\u0938\u093e\u092e\u093e\u0928\u094d\u092f",
  "Notifications": "\u0938\u0942\u091a\u0928\u093e\u090f\u0902",
  "Backup": "\u092c\u0948\u0915\u0905\u092a",
  "Privacy": "\u0917\u094b\u092a\u0928\u0940\u092f\u0924\u093e",
  "System Information": "\u0938\u093f\u0938\u094d\u091f\u092e \u091c\u093e\u0928\u0915\u093e\u0930\u0940",
  "Save Changes": "\u092c\u0926\u0932\u093e\u0935 \u0938\u0939\u0947\u091c\u0947\u0902",
  "Home Name": "\u0918\u0930 \u0915\u093e \u0928\u093e\u092e",
  "Location": "\u0938\u094d\u0925\u093e\u0928",
  "Temperature Unit": "\u0924\u093e\u092a\u092e\u093e\u0928 \u0907\u0915\u093e\u0908",
  "Time Zone": "\u0938\u092e\u092f \u0915\u094d\u0937\u0947\u0924\u094d\u0930",
  "Language": "\u092d\u093e\u0937\u093e",
  "Dark Mode": "\u0921\u093e\u0930\u094d\u0915 \u092e\u094b\u0921",
  "Auto Update": "\u0911\u091f\u094b \u0905\u092a\u0921\u0947\u091f",
  "Restart System": "\u0938\u093f\u0938\u094d\u091f\u092e \u092b\u093f\u0930 \u0936\u0941\u0930\u0942 \u0915\u0930\u0947\u0902",
  "Clear Cache": "\u0915\u0948\u0936 \u0938\u093e\u092b \u0915\u0930\u0947\u0902",
  "Backup Data": "\u0921\u0947\u091f\u093e \u092c\u0948\u0915\u0905\u092a",
  "Export Logs": "\u0932\u0949\u0917 \u0928\u093f\u0930\u094d\u092f\u093e\u0924",
  "Premium Plan": "\u092a\u094d\u0930\u0940\u092e\u093f\u092f\u092e \u092a\u094d\u0932\u093e\u0928",
  "All systems operational": "\u0938\u092d\u0940 \u0938\u093f\u0938\u094d\u091f\u092e \u091a\u093e\u0932\u0942 \u0939\u0948\u0902",
  "Backend online": "\u092c\u0948\u0915\u090f\u0902\u0921 \u0911\u0928\u0932\u093e\u0907\u0928",
  "All Devices Online": "\u0938\u092d\u0940 \u0921\u093f\u0935\u093e\u0907\u0938 \u0911\u0928\u0932\u093e\u0907\u0928",
  "All Systems Online": "\u0938\u092d\u0940 \u0938\u093f\u0938\u094d\u091f\u092e \u0911\u0928\u0932\u093e\u0907\u0928",
  "Search anything...": "\u0915\u0941\u091b \u092d\u0940 \u0916\u094b\u091c\u0947\u0902...",
  "Search rooms...": "\u0915\u092e\u0930\u0947 \u0916\u094b\u091c\u0947\u0902...",
  "Search schedules...": "\u0936\u0947\u0921\u094d\u092f\u0942\u0932 \u0916\u094b\u091c\u0947\u0902...",
  "Search automation...": "\u0911\u091f\u094b\u092e\u0947\u0936\u0928 \u0916\u094b\u091c\u0947\u0902...",
  "Search settings...": "\u0938\u0947\u091f\u093f\u0902\u0917 \u0916\u094b\u091c\u0947\u0902..."
};

Object.assign(TRANSLATIONS.hi, HINDI_TRANSLATIONS);
["te", "ta", "bn", "mr", "gu", "kn", "ml", "pa", "ur"].forEach((code) => {
  TRANSLATIONS[code] = { ...(TRANSLATIONS[code] || {}), ...HINDI_TRANSLATIONS };
});

function getStoredLanguage() {
  try {
    const preferences = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    return localStorage.getItem("smart_home_language") || preferences.language || "en";
  } catch {
    return "en";
  }
}

function translatePage(language) {
  const dictionary = TRANSLATIONS[language] || TRANSLATIONS[ALIAS_TRANSLATIONS[language]] || {};
  document.documentElement.lang = language || "en";
  const isEnglish = !language || language === "en" || !Object.keys(dictionary).length;
  const translateText = (text) => {
    const clean = String(text || "").trim();
    if (!clean) return text;
    if (dictionary[clean]) return dictionary[clean];
    if (clean.startsWith("Welcome back, ")) {
      return `${dictionary["Welcome back"] || "\u0935\u093e\u092a\u0938\u0940 \u092a\u0930 \u0938\u094d\u0935\u093e\u0917\u0924 \u0939\u0948"}, ${clean.replace("Welcome back, ", "")}`;
    }
    return text;
  };

  document.querySelectorAll("[data-i18n-original]").forEach((node) => {
    node.textContent = node.dataset.i18nOriginal;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.setAttribute("title", node.dataset.i18nTitle);
  });
  if (isEnglish) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    const original = node.parentElement?.dataset.i18nOriginal || node.textContent.trim();
    const translated = translateText(original);
    if (!original || translated === original) return;
    node.parentElement.dataset.i18nOriginal = original;
    node.textContent = node.textContent.replace(original, translated);
  });

  document.querySelectorAll("[placeholder]").forEach((node) => {
    const original = node.dataset.i18nPlaceholder || node.getAttribute("placeholder");
    const translated = translateText(original);
    if (translated === original) return;
    node.dataset.i18nPlaceholder = original;
    node.setAttribute("placeholder", translated);
  });

  document.querySelectorAll("[title]").forEach((node) => {
    const original = node.dataset.i18nTitle || node.getAttribute("title");
    const translated = translateText(original);
    if (translated === original) return;
    node.dataset.i18nTitle = original;
    node.setAttribute("title", translated);
  });
}

const VIEWS = {
  overview: OverviewView,
  rooms: RoomsView,
  devices: DevicesView,
  energy: EnergyView,
  security: SecurityView,
  schedules: SchedulesView,
  automation: AutomationView,
  settings: SettingsView,
  access: AccessView,
};

function Dashboard() {
  const { currentView } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const View = VIEWS[currentView] || OverviewView;

  useEffect(() => {
    let language = getStoredLanguage();
    const apply = () => window.requestAnimationFrame(() => translatePage(language));
    apply();
    const handleLanguage = (event) => {
      language = event.detail?.language || getStoredLanguage();
      apply();
    };
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("smart-home-language-change", handleLanguage);
    return () => {
      observer.disconnect();
      window.removeEventListener("smart-home-language-change", handleLanguage);
    };
  }, [currentView]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [currentView]);

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((value) => !value)}
      >
        <LucideIcon name={sidebarOpen ? "X" : "Menu"} />
      </button>
      <button
        className="mobile-nav-backdrop"
        type="button"
        aria-label="Close navigation"
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar onNavigate={() => setSidebarOpen(false)} />
      <main className={`main view-${currentView}`}>
        <Topbar />
        <View />
      </main>
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Dashboard />
    </AppProvider>
  );
}
