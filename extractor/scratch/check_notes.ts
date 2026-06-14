import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MISSKEY_HOST = process.env.MISSKEY_ENDPOINT_URL || 'https://misskey.n1l.dev';
const MISSKEY_ACCESS_TOKEN = process.env.MISSKEY_ACCESS_TOKEN || '';

async function main() {
  try {
    // ボットのアカウント名 (n1lbot) のIDを検索
    const userShow = await axios.post(`${MISSKEY_HOST}/api/users/show`, {
      username: 'n1lbot',
      i: MISSKEY_ACCESS_TOKEN
    });
    const botId = userShow.data.id;
    console.log(`Bot ID: ${botId}`);

    // 直近のノートを取得
    const notes = await axios.post(`${MISSKEY_HOST}/api/users/notes`, {
      userId: botId,
      limit: 10,
      i: MISSKEY_ACCESS_TOKEN
    });

    console.log('--- Recent Notes ---');
    for (const note of notes.data) {
      console.log(`[${note.createdAt}] ID: ${note.id} | CW: ${note.cw} | Text: "${note.text.replace(/\n/g, ' ')}"`);
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

main();
