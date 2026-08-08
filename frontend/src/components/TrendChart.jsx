import { useMemo, useRef, useState } from "react";
import "./TrendChart.css";

const MONTH_FORMATTER = new Intl.DateTimeFormat("pl-PL", { month: "short" });

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 220;
const PAD_LEFT = 34;
const PAD_RIGHT = 54;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return MONTH_FORMATTER.format(new Date(year, month - 1, 1));
}

function niceCeiling(max) {
  if (max <= 0) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const residual = max / magnitude;
  let niceResidual = 10;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 5) niceResidual = 5;
  return niceResidual * magnitude;
}

export default function TrendChart({ data, series }) {
  const rootRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);

  const plotWidth = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const maxValue = useMemo(() => {
    const values = data.flatMap((point) => series.map((s) => Number(point[s.key]) || 0));
    return niceCeiling(Math.max(...values, 0));
  }, [data, series]);

  const yTicks = [0, maxValue / 2, maxValue];

  const xForIndex = (index) => (data.length <= 1 ? PAD_LEFT : PAD_LEFT + (plotWidth * index) / (data.length - 1));
  const yForValue = (value) => PAD_TOP + plotHeight - (plotHeight * value) / (maxValue || 1);

  const linePaths = series.map((s) => ({
    ...s,
    d: data.map((point, index) => `${index === 0 ? "M" : "L"}${xForIndex(index)},${yForValue(Number(point[s.key]) || 0)}`).join(" ")
  }));

  const handlePointerMove = (event) => {
    const svg = rootRef.current;
    if (!svg || data.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const dataX = ratio * VIEW_WIDTH;
    let nearest = 0;
    let nearestDistance = Infinity;
    data.forEach((_, index) => {
      const distance = Math.abs(xForIndex(index) - dataX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    });
    setHoverIndex(nearest);
  };

  const hoverPoint = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className="trend-chart-root">
      <div className="trend-chart-legend">
        {series.map((s) => (
          <span className="trend-chart-legend-item" key={s.key}>
            <span className="trend-chart-legend-key" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      <div className="trend-chart-plot">
        <svg
          ref={rootRef}
          className="trend-chart-svg"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`Wykres trendu: ${series.map((s) => s.label).join(", ")} w ostatnich ${data.length} miesiącach`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                className="trend-chart-gridline"
                x1={PAD_LEFT}
                x2={VIEW_WIDTH - PAD_RIGHT}
                y1={yForValue(tick)}
                y2={yForValue(tick)}
              />
              <text className="trend-chart-tick-label" x={PAD_LEFT - 8} y={yForValue(tick)} textAnchor="end" dominantBaseline="middle">
                {Math.round(tick)}
              </text>
            </g>
          ))}

          {data.map((point, index) => (
            <text
              key={point.month}
              className="trend-chart-axis-label"
              x={xForIndex(index)}
              y={VIEW_HEIGHT - PAD_BOTTOM + 18}
              textAnchor="middle"
            >
              {monthLabel(point.month)}
            </text>
          ))}

          {linePaths.map((line) => (
            <path key={line.key} className="trend-chart-line" d={line.d} stroke={line.color} fill="none" />
          ))}

          {linePaths.map((line) => {
            const lastIndex = data.length - 1;
            const lastValue = Number(data[lastIndex]?.[line.key]) || 0;
            return (
              <g key={`${line.key}-end`}>
                <circle
                  className="trend-chart-dot"
                  cx={xForIndex(lastIndex)}
                  cy={yForValue(lastValue)}
                  r={5}
                  fill={line.color}
                />
                <text
                  className="trend-chart-end-label"
                  x={xForIndex(lastIndex) + 9}
                  y={yForValue(lastValue)}
                  dominantBaseline="middle"
                >
                  {lastValue}
                </text>
              </g>
            );
          })}

          {series.map((s) =>
            data.map((point, index) => (
              index !== data.length - 1 && (
                <circle
                  key={`${s.key}-${point.month}`}
                  className="trend-chart-dot"
                  cx={xForIndex(index)}
                  cy={yForValue(Number(point[s.key]) || 0)}
                  r={hoverIndex === index ? 5 : 4}
                  fill={s.color}
                />
              )
            ))
          )}

          {hoverIndex !== null && (
            <line
              className="trend-chart-crosshair"
              x1={xForIndex(hoverIndex)}
              x2={xForIndex(hoverIndex)}
              y1={PAD_TOP}
              y2={VIEW_HEIGHT - PAD_BOTTOM}
            />
          )}
        </svg>

        {hoverPoint && (
          <div
            className="trend-chart-tooltip"
            style={{ left: `${(xForIndex(hoverIndex) / VIEW_WIDTH) * 100}%` }}
          >
            <strong>{monthLabel(hoverPoint.month)}</strong>
            {series.map((s) => (
              <div className="trend-chart-tooltip-row" key={s.key}>
                <span className="trend-chart-tooltip-key" style={{ background: s.color }} aria-hidden="true" />
                <span className="trend-chart-tooltip-value">{hoverPoint[s.key]}</span>
                <span className="trend-chart-tooltip-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
