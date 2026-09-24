# Nowly Terminal

Orcaのターミナル構成を、他のアプリへ組み込みやすい独立パッケージとして再実装したものです。Node側の実PTY、通信、画面復元、ブラウザUI、Reactのタブ・分割UIを含みます。Orca本体は実行時に不要です。

## リポジトリ内のデモを起動

Node.js 22以上とpnpmを使用します。

```sh
pnpm install
pnpm dev
```

`pnpm dev` で画面とローカル実行サーバーの両方が起動します。[デモ画面](http://127.0.0.1:5186)を開きます。タブ作成、左右/上下分割、ペイン右下からサイズ変更、検索、タブ名のダブルクリック変更ができます。ブラウザの再読み込み後も同じシェルを使います。×で閉じるとシェルを終了します。

標準でログイン・対話シェルを起動し、`.zprofile` / `.zshrc`、PATH、エイリアスなど普段の設定を読み込みます。設定内の外部ツール初期化が終わるまで、プロンプトの表示を待ちます。設定を省略したい場合だけ `pnpm dev:clean` を指定します。`pnpm dev:user` は通常起動の互換エイリアスです。個別起動は `pnpm dev:server` と `pnpm dev:ui` です。

デモ専用の既知トークン `local-demo-token` を使っています。実アプリでは独自のランダムトークンを発行してください。`TERMINAL_TOKEN` 環境変数でデモサーバーを変更した場合、ブラウザの `sessionStorage['terminal-token']` へ同じ値を設定して再読み込みします。

## ネイティブアプリのサンプル

Orcaと同じElectronの構成で、メインプロセスがPTYを所有し、preloadの限定したIPC経由でReact画面へ接続します。WebSocketサーバーを起動せず、ローカルコマンドを実行できます。

```sh
pnpm native:setup # パッケージ作成・別依存環境へインストール・Electron用の再ビルド
pnpm native       # ネイティブウィンドウを起動
```

[組み込みサンプルと手順](examples/electron/README.md)。実パッケージだけをimportし、Orcaやこのリポジトリのsrcには依存しません。`pnpm native:pack` でサンプルソースとライブラリtgzをまとめた `nowly-terminal-native-example-0.1.2.tgz` を作れます。

## 他のアプリで使う

まだレジストリへ公開していません。ローカルでパッケージを作ってインストールできます。

```sh
pnpm pack  # 配布前に自動ビルドされます
# 組み込み先のプロジェクトで
pnpm add /path/to/nowly-terminal/nowly-terminal-0.1.2.tgz
```

インストール済みパッケージには `nowly-terminal` コマンドも含まれます。サーバー用コードを書かずに、次のように起動できます。

```sh
# シークレットはアプリ側にも安全に渡してください。
export TERMINAL_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
pnpm exec nowly-terminal serve --origin http://localhost:3000 --cwd .
```

`--port`、`--shell`、`--profile clean|user` を指定できます。標準ではログイン・対話シェルの設定を読み込みます。設定を省略する場合だけ `--profile clean` を指定します。UIはアプリ側に組み込み、上のサーバーへ接続します。

アプリのNodeプロセスに直接組み込む場合のサーバー側:

```ts
import { createTerminalServer } from '@nowly/terminal/server';

const server = await createTerminalServer({
  token: process.env.TERMINAL_TOKEN!,
  allowedOrigins: ['http://localhost:3000'],
  port: 5187,
  hostOptions: { cwd: process.cwd() },
});
// アプリ終了時: await server.close()
```

React側:

```tsx
import { WebSocketTransport } from '@nowly/terminal/client';
import { TerminalWorkspace } from '@nowly/terminal/react';
import '@nowly/terminal/styles.css';

// アプリの接続単位で一度だけ生成。トークンはアプリの認証経由で渡す。
const transport = new WebSocketTransport({
  url: 'ws://127.0.0.1:5187/terminal',
  token: terminalToken,
});

export function TerminalPanel() {
  return <div style={{ height: 500 }}>
    <TerminalWorkspace transport={transport} />
  </div>;
}
// 接続の所有者が破棄されるとき: transport.dispose()
```

単一ペインは `<TerminalView transport={transport} sessionId="shell-1" />`。Reactを使わない場合は `mountTerminal(element, options)`。Electron用のIPCサンプルでも同じ画面部品を使います。レンダラーのNode権限は不要です。

詳しいAPI、Electronでの配置、ライフサイクル、通信仕様は [組み込みガイド](docs/integration.md) を参照してください。

## 含まれる機能

- node-ptyによる実シェル、入力、ANSIカラー、リサイズ、終了コード
- xtermによるスクロールバック、選択・コピー・貼り付け、Unicode 11、IME、検索、URLリンク
- サーバー側のheadless xtermとスナップショットによる画面復元
- 自動再接続、出力の連番チェック、切断中のセッション保持
- タブ、左右/上下分割、検索、セッションの明示的終了
- トークン認証、Origin検証、入力・セッション数・出力待ちの上限
- 型定義と分離されたbrowser / React / server exports

## Orcaとの対応

| Orca側の仕組み | このパッケージ |
| --- | --- |
| terminal-host / Session / PTY subprocess | `TerminalHost` / `Session` + node-pty。独立Nodeプロセスで起動可能 |
| headless-emulator / snapshot | headless xterm + serialize addon、出力順序と途中ANSIの復元 |
| terminal-partial-escape-tail | 元コードをMITライセンス付きで移植 |
| pane-manager / resize lifecycle | `mountTerminal`、ResizeObserver、リソース解放 |
| output scheduler / backlog recovery | parser完了順の描画、上限超過時にスナップショット復元 |
| terminal tab / split store | React `TerminalWorkspace`、外部へレイアウト保存可能 |
| Electron IPC / runtime stream | `TerminalTransport`、WebSocket実装、Electron IPCサンプル |

これはOrcaの全機能互換フォークではありません。Git/AIエージェント管理、SSH接続管理、クラウドペアリング、独自xtermパッチ、画像表示、ディスクへの履歴永続化は含みません。サーバーが動いている間は再接続できますが、サーバー終了後にシェルプロセスが復活するものではありません。実シェルの結果はホストOSとshellの設定に従います。

## 検証

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm native:setup
pnpm test:native  # 非表示のElectronでシェル初期化・IPC・復元を検証
pnpm test:native-package  # サンプル配布ファイルを新しい環境へ展開して検証
pnpm test:package  # 実際の配布ファイルを別プロジェクトへ入れて検証
pnpm exec vite build --config examples/react/vite.config.ts
```

実PTYの入出力・終了・復元、認証拒否、接続復旧、ANSI分割、ブラウザのタブ/分割/再読み込みを検証します。ローカル実行環境はmacOS arm64です。Linux/Windowsの実機検証は未実施です。Windows/Electronではnode-ptyのビルドと対象ランタイムのABI適合が必要です。

配布パッケージには、コンパイル済みコード、型定義、CSS、起動CLI、組み込みガイドを含みます。デモやテストコード、Orca本体は不要です。ESM対応のNode.js 22以上、React UIはReact 18以上を対象にしています。

元実装の出典とライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
