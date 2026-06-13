import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 親ディレクトリにある .env ファイルをロード
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MISSKEY_HOST = process.env.MISSKEY_ENDPOINT_URL || 'https://misskey.n1l.dev';
const MISSKEY_ACCESS_TOKEN = process.env.MISSKEY_ACCESS_TOKEN || '';
const USERNAME = 'n1lsqn';

const OPEN_WEBUI_URL = process.env.OPEN_WEBUI_URL || 'http://localhost:3000';
const OPEN_WEBUI_API_KEY = process.env.OPEN_WEBUI_API_KEY || '';

interface MisskeyUser {
  id: string;
  username: string;
  name: string;
}

interface MisskeyNote {
  id: string;
  createdAt: string;
  text: string | null;
  cw: string | null;
  user: MisskeyUser;
  replyId: string | null;
  renoteId: string | null;
  isHidden?: boolean;
}

async function getUserId(username: string): Promise<string> {
  const payload: any = { username };
  if (MISSKEY_ACCESS_TOKEN) {
    payload.i = MISSKEY_ACCESS_TOKEN;
  }
  const response = await axios.post(`${MISSKEY_HOST}/api/users/show`, payload);
  return response.data.id;
}

async function getUserNotes(userId: string, limit = 100): Promise<MisskeyNote[]> {
  const payload: any = {
    userId,
    limit,
    includeMyRenotes: false,
    includeReplies: false,
  };
  if (MISSKEY_ACCESS_TOKEN) {
    payload.i = MISSKEY_ACCESS_TOKEN;
  }
  const response = await axios.post(`${MISSKEY_HOST}/api/users/notes`, payload);
  return response.data;
}

function cleanText(text: string): string {
  return text
    .replace(/https?:\/\/[\s\S]+?\b/g, '') // URL削除
    .replace(/#\S+/g, '') // ハッシュタグ削除
    .trim();
}

async function registerToOpenWebUI(systemPrompt: string) {
  if (!OPEN_WEBUI_API_KEY || OPEN_WEBUI_API_KEY.includes('ここにOpen WebUIで取得した')) {
    console.log('\n[Open WebUI] OPEN_WEBUI_API_KEY is not set. Skipping auto-registration.');
    return;
  }

  const client = axios.create({
    baseURL: OPEN_WEBUI_URL,
    headers: {
      'Authorization': `Bearer ${OPEN_WEBUI_API_KEY}`,
      'Content-Type': 'application/json',
    }
  });

  const modelId = `n1lsqn-bot-v4`;
  const modelName = `@n1lsqn (Misskey)`;
  const payload = {
    id: modelId,
    name: modelName,
    base_model_id: 'qwen3.5-4b:latest',
    meta: {
      description: `Misskey の @${USERNAME} の投稿から自動生成されたシミュレータボット`,
      system: systemPrompt,
    },
    params: {
      system: systemPrompt
    }
  };

  try {
    console.log(`\n[Open WebUI] Connecting to ${OPEN_WEBUI_URL}...`);
    
    // 常に削除を試みる (ID重複によるエラーを防ぐため)
    console.log(`[Open WebUI] Cleaning up existing model "${modelId}" if any...`);
    const deletePaths = [`/api/models/delete`, `/api/v1/models/delete`, `/api/models/${modelId}`, `/api/v1/models/${modelId}`];
    for (const dp of deletePaths) {
      try {
        if (dp.endsWith('/delete')) {
          await client.delete(dp, { data: { id: modelId } });
        } else {
          await client.delete(dp);
        }
        console.log(`[Open WebUI] Delete succeeded on ${dp}`);
      } catch (delErr: any) {
        // 存在しない、または権限エラーなどの場合は無視して進む
      }
    }

    // 新規作成
    const createPaths = ['/api/models/create', '/api/v1/models/create', '/api/models', '/api/v1/models'];
    let created = false;
    for (const cp of createPaths) {
      try {
        console.log(`[Open WebUI] Attempting creation via POST ${cp}...`);
        await client.post(cp, payload);
        console.log(`[Open WebUI] Model created successfully via ${cp}!`);
        created = true;
        break;
      } catch (createError: any) {
        console.log(`[Open WebUI] Creation failed on ${cp}:`, createError.response?.data || createError.message);
      }
    }

    if (!created) {
      throw new Error('All model creation paths failed.');
    }

  } catch (error: any) {
    console.error('[Open WebUI] Failed to register model:', error.message);
  }
}

async function main() {
  try {
    console.log(`Using Misskey Host: ${MISSKEY_HOST}`);
    if (!MISSKEY_ACCESS_TOKEN) {
      console.warn('WARNING: MISSKEY_ACCESS_TOKEN is not set in .env. Hidden notes might not be accessible.');
    }

    console.log(`Searching user ID for @${USERNAME}...`);
    const userId = await getUserId(USERNAME);
    console.log(`Found User ID: ${userId}`);

    console.log(`Fetching notes...`);
    const notes = await getUserNotes(userId, 100);
    console.log(`Fetched ${notes.length} notes.`);

    // フィルタリングとクレンジング
    const cleanNotes: string[] = [];
    for (const note of notes) {
      if (note.renoteId) continue;
      if (note.replyId) continue;
      
      const rawText = note.text;
      if (!rawText) continue;

      if (rawText.toLowerCase().includes('now playing') || rawText.includes('#nowplaying') || rawText.includes('🎵')) {
        continue;
      }

      const cleaned = cleanText(rawText);
      if (cleaned.length > 3 && !cleanNotes.includes(cleaned)) {
        cleanNotes.push(cleaned);
      }
    }

    console.log(`Filtered down to ${cleanNotes.length} clean posts.`);

    if (cleanNotes.length === 0) {
      console.error('No notes found.');
      return;
    }

    // Open WebUI用のプロンプトを作成
    const promptTemplate = `# キャラクター定義: @${USERNAME}

あなたは Misskey ユーザー「@${USERNAME}」を模倣するAIアシスタントです。
以下の発言例（実際の投稿）を注意べく分析し、その口調、文体、関心事、ユーモア、文字使い（ひらがな・漢字の比率や絵文字の使用頻度）を忠実に再現してください。

## 振る舞いと口調のルール:
1. 以下の発言例に近いトーンで回答してください。
2. 丁寧すぎず、崩れすぎず、自然な独り言や雑談のトーンを維持してください。
3. 知識をひけらかさず、適度に「適当なこと」を言うようにしてください。

## 発言例:
${cleanNotes.map(n => `- ${n}`).join('\n')}
`;

    const outputPath = path.join(__dirname, '../system_prompt.md');
    fs.writeFileSync(outputPath, promptTemplate, 'utf-8');
    console.log(`System prompt generated successfully at: ${outputPath}`);

    // Open WebUI へのモデル登録を実行
    await registerToOpenWebUI(promptTemplate);

  } catch (error) {
    console.error('Error occurred:', error);
  }
}

main();
