# GEMINI.md (AI Agent Universal Project Guidelines)

このドキュメントは、あらゆるWebアプリケーション開発プロジェクトにおいて、AIコーディングアシスタント（エージェント）および開発者が共通して順守すべき、高品質な実装・デザイン・設計・セキュリティ・ワークフローの「標準規定テンプレート」です。

新プロジェクト開始時やリファクタリング時にこのファイルを配置することで、AIエージェントが最初から最高品質のコードを一貫した規律を持って出力できるようにします。

---

## 🧭 1. 共通基本指針 (Universal Overview)
AIコーディングエージェントは、ただ言われた動作をするだけの「最低限のコード」を書くのではなく、ユーザーがひと目見て感動するような高級感、高い堅牢性、優れたUXを誇るプロダクトを常に自律的かつ能動的に作成します。
- **完璧主義:** プレースホルダーの放置や、未実装の「todo」コメントを残したままコミットすることは厳禁です。
- **自己完結と検証:** コードの変更後は必ずビルド、リンター、検証コマンドを実行し、エラーを自己修復してからユーザーに完了を報告します。

--- 

## ⚖️ 2. 共通AIエージェント動作規約 (Agent Conventions & Hygiene)
AIエージェントが作業を終了し、タスクをクローズする際の鉄則です。
- **日本語での対話:** ユーザーへの説明、考察、トラブルシューティング解説はすべて日本語（Japanese）で行います。
- **GEMINI.md (プロジェクト固有ガイドライン) の更新義務:** 
  - 作業の中で解決した「新たなトラブルシューティング」や「機能ごとの実装標準」が発生した場合は、作業の最後に必ずその内容を対象プロジェクトの `GEMINI.md` に追記・更新します。
- **Git Commit の自動実行:**
  - `GEMINI.md` の更新を含め、今回行ったすべてのファイル変更について、エージェント自身で自動的に `git add .` を行い、変更内容を的確に表したコミットメッセージで `git commit` を実行した上でタスク完了とします。

---

## 🛠️ 3. 新規追加機能: Misskey発言学習＆自動つぶやきシステム (Misskey Extractor & Auto-Poster)

### 📌 概要
Misskey上の `@n1lsqn` の過去ノートを自動取得してクレンジングし、Open WebUIのAPI（Qwen 8B）を利用して「にるさんらしい発言」を自動生成し、Misskeyに自動投稿するスクリプトです。
URLやハッシュタグをパースして綺麗に消去し、ハッシュタグをつける場合は後に半角スペースを空けるようにAIに指示します。

