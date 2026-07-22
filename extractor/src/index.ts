import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 親ディレクトリにある .env ファイルをロード
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MISSKEY_HOST = process.env.MISSKEY_ENDPOINT_URL || 'https://misskey.n1l.dev';
const MISSKEY_ACCESS_TOKEN = process.env.MISSKEY_ACCESS_TOKEN || '';
const USERNAME = 'n1lsqn';

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
    .replace(/https?:\/\/\S+/g, '') // URL削除
    .replace(/#\S+/g, '') // ハッシュタグ削除
    .trim();
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
4. ハッシュタグ（例: #VRChat）を使用する場合は、タグの直後に必ず半角スペース（または改行）を挟み、後ろの文章がハッシュタグに巻き込まれないようにしてください。

## 発言例:
${cleanNotes.map(n => `- ${n}`).join('\n')}
`;

    const outputPath = path.join(__dirname, '../system_prompt.md');
    fs.writeFileSync(outputPath, promptTemplate, 'utf-8');
    console.log(`System prompt generated successfully at: ${outputPath}`);



  } catch (error) {
    console.error('Error occurred:', error);
  }
}

main();
