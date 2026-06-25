import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import LucideIcon from "../components/LucideIcon.jsx";
import TelemetryPanel from "../components/TelemetryPanel.jsx";
import { breakdownColors, formatKwh, timelineToChartPoints } from "../utils/energyUtils.js";

const RANGE_TABS = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

function linePath(points, maxValue) {
  const ceiling = Math.max(maxValue, 0.5);
  return points
    .map((value, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100;
      const y = 100 - (value / ceiling) * 100;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaPath(points, maxValue) {
  return `${linePath(points, maxValue)} L 100 100 L 0 100 Z`;
}

export default function EnergyView() {
  const { energySummary, loadEnergySummary, backendStatus, token } = useApp();
  const [activeRange, setActiveRange] = useState("today");
  const [hoverIndex, setHoverIndex] = useState(0);

  useEffect(() => {
    if (!token || backendStatus !== "online") return;
    loadEnergySummary(activeRange);
  }, [activeRange, token, backendStatus, loadEnergySummary]);

  const chartPoints = useMemo(
    () => timelineToChartPoints(energySummary?.timeline, [0]),
    [energySummary],
  );

  const maxValue = useMemo(
    () => Math.max(...chartPoints, 0.5),
    [chartPoints],
  );

  const usageBreakdown = energySummary?.usage_breakdown?.length
    ? energySummary.usage_breakdown
    : [{ label: "No readings", percent: 100, power_w: 0 }];

  const donutStops = useMemo(() => {
    let start = 0;
    return usageBreakdown.map((item, index) => {
      const end = start + item.percent;
      const stop = `${breakdownColors(index)} ${start}% ${end}%`;
      start = end;
      return stop;
    }).join(", ");
  }, [usageBreakdown]);

  const activePoint = chartPoints[hoverIndex] ?? chartPoints[0] ?? 0;
  const activeX = (hoverIndex / Math.max(chartPoints.length - 1, 1)) * 100;
  const activeY = 100 - (activePoint / maxValue) * 100;
  const timelineLabel = energySummary?.timeline?.[hoverIndex]?.label || "--:--";
  const dataSource = energySummary?.has_hardware_power
    ? "Hardware power readings"
    : "Estimated from device state until power telemetry arrives";

  const handleChartPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const nextIndex = Math.round((x / rect.width) * Math.max(chartPoints.length - 1, 0));
    setHoverIndex(nextIndex);
  };

  return (
    <section className="view active energy-reference-page energy-with-shared-nav">
      <p className="energy-data-source">{dataSource}</p>

      <div className="energy-stat-grid">
        <article className="energy-stat-card">
          <div className="energy-stat-icon blue"><LucideIcon name="Zap" /></div>
          <div>
            <span>Current Usage</span>
            <strong>{formatKwh(energySummary?.current_kw ?? 0)} <small>kW</small></strong>
            <em className="blue">{energySummary?.reading_count || 0} telemetry samples</em>
          </div>
        </article>
        <article className="energy-stat-card">
          <div className="energy-stat-icon green"><LucideIcon name="ShieldCheck" /></div>
          <div>
            <span>Daily Average</span>
            <strong>{formatKwh(energySummary?.daily_average_kwh ?? 0)} <small>kWh</small></strong>
            <em className="green">Range: {activeRange}</em>
          </div>
        </article>
        <article className="energy-stat-card">
          <div className="energy-stat-icon blue"><LucideIcon name="CalendarDays" /></div>
          <div>
            <span>This Month</span>
            <strong>{formatKwh(energySummary?.month_total_kwh ?? 0, 0)} <small>kWh</small></strong>
            <em className="green">Projected from live readings</em>
          </div>
        </article>
        <article className="energy-stat-card">
          <div className="energy-stat-icon amber"><LucideIcon name="Workflow" /></div>
          <div>
            <span>Estimated Bill</span>
            <strong>Rs {Math.round(energySummary?.estimated_bill || 0).toLocaleString()}</strong>
            <em className="red">@ Rs 8.5 / kWh</em>
          </div>
        </article>
      </div>

      <div className="energy-dashboard-grid">
        <section className="energy-usage-card">
          <div className="energy-card-head energy-card-head-stacked">
            <h3>Energy Usage</h3>
            <div className="energy-range-tabs">
              {RANGE_TABS.map((range) => (
                <button
                  className={activeRange === range.id ? "active" : ""}
                  type="button"
                  key={range.id}
                  onClick={() => {
                    setActiveRange(range.id);
                    setHoverIndex(0);
                  }}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="energy-line-chart"
            onMouseMove={handleChartPointer}
            onMouseLeave={() => setHoverIndex(0)}
          >
            <span className="energy-axis-label">kWh</span>
            <div
              className="energy-tooltip"
              style={{ left: `${Math.min(Math.max(activeX, 12), 88)}%` }}
            >
              <small>{timelineLabel}</small>
              <strong>{formatKwh(activePoint)} kWh</strong>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="energyLineFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#1764ff" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#1764ff" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path className="energy-line-area" d={areaPath(chartPoints, maxValue)} />
              <path className="energy-line-path" d={linePath(chartPoints, maxValue)} />
              {chartPoints.map((value, index) => (
                <circle
                  key={`${value}-${index}`}
                  cx={(index / Math.max(chartPoints.length - 1, 1)) * 100}
                  cy={100 - (value / maxValue) * 100}
                  r={index === hoverIndex ? "1.35" : "0.8"}
                />
              ))}
              <line className="energy-chart-marker" x1={activeX} x2={activeX} y1={activeY} y2="100" />
            </svg>
            <div className="energy-y-axis">
              <span>{formatKwh(maxValue)}</span>
              <span>{formatKwh(maxValue * 0.75)}</span>
              <span>{formatKwh(maxValue * 0.5)}</span>
              <span>{formatKwh(maxValue * 0.25)}</span>
              <span>0</span>
            </div>
          </div>
        </section>

        <section className="energy-device-card">
          <h3>Usage by Devices</h3>
          <div className="energy-donut-layout">
            <div className="energy-donut" style={{ "--donut-stops": donutStops }}>
              <div>
                <strong>{formatKwh(energySummary?.month_total_kwh ?? 0, 0)}</strong>
                <span>kWh</span>
              </div>
            </div>
            <div className="energy-donut-legend">
              {usageBreakdown.map((item, index) => (
                <div key={item.label}>
                  <span style={{ background: breakdownColors(index) }} />
                  <p>{item.label}</p>
                  <strong>{item.percent}%</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <TelemetryPanel title="Environmental readings (hardware)" />
    </section>
  );
}
