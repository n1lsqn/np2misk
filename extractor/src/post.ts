import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

// 親ディレクトリにある .env ファイルをロード
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MISSKEY_HOST = process.env.MISSKEY_ENDPOINT_URL || 'https://misskey.n1l.dev';
const MISSKEY_ACCESS_TOKEN = process.env.MISSKEY_ACCESS_TOKEN || '';
const USERNAME = 'n1lsqn';

const OPEN_WEBUI_URL = process.env.OPEN_WEBUI_URL || 'http://localhost:3000';
const OPEN_WEBUI_API_KEY = process.env.OPEN_WEBUI_API_KEY || '';

// ランダム待機の設定 (最大3時間 = 180分)
const MAX_DELAY_MINUTES = 180;

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
}

interface ServerStatus {
  cpuLoad: number;
  memoryUsagePercent: number;
  diskUsagePercent: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// サーバーのシステム情報を取得する関数
function getServerStatus(): ServerStatus {
  // 1. CPU ロードアベレージ (直近1分)
  const cpuLoad = os.loadavg()[0];

  // 2. メモリ使用率
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryUsagePercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

  // 3. ディスク使用率 (df コマンドからルートマウント / を解析)
  let diskUsagePercent = 0;
  try {
    const stdout = execSync("df -h / | tail -1").toString().trim();
    // 例: "/dev/sda1        40G   12G   28G  30% /" -> 30 を抽出
    const fields = stdout.split(/\s+/);
    const usePercentField = fields.find(f => f.endsWith('%'));
    if (usePercentField) {
      diskUsagePercent = parseInt(usePercentField.replace('%', ''), 10);
    }
  } catch (err) {
    console.error('[System] Failed to fetch disk usage:', err);
  }

  return {
    cpuLoad,
    memoryUsagePercent,
    diskUsagePercent
  };
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

async function fetchAndGenerateSystemPrompt(): Promise<string> {
  console.log(`[Misskey] Fetching latest posts for @${USERNAME} to analyze style...`);
  const userId = await getUserId(USERNAME);
  const notes = await getUserNotes(userId, 100);

  const cleanNotes: string[] = [];
  for (const note of notes) {
    if (note.renoteId || note.replyId) continue;
    
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

  console.log(`[Misskey] Analyzed ${cleanNotes.length} recent clean posts.`);

  if (cleanNotes.length === 0) {
    throw new Error('No target posts found to mimic.');
  }

  const promptTemplate = `# キャラクター定義: @${USERNAME}

あなたは Misskey ユーザー「@${USERNAME}」を模倣するAIアシスタントです。
以下の発言例（実際の投稿）を注意深く分析し、その口調、文体、関心事、ユーモア、文字使い（ひらがな・漢字の比率や絵文字の使用頻度）を忠実に再現してください。

## 振る舞いと口調のルール:
1. 以下の発言例に近いトーンで回答してください。
2. 丁寧すぎず、崩れすぎず、自然な独り言や雑談のトーンを維持してください。
3. 知識をひけらかさず、適度に「適当なこと」を言うようにしてください。

## 発言例:
${cleanNotes.map(n => `- ${n}`).join('\n')}
`;

  try {
    const outputPath = path.join(__dirname, '../system_prompt.md');
    fs.writeFileSync(outputPath, promptTemplate, 'utf-8');
  } catch (err) {}

  return promptTemplate;
}

async function generateText(systemPrompt: string, status: ServerStatus): Promise<string> {
  if (!OPEN_WEBUI_API_KEY || OPEN_WEBUI_API_KEY.includes('ここにOpen WebUI')) {
    throw new Error('OPEN_WEBUI_API_KEY is not configured in .env');
  }

  const client = axios.create({
    baseURL: OPEN_WEBUI_URL,
    headers: {
      'Authorization': `Bearer ${OPEN_WEBUI_API_KEY}`,
      'Content-Type': 'application/json',
    }
  });

  const baseModel = 'hf.co/lmstudio-community/Qwen3-8B-GGUF:q3_K_L';
  console.log(`[Open WebUI] Generating response using base model "${baseModel}"...`);

  // AIに伝える現在のシステム状態プロンプト
  const systemStateMessage = `
現在のあなたのサーバーの稼働状態は以下の通りです。
- メモリ使用率: ${status.memoryUsagePercent}%
- CPU負荷 (ロードアベレージ 1分): ${status.cpuLoad.toFixed(2)}
- ストレージ(ディスク)使用率: ${status.diskUsagePercent}%

このシステム情報（メモリが足りなそう、ディスクが余裕、CPUが暇そう、または正常で平和など）に基づいて、思ったことを独り言として短く（1文で）つぶやいてください。
注意: 「メモリ使用率が〇〇%で〜」のように生の数値やパーセンテージをそのまま発言に含めず、その状態から連想される感想（例: 「メモリ食いすぎ」「サーバー暇そう」「ディスクまだ余裕あるな」など）を自然につぶやいてください。ハッシュタグや絵文字は不要です。
`;

  const response = await client.post('/api/chat/completions', {
    model: baseModel,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: systemStateMessage
      }
    ],
    temperature: 0.85,
    max_tokens: 150
  });

  const generated = response.data.choices?.[0]?.message?.content;
  if (!generated) {
    throw new Error('Failed to get content from Open WebUI response');
  }

  return generated.trim();
}

async function postToMisskey(text: string) {
  if (!MISSKEY_ACCESS_TOKEN) {
    throw new Error('MISSKEY_ACCESS_TOKEN is not configured in .env');
  }

  console.log(`[Misskey] Posting new note: "${text}"`);

  const response = await axios.post(`${MISSKEY_HOST}/api/notes/create`, {
    i: MISSKEY_ACCESS_TOKEN,
    text: text
  });

  console.log('[Misskey] Post successful! Note ID:', response.data.createdNote?.id || response.data.id);
}

async function main() {
  try {
    const runNow = process.argv.includes('--now');
    const delayMinutes = runNow ? 0 : Math.floor(Math.random() * (MAX_DELAY_MINUTES + 1));
    const delayMs = delayMinutes * 60 * 1000;

    if (delayMinutes > 0) {
      console.log(`[Scheduler] Delaying execution by ${delayMinutes} minutes (${(delayMinutes / 60).toFixed(2)} hours) to randomize post time...`);
      await sleep(delayMs);
      console.log(`[Scheduler] Delay finished. Starting execution.`);
    } else {
      console.log(`[Scheduler] Starting execution immediately.`);
    }

    // 0. サーバーの稼働状況を取得
    const serverStatus = getServerStatus();
    console.log('[System] Current Server Status:', serverStatus);

    // 1. 最新のつぶやきを取得して、キャラクター定義を動的に生成
    const systemPrompt = await fetchAndGenerateSystemPrompt();

    // 2. サーバー情報とキャラクター定義をもとに、AIにつぶやきを作らせる
    const text = await generateText(systemPrompt, serverStatus);
    console.log(`[Generator] Generated text: ${text}`);

    // 3. 生成されたつぶやきをMisskeyに投稿する
    await postToMisskey(text);
  } catch (error: any) {
    console.error('Error in post pipeline:', error.response?.data || error.message);
  }
}

main();
