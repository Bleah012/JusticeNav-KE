import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  LinearScale,
  Tooltip,
} from "chart.js";
import type { DashboardPoint } from "./dashboardChartData";

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  LinearScale,
  Tooltip,
);

export function renderDashboardChart(
  context: CanvasRenderingContext2D,
  kind: "bar" | "doughnut",
  points: readonly DashboardPoint[],
) {
  const labels = points.map(({ label }) => label);
  const data = points.map(({ value }) => value);
  const backgroundColor = points.map(({ color }) => color);
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
  } as const;
  const chart =
    kind === "bar"
      ? new Chart(context, {
          type: "bar",
          data: {
            labels,
            datasets: [
              { data, backgroundColor, borderRadius: 5, maxBarThickness: 38 },
            ],
          },
          options: {
            ...options,
            indexAxis: "y",
            scales: {
              x: {
                beginAtZero: true,
                border: { display: false },
                grid: { color: "#e3ebe6" },
                ticks: {
                  color: "#50615a",
                  precision: 0,
                  maxTicksLimit: 5,
                  font: { size: 14 },
                },
              },
              y: {
                border: { display: false },
                grid: { display: false },
                ticks: {
                  color: "#374842",
                  autoSkip: false,
                  font: { size: 14 },
                },
              },
            },
          },
        })
      : new Chart(context, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{ data, backgroundColor, borderWidth: 0 }],
          },
          options: { ...options, cutout: "72%" },
        });
  return () => chart.destroy();
}