### 📂 構成ファイル
* [package.json](file:///home/n1lsqn/workspaces/np2misk/extractor/package.json): プロジェクト依存関係 (`axios`, `dotenv`, `ts-node`, `ws`, `node-cron`)
* [tsconfig.json](file:///home/n1lsqn/workspaces/np2misk/extractor/tsconfig.json): TypeScriptコンパイル設定
* [src/post.ts](file:///home/n1lsqn/workspaces/np2misk/extractor/src/post.ts): 取得・生成・遅延・投稿の統合スクリプト
* [src/index.ts](file:///home/n1lsqn/workspaces/np2misk/extractor/src/index.ts): スタイル分析 & Open WebUIモデル登録スクリプト
* [.env](file:///home/n1lsqn/workspaces/np2misk/.env): 環境変数設定

---

## 🤖 4. 追加機能: リアルタイム自動返信システム (Misskey Reply Bot)

### 📌 概要
Misskey のストリーミング API (WebSocket) でボットアカウントへのリプライやメンションを常時監視し、届いたメッセージに対して Open WebUI の LLM で適当な返信を生成し、即座に自動で返信する機能です。同一のノートIDに対するイベント重複を検知・排除する仕組みが組み込まれています。

### 📂 構成ファイル
* [src/reply.ts](file:///home/n1lsqn/workspaces/np2misk/extractor/src/reply.ts): WebSocket監視と自動返信の統合スクリプト

---

## 🐋 5. 動作環境と管理方法 (Docker Compose 一元管理)

ホスト側のシステムを汚さず、すべてのボットサービスをコンテナ内で自動起動・一元管理します。

### 📂 構成ファイル
* [docker-compose.yml](file:///home/n1lsqn/workspaces/np2misk/docker-compose.yml): 3つのサービスを一括定義
* [Dockerfile](file:///home/n1lsqn/workspaces/np2misk/Dockerfile): Spotify NP投稿サービス用 (Go)
* [extractor/Dockerfile](file:///home/n1lsqn/workspaces/np2misk/extractor/Dockerfile): 返信ボット & 定期実行スケジューラ用 (Node.js)
* [src/scheduler.ts](file:///home/n1lsqn/workspaces/np2misk/extractor/src/scheduler.ts): コンテナ内で定期投稿スケジュール（毎日 0,6,12,18時）を管理する `node-cron` スクリプト

### 📋 コンテナサービス一覧
1. **`spotify-np`** (Go): Spotify 楽曲監視 & 投稿
2. **`reply-bot`** (TS): WebSocket によるリアルタイム自動返信
3. **`cron-bot`** (TS): `node-cron` による 6時間ごとのつぶやき投稿

### 🚀 実行手順
```bash
# コンテナのビルドとバックグラウンド起動
docker compose up -d --build

# コンテナの状態確認
docker compose ps

# ログの確認
docker compose logs -f
```

> [!IMPORTANT]
> **ホスト側の競合解除の注意点:**
> * ホスト側で `systemd` による `np2misk.service` が有効になっている場合は、ポート3000の競合を避けるために `sudo systemctl stop np2misk` & `sudo systemctl disable np2misk` で停止・無効化してください。
> * 定期実行はコンテナ内の `cron-bot` が担当するため、ホスト側の `crontab` に登録されていた `post.ts` の項目は削除してください。

---

## 🔑 6. Spotify 連携と認証トークンの取得 (Spotify Auth & Refresh Token)

Spotifyの現在再生中の楽曲を取得して投稿する機能（`spotify-np`）の動作には、Spotify APIの**リフレッシュトークン（Refresh Token）**が必要です。

以下の手順で、リフレッシュトークンを取得して `.env` に設定できます。

### 📋 事前準備（依存関係のインストール）
スクリプト [get-refleshtoken.py](file:///home/n1lsqn/workspaces/np2misk/get-refleshtoken.py) を動かすために必要な `requests` と `flask` パッケージをインストールします。システム環境が制限されている（PEP 668）場合は、`--break-system-packages` を指定してユーザー環境にインストールします。

```bash
# pipの導入（未導入の場合）
curl -sS https://bootstrap.pypa.io/get-pip.py | python3 - --user --break-system-packages

# 依存パッケージのインストール
python3 -m pip install --user --break-system-packages requests flask
```

### 🚀 取得手順

1. **スクリプトの実行:**
   ```bash
   python3 get-refleshtoken.py
   ```
   *(※ すでにポート 5000 で起動している場合は、新しく起動し直す必要はありません。)*

2. **リモート接続時のポートフォワーディング（手元のPCからアクセスする場合）:**
   サーバーがリモート環境にある場合は、手元のPCのターミナルで以下のポートフォワーディングコマンドを実行します。
   ```bash
   ssh -L 5000:[::1]:5000 n1lsqn@192.168.1.7
   ```

3. **ブラウザでのアクセスと連携:**
   手元のPCのブラウザから **[http://localhost:5000/login](http://localhost:5000/login)** にアクセスし、Spotifyにログインして認証（連携）します。

4. **トークンの取得:**
   連携完了後、ブラウザ画面に以下のようにリフレッシュトークンが表示されます。
   ```text
   Refresh Token: <取得されたトークン>
   ```

5. **環境変数への適用:**
   取得したトークンを、プロジェクトルートの `.env` ファイルに設定します。
   ```env
   SPOTIFY_REFRESH_TOKEN=取得したトークン
   ```