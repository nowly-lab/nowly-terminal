# Electron 組み込みサンプル

`@nowly/terminal` の配布パッケージを使ったネイティブアプリです。Electronメインプロセスの `TerminalHost` と、sandbox化したReact画面をpreloadのIPCで接続します。別サーバーは不要です。

## このリポジトリで起動

ルートで `pnpm native:setup`、続いて `pnpm native`。初回はElectronのダウンロードとnode-ptyの再ビルドを行います。Node.js 22.12以上とネイティブビルド環境（macOSではXcode Command Line Tools）が必要です。サンプル内の依存はnpmで個別にインストールし、ルートのNode用node-ptyを共有しません。

## 配布されたサンプルを起動

`nowly-terminal-native-example-0.1.2.tgz` を展開し、その中の `examples/electron` で:

```sh
npm install
node node_modules/electron/install.js
npm run rebuild
npm start
```

展開したディレクトリ構成を保ってください。2階層上にある `nowly-terminal-0.1.2.tgz` が依存先です。`ELECTRON_RUN_AS_NODE` を設定している特殊な環境では、起動前に解除してください。

## 他のアプリへ組み込む場所

- `main.cjs`: メインプロセスで `TerminalHost` を生成し、ウィンドウと終了処理を所有。
- `terminal-ipc.mjs`: 送信元のウィンドウ・フレーム・URLとリクエストを検証し、呼び出し順序を維持。
- `preload.cjs`: `request` と `subscribe` だけを公開。
- `src/ipc-transport.ts`: パッケージの `TerminalTransport` を実装。
- `src/main.tsx`: パッケージの `TerminalWorkspace` とCSSを使用。

このサンプルは1ウィンドウ用です。複数ウィンドウではIPCの送信元ごとにhost / subscriptionを管理してください。PTYのshell/env/cwdはメインプロセスで設定し、レンダラーから変更させません。アプリの終了でPTYを終了し、画面再読み込みでは同じPTYを復元します。ターミナル画面はローカルコマンド実行権限を持つため、外部のWebコンテンツは読み込ませません。

## シェル初期化

通常起動ではログイン・対話シェルとして `.zprofile`、`.zshrc` などを読み込みます。普段のPATHとエイリアスが使えます。ユーザー設定内の外部ツール初期化が遅い場合は、完了までプロンプトが出ないことがあります。

`TERMINAL_CWD` で作業ディレクトリを指定でき、未指定時はホームです。`SHELL`（Windowsは`COMSPEC`）でシェルを選びます。起動引数を変える場合は `new TerminalHost({ args: [...] })`、意図的に設定を省略する場合だけ `shellProfile: 'clean'` を指定します。

`TERMINAL_EXAMPLE_BACKGROUND=1` はテスト用の非表示起動、`TERMINAL_EXAMPLE_USER_DATA` はテスト用アプリデータ分離に使います。

## 検証・配布

macOS arm64 / Electron 43.7.0で確認しています。ルートの `pnpm test:native` は非表示ウィンドウで起動し、ログイン設定・対話設定・コマンド入力・権限制限・分割・再読み込みを検証します。

これはネイティブで動作するソースサンプルです。署名済みインストーラーは作りません。アプリをパッケージ化するときはnode-ptyのネイティブバイナリとspawn-helperをASARの外へ配置し、実行権限を保持してください。対象OS/CPUごとのネイティブビルドが必要です。
