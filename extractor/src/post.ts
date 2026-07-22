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
const OPEN_WEBUI_MODEL = process.env.OPEN_WEBUI_MODEL || 'hf.co/lmstudio-community/Qwen3-8B-GGUF:q3_K_L';

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
  visibility?: string;
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

async function getUserNotes(userId: string, limit = 100, untilId?: string): Promise<MisskeyNote[]> {
  const payload: any = {
    userId,
    limit: Math.min(limit, 100), // APIの制限で最大100
    includeMyRenotes: false,
    includeReplies: false,
  };
  if (untilId) {
    payload.untilId = untilId;
  }
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

async function fetchAndGenerateSystemPrompt(): Promise<string> {
  console.log(`[Misskey] Fetching latest posts for @${USERNAME} to analyze style...`);
  const userId = await getUserId(USERNAME);
  
  // 1回目：最新の100件を取得
  let notes = await getUserNotes(userId, 100);
  console.log(`[Misskey] Fetched first ${notes.length} notes.`);
  
  // 100件取得できていれば、最後のIDを基準にして次の100件（計200件）を取得
  if (notes.length === 100) {
    const lastNoteId = notes[notes.length - 1].id;
    try {
      console.log(`[Misskey] Fetching next page (until: ${lastNoteId})...`);
      const nextPageNotes = await getUserNotes(userId, 100, lastNoteId);
      console.log(`[Misskey] Fetched next ${nextPageNotes.length} notes.`);
      notes = notes.concat(nextPageNotes);
    } catch (pageError: any) {
      console.warn('[Misskey] Failed to fetch second page of notes:', pageError.message);
    }
  }
  
  console.log(`[Misskey] Total notes fetched for analysis: ${notes.length}`);

  const cleanNotes: string[] = [];
  for (const note of notes) {
    if (note.renoteId || note.replyId) continue;
    
    // public もしくは home 以外のノート（フォロワー限定など）を除外
    if (note.visibility && note.visibility !== 'public' && note.visibility !== 'home') {
      continue;
    }
    
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

  const promptPath = path.join(__dirname, '../system_prompt.md');
  let basePrompt = '';

  try {
    if (fs.existsSync(promptPath)) {
      const existing = fs.readFileSync(promptPath, 'utf-8');
      const markerIndex = existing.indexOf('<!-- EXAMPLES_START -->');
      if (markerIndex !== -1) {
        // マーカーの直前までをベースとして残す
        basePrompt = existing.substring(0, markerIndex + '<!-- EXAMPLES_START -->'.length);
      }
    }
  } catch (err: any) {
    console.warn('[System] Failed to read existing system_prompt.md headers, using fallback:', err.message);
  }

  // 万が一ファイルやマーカーがなかった場合のフォールバック定義
  if (!basePrompt) {
    basePrompt = `# キャラクター定義: @${USERNAME}

あなたは Misskey ユーザー「@${USERNAME}」を模倣するAIアシスタントです。
以下の発言例（実際の投稿）を注意深く分析し、その口調、文体、関心事、ユーモア、文字使い（ひらがな・漢字の比率や絵文字の使用頻度）を忠実に再現してください。

## 振る舞いと口調のルール:
1. 以下の発言例に近いトーンで回答してください。
2. 丁寧すぎず、崩れすぎず、自然な独り言や雑談のトーンを維持してください。
3. 知識をひけらかさず、適度に「適当なこと」を言うようにしてください。
4. ハッシュタグ（例: #VRChat）を使用する場合は、タグの直後に必ず半角スペース（または改行）を挟み、後ろの文章がハッシュタグに巻き込まれないようにしてください。

⚠️最重要ルール：
- 「発言例」に提示されている文章そのものをそのまま出力（コピー）することは絶対に禁止します。
- 発言例はあくまで「口調」や「文体」の参考にするためのものであり、つぶやく内容は自分自身で新しく創作してください。

## 投稿パターンとアプローチの選択:
サーバー状態の報告を受けたら、以下のいずれかのアプローチを選択し、独り言としてつぶやいてください。

- 【最優先】パターンB (日常の短文雑談) - 80%の確率で選択:
  サーバーの状態は完全に無視して、発言例のトーンに合わせた日常の出来事、ゲーム（VRChatやTarkov、その他の話題）、体調、食べたいものなどについて、短い1文で「あなた自身の新しいつぶやき」を行ってください。発言例のコピペは禁止します。

- 【ときたま】パターンC (日常の長文雑談) - 10%の確率で選択:
  サーバーの状態は無視して、日常のちょっとしたエピソードやゲームの回想、雑談（3〜4文程度、最大100文字程度）を語ってください。語り口は発言例を参考にしつつ、内容は新しく創作してください。

- 【ごく稀に】パターンA (システムリアクション) - 10%の確率で選択:
  サーバーの稼働状態（メモリ不足、ディスク空き僅か、CPU負荷、平和であることなど）に着目し、その感想を短い1文で自然につぶやいてください（数値やパーセンテージそのものは発言に含めず、ニュアンスで伝えてください）。

注意: ハッシュタグや「」などの余計な記号、絵文字は不要です。自然な独り言のトーンを厳守してください。

## 発言例:
<!-- EXAMPLES_START -->`;
  }

  const promptTemplate = `${basePrompt}\n${cleanNotes.map(n => `- ${n}`).join('\n')}\n<!-- EXAMPLES_END -->\n`;

  try {
    fs.writeFileSync(promptPath, promptTemplate, 'utf-8');
    console.log(`[System] system_prompt.md updated successfully at: ${promptPath}`);
  } catch (err: any) {
    console.error('[System] Failed to write system_prompt.md:', err.message);
  }

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

  // プログラム（TypeScript）側で確率に基づいてアプローチパターンを決定する
  const rand = Math.random() * 100;
  let chosenPattern = 'B';
  if (rand < 80) {
    chosenPattern = 'B';
  } else if (rand < 90) {
    chosenPattern = 'C';
  } else {
    chosenPattern = 'A';
  }

  console.log(`[Generator] Selected pattern: ${chosenPattern} (rand: ${rand.toFixed(1)})`);

  let systemStateMessage = '';
  if (chosenPattern === 'B') {
    systemStateMessage = `
日常の出来事、ゲーム（VRChatやTarkov、その他の話題）、体調、食べたいものなどについて、短い1文で「あなた自身の新しいつぶやき」を行ってください。
注意：発言例の文章をそのままコピー（コピペ）することは絶対に禁止します。発言例のトーン（口調や文字使い）だけを参考にして、新しい内容を1文でつぶやいてください。
`;
  } else if (chosenPattern === 'C') {
    systemStateMessage = `
日常のちょっとした出来事やゲームの回想、雑談などを、少し長め（3〜4文程度、最大100文字程度）に語ってください。
注意：発言例の文章をそのままコピーすることは絶対に禁止します。発言例のトーンを参考に、新しい内容を創作して語ってください。
`;
  } else {
    systemStateMessage = `
現在のあなたのサーバーの稼働状態は以下の通りです。
- メモリ使用率: ${status.memoryUsagePercent}%
- CPU負荷 (ロードアベレージ 1分): ${status.cpuLoad.toFixed(2)}
- ストレージ(ディスク)使用率: ${status.diskUsagePercent}%

上記の稼働状態（メモリ不足、ディスク空き僅か、CPU負荷、または平和であることなど）に着目し、その感想を短い1文で自然につぶやいてください。
注意：数値やパーセンテージそのものは発言に含めず、ニュアンスで伝えてください。発言例のトーンを厳守してください。
`;
  }

  console.log(`[Open WebUI] Generating response using model "${OPEN_WEBUI_MODEL}"...`);

  const response = await client.post('/api/chat/completions', {
    model: OPEN_WEBUI_MODEL,
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

async function getRecentBotNotes(): Promise<string[]> {
  if (!MISSKEY_ACCESS_TOKEN) return [];
  try {
    // 自分のIDを取得
    const iRes = await axios.post(`${MISSKEY_HOST}/api/i`, { i: MISSKEY_ACCESS_TOKEN });
    const myId = iRes.data.id;
    
    // 直近のノートを取得
    const notesRes = await axios.post(`${MISSKEY_HOST}/api/users/notes`, {
      userId: myId,
      limit: 15,
      i: MISSKEY_ACCESS_TOKEN
    });
    
    return notesRes.data
      .map((n: any) => (n.text || '').trim())
      .filter((t: string) => t.length > 0);
  } catch (err: any) {
    console.warn('[Warning] Failed to fetch recent bot notes for duplicate check:', err.message);
    return [];
  }
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

    // 2. ボット自身の直近の投稿履歴を取得
    console.log('[Misskey] Fetching recent bot posts to avoid duplicates...');
    const recentNotes = await getRecentBotNotes();

    // 3. サーバー情報とキャラクター定義をもとに、AIにつぶやきを作らせる (重複があれば最大3回再試行)
    let text = '';
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      text = await generateText(systemPrompt, serverStatus);
      if (!recentNotes.includes(text)) {
        break; // 重複がなければOK
      }
      console.warn(`[Generator] Duplicate text detected: "${text}" (attempt ${attempt}/${maxAttempts}). Retrying generation...`);
    }

    console.log(`[Generator] Final generated text: ${text}`);

    // 4. 生成されたつぶやきをMisskeyに投稿する
    await postToMisskey(text);
  } catch (error: any) {
    console.error('Error in post pipeline:', error.response?.data || error.message);
  }
}

main();
