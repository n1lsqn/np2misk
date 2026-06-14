import WebSocket from 'ws';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// 親ディレクトリにある .env ファイルをロード
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MISSKEY_HOST = process.env.MISSKEY_ENDPOINT_URL || 'https://misskey.n1l.dev';
const MISSKEY_ACCESS_TOKEN = process.env.MISSKEY_ACCESS_TOKEN || '';
const OPEN_WEBUI_URL = process.env.OPEN_WEBUI_URL || 'http://localhost:3000';
const OPEN_WEBUI_API_KEY = process.env.OPEN_WEBUI_API_KEY || '';

if (!MISSKEY_ACCESS_TOKEN) {
  console.error('[Error] MISSKEY_ACCESS_TOKEN is not configured.');
  process.exit(1);
}

// MisskeyのホストからWebSocket用のURLスキーマへ変換
const wsEndpoint = MISSKEY_HOST.replace(/^http/, 'ws') + '/streaming?i=' + MISSKEY_ACCESS_TOKEN;

// キャラクター設定 (system_prompt.md) を読み込む
function loadSystemPrompt(): string {
  try {
    const promptPath = path.join(__dirname, '../system_prompt.md');
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, 'utf-8');
    }
  } catch (err: any) {
    console.warn('[Warning] Failed to load system_prompt.md:', err.message);
  }
  return 'あなたはMisskeyユーザー「@n1lsqn」を模倣するAIアシスタントです。自然な独り言や雑談のトーンを維持してください。';
}

// Open WebUI で返信テキストを生成
async function generateReply(promptText: string, senderName: string, replyText: string): Promise<string> {
  if (!OPEN_WEBUI_API_KEY) {
    throw new Error('OPEN_WEBUI_API_KEY is not configured');
  }

  const client = axios.create({
    baseURL: OPEN_WEBUI_URL,
    headers: {
      'Authorization': `Bearer ${OPEN_WEBUI_API_KEY}`,
      'Content-Type': 'application/json',
    }
  });

  const baseModel = 'hf.co/lmstudio-community/Qwen3-8B-GGUF:q3_K_L';
  const systemPrompt = loadSystemPrompt();

  const userInstruction = `
ユーザー「${senderName}」から以下のリプライが届きました。
内容: "${replyText}"

必要に応じてWeb検索を行い、最新の情報や事実を確認した上で、あなたのキャラクター設定（適当かつ自然なトーン）に従って、短く（1〜2文程度で）返信してください。
注意: ハッシュタグや余計な記号、絵文字は不要です。自然な返信を厳守してください。
`;

  console.log(`[Open WebUI] Requesting reply generation to: "${replyText}"...`);

  const response = await client.post('/api/chat/completions', {
    model: baseModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInstruction }
    ],
    temperature: 0.8,
    max_tokens: 150
  });

  const generated = response.data.choices?.[0]?.message?.content;
  if (!generated) {
    console.error('[Open WebUI] Invalid response data:', JSON.stringify(response.data));
    throw new Error('Failed to get content from Open WebUI response');
  }

  return generated.trim();
}

// Misskey に返信を投稿
async function sendReply(text: string, replyId: string) {
  console.log(`[Misskey] Sending reply: "${text}" (replyId: ${replyId})`);
  await axios.post(`${MISSKEY_HOST}/api/notes/create`, {
    i: MISSKEY_ACCESS_TOKEN,
    text: text,
    replyId: replyId,
    visibility: 'public' // リプライは基本public
  });
  console.log('[Misskey] Reply posted successfully!');
}

// 自分自身の情報を取得してWebSocket接続を開始
async function startBot() {
  const processedNoteIds = new Set<string>();
  let botUsername = 'n1lbot'; // デフォルトフォールバック
  try {
    console.log('[System] Fetching bot profile...');
    const response = await axios.post(`${MISSKEY_HOST}/api/i`, { i: MISSKEY_ACCESS_TOKEN });
    if (response.data && response.data.username) {
      botUsername = response.data.username;
      console.log(`[System] Logged in as @${botUsername} (${response.data.name})`);
    }
  } catch (err: any) {
    console.warn('[Warning] Failed to fetch bot profile, using default fallback username:', err.message);
  }

  function connectStreaming() {
    console.log(`[WebSocket] Connecting to ${wsEndpoint.split('?')[0]}...`);
    const ws = new WebSocket(wsEndpoint);

    const channelId = `reply-bot-${Math.random().toString(36).substring(2, 9)}`;

    ws.on('open', () => {
      console.log('[WebSocket] Connection established.');

      // main チャンネルに接続して通知を購読
      ws.send(JSON.stringify({
        type: 'connect',
        body: {
          channel: 'main',
          id: channelId
        }
      }));
      console.log('[WebSocket] Subscribed to "main" channel.');
    });

    ws.on('message', async (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // main チャンネルからのイベントをフィルタ
        if (msg.type === 'channel' && msg.body?.id === channelId) {
          const eventType = msg.body.type;
          const note = msg.body.body;

          // メンションまたはリプライイベント
          if ((eventType === 'mention' || eventType === 'reply') && note) {
            const sender = note.user;
            const noteText = note.text || '';

            // 重複排除チェック (同一ノートIDに対する複数イベントを無視)
            if (processedNoteIds.has(note.id)) {
              return;
            }
            processedNoteIds.add(note.id);
            // 5分後にキャッシュから削除
            setTimeout(() => processedNoteIds.delete(note.id), 5 * 60 * 1000);

            console.log(`[Event] Received ${eventType} from @${sender.username} (${sender.name}): "${noteText}"`);

            // 自分自身（ボット自身）の投稿は無視
            if (sender.username === botUsername) {
              console.log('[Info] Skipped (sender is self)');
              return;
            }

            if (!noteText.trim()) {
              console.log('[Info] Skipped (empty text)');
              return;
            }

            try {
              // 返信を生成
              const replyContent = await generateReply(loadSystemPrompt(), sender.name || sender.username, noteText);
              console.log(`[Generator] Generated reply: "${replyContent}"`);

              // 返信を投稿
              await sendReply(replyContent, note.id);
            } catch (replyErr: any) {
              console.error('[Error] Failed to process reply:', replyErr.message);
            }
          }
        }
      } catch (err: any) {
        console.error('[Error] Message parse error:', err.message);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[WebSocket] Connection closed (code: ${code}, reason: ${reason}). Reconnecting in 5 seconds...`);
      setTimeout(connectStreaming, 5000);
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] Error occurred:', err.message);
      ws.close();
    });
  }

  connectStreaming();
}

startBot();
