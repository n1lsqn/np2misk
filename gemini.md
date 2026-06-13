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

### 📂 構成ファイル
* [package.json](file:///home/n1lsqn/workspaces/np2misk/extractor/package.json): プロジェクト依存関係 (`axios`, `dotenv`, `ts-node`)
* [tsconfig.json](file:///home/n1lsqn/workspaces/np2misk/extractor/tsconfig.json): TypeScriptコンパイル設定
* [src/post.ts](file:///home/n1lsqn/workspaces/np2misk/extractor/src/post.ts): 取得・生成・遅延・投稿の統合スクリプト
* [.env](file:///home/n1lsqn/workspaces/np2misk/.env): 以下の環境変数を設定済み
  * `MISSKEY_ENDPOINT_URL` (Misskeyホスト)
  * `MISSKEY_ACCESS_TOKEN` (Misskey投稿用トークン)
  * `OPEN_WEBUI_URL` (Open WebUIのホスト)
  * `OPEN_WEBUI_API_KEY` (Open WebUIのAPIキー)

### 🚀 実行コマンド
* **通常実行（ランダム最大3時間遅延後に投稿）:**
  ```bash
  cd extractor && npx ts-node src/post.ts
  ```
* **即時実行（テスト用・遅延なし）:**
  ```bash
  cd extractor && npx ts-node src/post.ts --now
  ```

### ⏰ 定期実行設定 (Cron)
12時間ごとに自動で起動し、毎回0〜3時間のランダムな遅延を経てつぶやかせる設定です。
`crontab -e` で以下の設定を追加します。

```cron
0 */12 * * * cd /home/n1lsqn/workspaces/np2misk/extractor && npx ts-node src/post.ts >> /home/n1lsqn/workspaces/np2misk/extractor/cron.log 2>&1
```