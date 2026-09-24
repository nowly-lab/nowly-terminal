import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AgentActivity,
  TerminalWorkspace,
  type WorkspaceLayout,
} from "@nowly/terminal/react";
import "@nowly/terminal/styles.css";
import { IpcTransport } from "./ipc-transport";
import "./styles.css";
const transport = new IpcTransport();
const isCodex = new URLSearchParams(location.search).get("program") === "codex";
const layoutKey = `native-terminal-layout:${isCodex ? "codex" : "shell"}`;
function loadLayout(): WorkspaceLayout | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(layoutKey) ?? "null");
    if (
      value &&
      Array.isArray(value.tabs) &&
      value.tabs.every(
        (tab: any) =>
          typeof tab.id === "string" &&
          Array.isArray(tab.panes) &&
          tab.panes.every((id: any) => typeof id === "string"),
      )
    )
      return value;
  } catch {}
}
function App() {
  const [layout] = useState(loadLayout);
  const save = useCallback(
    (value: WorkspaceLayout) =>
      localStorage.setItem(layoutKey, JSON.stringify(value)),
    [],
  );
  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">NOWLY / NATIVE TERMINAL</span>
          <h1>
            {isCodex
              ? "Codexと、このMacで作業。"
              : "アプリの中に、いつものシェル。"}
          </h1>
          <p>
            {isCodex
              ? "タスクを依頼すると、実行状況と子エージェントの動きが下に表示されます。"
              : "普段の PATH とエイリアスで、この Mac のコマンドを実行できます。"}
          </p>
        </div>
        <span className="badge">● ローカルで実行</span>
      </header>
      <section>
        <TerminalWorkspace
          transport={transport}
          initialLayout={layout}
          onLayoutChange={save}
        />
      </section>
      <AgentActivity transport={transport} />
      <footer>
        <span>
          アプリを閉じてもターミナルは動き続け、再起動時に復帰します。
        </span>
        <span>Ctrl+C で中断 · ⌘R で画面を再読み込み</span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
