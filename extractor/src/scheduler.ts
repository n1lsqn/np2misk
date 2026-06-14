import cron from 'node-cron';
import { spawn } from 'child_process';
import * as path from 'path';

console.log('[Scheduler] Start node-cron scheduler service...');

// 6時間おきに実行 (0:00, 6:00, 12:00, 18:00)
// そこから post.ts 内で最大3時間 (180分) のランダムディレイが挟まります。
cron.schedule('0 0,6,12,18 * * *', () => {
  console.log('[Scheduler] Triggering post pipeline...');
  
  const scriptPath = path.join(__dirname, 'post.ts');
  const child = spawn('npx', ['ts-node', scriptPath], {
    stdio: 'inherit' // 出力をメインプロセス（コンテナのログ）にそのまま流す
  });

  child.on('close', (code) => {
    console.log(`[Scheduler] Post pipeline finished with exit code ${code}`);
  });
});

console.log('[Scheduler] Scheduled tasks: 0,6,12,18 o\'clock daily.');
