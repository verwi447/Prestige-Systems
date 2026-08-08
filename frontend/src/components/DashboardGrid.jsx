import { useEffect, useMemo, useRef, useState } from "react";
import RGL, { WidthProvider } from "react-grid-layout";
import { Check, GripVertical, LayoutGrid, RotateCcw, X } from "lucide-react";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./DashboardGrid.css";

const GridLayout = WidthProvider(RGL);
const GRID_COLS = 12;
const ROW_HEIGHT = 40;

function readStoredState(storageKey, widgetIds) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((id) => widgetIds.includes(id)) : [];
    const layout = Array.isArray(parsed.layout) ? parsed.layout.filter((item) => widgetIds.includes(item.i)) : [];
    return { layout, hidden };
  } catch {
    return null;
  }
}

export default function DashboardGrid({ storageKey, widgets }) {
  const widgetIds = useMemo(() => widgets.map((widget) => widget.id), [widgets]);
  const defaultLayout = useMemo(
    () => widgets.map((widget) => ({ i: widget.id, ...widget.defaultLayout })),
    [widgets]
  );

  const [editMode, setEditMode] = useState(false);
  const [widgetMenuOpen, setWidgetMenuOpen] = useState(false);
  const [layout, setLayout] = useState(() => {
    const stored = readStoredState(storageKey, widgetIds);
    if (!stored || stored.layout.length === 0) return defaultLayout;
    const storedById = new Map(stored.layout.map((item) => [item.i, item]));
    return widgets.map((widget) => storedById.get(widget.id) || { i: widget.id, ...widget.defaultLayout });
  });
  const [hidden, setHidden] = useState(() => new Set(readStoredState(storageKey, widgetIds)?.hidden || []));
  const menuRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ layout, hidden: [...hidden] }));
    } catch {
      // Layout customization is a convenience feature; storage failures are non-fatal.
    }
  }, [storageKey, layout, hidden]);

  useEffect(() => {
    if (!widgetMenuOpen) return undefined;
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setWidgetMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [widgetMenuOpen]);

  const toggleWidget = (id) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetLayout = () => {
    setLayout(defaultLayout);
    setHidden(new Set());
  };

  const visibleWidgets = widgets.filter((widget) => !hidden.has(widget.id));
  const visibleLayout = layout.filter((item) => !hidden.has(item.i));

  return (
    <div className="dashboard-grid-wrap">
      <div className="dashboard-grid-toolbar">
        <div className="dashboard-grid-toolbar-menu" ref={menuRef}>
          <button
            type="button"
            className="dashboard-grid-btn"
            onClick={() => setWidgetMenuOpen((value) => !value)}
          >
            <LayoutGrid size={16} aria-hidden="true" />
            Widgety{hidden.size > 0 ? ` (${hidden.size} ukrytych)` : ""}
          </button>
          {widgetMenuOpen && (
            <div className="dashboard-grid-widget-menu" role="menu">
              {widgets.map((widget) => (
                <button
                  type="button"
                  key={widget.id}
                  className="dashboard-grid-widget-menu-item"
                  onClick={() => toggleWidget(widget.id)}
                  role="menuitemcheckbox"
                  aria-checked={!hidden.has(widget.id)}
                >
                  <span className={`dashboard-grid-checkbox ${hidden.has(widget.id) ? "" : "checked"}`}>
                    {!hidden.has(widget.id) && <Check size={13} aria-hidden="true" />}
                  </span>
                  {widget.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {editMode && (
          <button type="button" className="dashboard-grid-btn" onClick={resetLayout}>
            <RotateCcw size={16} aria-hidden="true" />
            Przywróć domyślny układ
          </button>
        )}

        <button
          type="button"
          className={editMode ? "dashboard-grid-btn active" : "dashboard-grid-btn"}
          onClick={() => setEditMode((value) => !value)}
        >
          {editMode ? "Zakończ edycję" : "Edytuj panel"}
        </button>
      </div>

      <GridLayout
        className={editMode ? "dashboard-grid editing" : "dashboard-grid"}
        layout={visibleLayout}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        margin={[16, 16]}
        isDraggable={editMode}
        isResizable={editMode}
        draggableHandle=".dashboard-widget-drag-handle"
        onLayoutChange={(nextLayout) => {
          setLayout((current) => {
            const nextById = new Map(nextLayout.map((item) => [item.i, item]));
            return current.map((item) => nextById.get(item.i) || item);
          });
        }}
      >
        {visibleWidgets.map((widget) => (
          <div key={widget.id} className="dashboard-widget">
            <div className="dashboard-widget-header">
              {editMode && (
                <span className="dashboard-widget-drag-handle" aria-hidden="true">
                  <GripVertical size={16} />
                </span>
              )}
              <h2>{widget.title}</h2>
              {editMode && (
                <button
                  type="button"
                  className="dashboard-widget-hide"
                  aria-label={`Ukryj widget: ${widget.title}`}
                  onClick={() => toggleWidget(widget.id)}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <div className="dashboard-widget-body">{widget.content}</div>
          </div>
        ))}
      </GridLayout>
    </div>
  );
}
