import { useEffect, useRef, useState } from "react";
import type { DashboardPoint } from "./dashboardChartData";
import "./DashboardCharts.css";

export function DashboardChart({
  kind,
  points,
  emptyLabel,
}: {
  kind: "bar" | "doughnut";
  points: readonly DashboardPoint[];
  emptyLabel: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hasData = points.some(({ value }) => value > 0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!hasData || unavailable) return;
    let active = true;
    let destroyChart: (() => void) | undefined;

    void import("./renderDashboardChart")
      .then(({ renderDashboardChart }) => {
        if (!active) return;
        const context = canvas.current?.getContext("2d");
        if (context) destroyChart = renderDashboardChart(context, kind, points);
        else setUnavailable(true);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });

    return () => {
      active = false;
      destroyChart?.();
    };
  }, [hasData, kind, points, unavailable]);

  return (
    <div className={`dashboard-chart dashboard-chart--${kind}`}>
      {hasData && !unavailable ? (
        <div className="dashboard-chart__canvas">
          <canvas ref={canvas} aria-hidden="true" />
        </div>
      ) : (
        <p className="dashboard-chart__empty">
          {hasData ? "Chart unavailable. Counts are shown below." : emptyLabel}
        </p>
      )}
      <dl className="dashboard-chart__values">
        {points.map(({ label, value, color }) => (
          <div key={label}>
            <dt>
              <span aria-hidden="true" style={{ backgroundColor: color }} />
              {label}
            </dt>
            <dd>{value.toLocaleString("en-KE")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
