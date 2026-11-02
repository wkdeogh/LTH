import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const file = fileURLToPath(new URL('../.env.local', import.meta.url));
let text = '';
try { text = readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const env = parseEnv(text);
if (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID 키가 일부만 설정되어 있습니다. 기존 설정을 확인해 주세요.');
  console.log('기존 VAPID 키를 유지했습니다. 키 값은 출력하지 않습니다.');
} else {
  const keys = webpush.generateVAPIDKeys();
  text += `\n# Web Push; keep this key pair stable for existing device subscriptions.\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`;
  if (!env.VAPID_SUBJECT) text += 'VAPID_SUBJECT=https://localhost\n';
  writeFileSync(file, text, { mode: 0o600 }); chmodSync(file, 0o600);
  console.log('푸시 키를 .env.local에 저장했습니다. Vercel에는 두 키와 실제 앱 주소의 VAPID_SUBJECT를 등록해 주세요. 키 값은 출력하지 않습니다.');
}
