import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { TerminalTransport } from "./protocol.js";
import { TerminalView } from "./react.js";
import type { TerminalHandle } from "./browser.js";
export interface WorkspaceTab {
  id: string;
  title: string;
  panes: string[];
  direction: "row" | "column";
}
export interface WorkspaceLayout {
  tabs: WorkspaceTab[];
  activeTab: string;
}
export interface TerminalWorkspaceProps {
  transport: TerminalTransport;
  initialLayout?: WorkspaceLayout;
  onLayoutChange?: (layout: WorkspaceLayout) => void;
  className?: string;
  style?: CSSProperties;
}
const id = () => crypto.randomUUID();
function newTab(index: number): WorkspaceTab {
  return {
    id: id(),
    title: `Terminal ${index}`,
    panes: [id()],
    direction: "row",
  };
}
function Pane({
  sessionId,
  transport,
  onClose,
}: {
  sessionId: string;
  transport: TerminalTransport;
  onClose: () => void;
}) {
  const handle = useRef<TerminalHandle>(null);
  const [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("connecting");
  return (
    <section className="nt-pane" aria-label="Terminal pane">
      <div className="nt-pane-header">
        <span className="nt-status">
          <i data-state={status} />
          {status}
        </span>
        <span className="nt-pane-actions">
          <button
            aria-label="Search terminal"
            title="Search terminal"
            onClick={() => setSearch(!search)}
          >
            ⌕
          </button>
          <button aria-label="Close pane" title="Close pane" onClick={onClose}>
            ×
          </button>
        </span>
      </div>
      {search && (
        <div className="nt-search">
          <input
            autoFocus
            placeholder="Find in terminal"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handle.current?.findNext(query);
              if (e.key === "Escape") {
                setSearch(false);
                handle.current?.clearSearch();
              }
            }}
          />
          <button
            aria-label="Previous match"
            onClick={() => handle.current?.findPrevious(query)}
          >
            ↑
          </button>
          <button
            aria-label="Next match"
            onClick={() => handle.current?.findNext(query)}
          >
            ↓
          </button>
        </div>
      )}
      <TerminalView
        ref={handle}
        transport={transport}
        sessionId={sessionId}
        onState={setStatus}
      />
    </section>
  );
}
export function TerminalWorkspace({
  transport,
  initialLayout,
  onLayoutChange,
  className,
  style,
}: TerminalWorkspaceProps) {
  const [layout, setLayout] = useState<WorkspaceLayout>(() => {
    if (initialLayout?.tabs.length) return initialLayout;
    const tab = newTab(1);
    return { tabs: [tab], activeTab: tab.id };
  });
  const [error, setError] = useState("");
  useEffect(() => {
    onLayoutChange?.(layout);
  }, [layout, onLayoutChange]);
  function split(direction: "row" | "column") {
    setLayout((value) => ({
      ...value,
      tabs: value.tabs.map((tab) =>
        tab.id === value.activeTab
          ? { ...tab, direction, panes: [...tab.panes, id()] }
          : tab,
      ),
    }));
  }
  async function closePane(tabId: string, sessionId: string) {
    try {
      await transport.request("close", { id: sessionId });
      setError("");
      setLayout((value) => {
        const tabs = value.tabs
          .map((tab) =>
            tab.id === tabId
              ? { ...tab, panes: tab.panes.filter((p) => p !== sessionId) }
              : tab,
          )
          .filter((tab) => tab.panes.length);
        return {
          tabs,
          activeTab: tabs.some((t) => t.id === value.activeTab)
            ? value.activeTab
            : (tabs[0]?.id ?? ""),
        };
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <div className={`nt-workspace ${className ?? ""}`} style={style}>
      <header className="nt-toolbar">
        <div className="nt-tabs" role="tablist" aria-label="Terminals">
          {layout.tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={tab.id === layout.activeTab}
              onDoubleClick={() => {
                const title = window.prompt("Terminal name", tab.title);
                if (title?.trim())
                  setLayout((value) => ({
                    ...value,
                    tabs: value.tabs.map((t) =>
                      t.id === tab.id ? { ...t, title: title.trim() } : t,
                    ),
                  }));
              }}
              onClick={() =>
                setLayout((value) => ({ ...value, activeTab: tab.id }))
              }
            >
              <span className="nt-tab-icon">›_</span>
              {tab.title}
            </button>
          ))}
        </div>
        <div className="nt-tools">
          <button
            aria-label="New tab"
            title="New tab"
            onClick={() => {
              const tab = newTab(layout.tabs.length + 1);
              setLayout((value) => ({
                tabs: [...value.tabs, tab],
                activeTab: tab.id,
              }));
            }}
          >
            ＋
          </button>
          <button
            aria-label="Split right"
            title="Split right"
            disabled={!layout.tabs.length}
            onClick={() => split("row")}
          >
            ◫
          </button>
          <button
            aria-label="Split down"
            title="Split down"
            disabled={!layout.tabs.length}
            onClick={() => split("column")}
          >
            ⊟
          </button>
        </div>
      </header>
      {error && (
        <div className="nt-error" role="alert">
          {error}
        </div>
      )}
      {!layout.tabs.length && (
        <div className="nt-empty">Create a terminal to start a shell.</div>
      )}
      {layout.tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          className={`nt-panes nt-panes-${tab.direction}`}
          hidden={tab.id !== layout.activeTab}
        >
          {tab.panes.map((sessionId, index) => (
            <div
              key={sessionId}
              className="nt-pane-slot"
              style={
                {
                  "--nt-pane-share": `${100 / tab.panes.length}%`,
                  resize:
                    index < tab.panes.length - 1
                      ? tab.direction === "row"
                        ? "horizontal"
                        : "vertical"
                      : "none",
                } as CSSProperties
              }
            >
              <Pane
                sessionId={sessionId}
                transport={transport}
                onClose={() => void closePane(tab.id, sessionId)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
