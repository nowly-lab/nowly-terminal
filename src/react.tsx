import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  mountTerminal,
  type MountTerminalOptions,
  type TerminalHandle,
} from "./browser.js";
export interface TerminalViewProps extends MountTerminalOptions {
  className?: string;
  style?: CSSProperties;
}
export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(
  function TerminalView(props, ref) {
    const element = useRef<HTMLDivElement>(null),
      handle = useRef<TerminalHandle | null>(null),
      latest = useRef(props);
    latest.current = props;
    const [error, setError] = useState("");
    useImperativeHandle(
      ref,
      () => ({
        focus: () => handle.current?.focus(),
        paste: (text) => handle.current?.paste(text),
        findNext: (text) => handle.current?.findNext(text) ?? false,
        findPrevious: (text) => handle.current?.findPrevious(text) ?? false,
        clearSearch: () => handle.current?.clearSearch(),
        dispose: () => handle.current?.dispose(),
      }),
      [],
    );
    useEffect(() => {
      setError("");
      if (!element.current) return;
      handle.current = mountTerminal(element.current, {
        transport: props.transport,
        sessionId: props.sessionId,
        terminalOptions: latest.current.terminalOptions,
        onState: (state) => latest.current.onState?.(state),
        onTitle: (title) => latest.current.onTitle?.(title),
        onError: (error) => {
          setError(error.message);
          latest.current.onError?.(error);
        },
      });
      return () => {
        handle.current?.dispose();
        handle.current = null;
      };
    }, [props.transport, props.sessionId]);
    return (
      <div className={`nt-view ${props.className ?? ""}`} style={props.style}>
        <div ref={element} className="nt-screen" />
        {error && (
          <div role="alert" className="nt-error">
            {error}
          </div>
        )}
      </div>
    );
  },
);
export {
  TerminalWorkspace,
  type TerminalWorkspaceProps,
  type WorkspaceLayout,
} from "./workspace.js";
export type { TerminalHandle, MountTerminalOptions } from "./browser.js";
