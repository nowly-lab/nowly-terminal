import {StrictMode,useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WebSocketTransport} from '../../src/client.js';
import {TerminalWorkspace,type WorkspaceLayout} from '../../src/react.js';
import '../../src/styles.css';
import './page.css';
const transport=new WebSocketTransport({url:'ws://127.0.0.1:5187/terminal',token:sessionStorage.getItem('terminal-token')??'local-demo-token'});
function loadLayout():WorkspaceLayout|undefined{try{const value=JSON.parse(localStorage.getItem('nowly-terminal-demo')??'null');if(value&&Array.isArray(value.tabs)&&value.tabs.every((t:any)=>typeof t.id==='string'&&Array.isArray(t.panes)&&t.panes.every((id:any)=>typeof id==='string')))return value;}catch{}return undefined;}
function App(){const [layout]=useState(loadLayout);const save=useCallback((value:WorkspaceLayout)=>localStorage.setItem('nowly-terminal-demo',JSON.stringify(value)),[]);
 return <main><div className="page-heading"><div><span className="eyebrow">NOWLY / DEVELOPER TOOLS</span><h1>A terminal. In your app.</h1><p>Real shells, persistent sessions, and a UI that fits where you work.</p></div><span className="local-badge"><i/> Local environment</span></div><div className="workspace-label"><span>INTEGRATION PLAYGROUND</span><button onClick={()=>transport.reconnect()}>Reconnect</button></div><div className="workspace-frame"><TerminalWorkspace transport={transport} initialLayout={layout} onLayoutChange={save}/></div><footer><span>Shell sessions stay alive when you switch tabs or reload.</span><span>React + WebSocket + PTY</span></footer></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
