import test from 'node:test';
import assert from 'node:assert/strict';
import { sameRequestOrigin } from './origin';
test('호스트 정규화가 있어도 실제 브라우저 Origin과 Host가 같아야 한다', () => {
  assert.equal(sameRequestOrigin(new Request('http://localhost:3000/api/broker', { headers: {
    host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000',
  } })), true);
  assert.equal(sameRequestOrigin(new Request('http://localhost:3000/api/broker', { headers: {
    host: 'app.example', origin: 'https://app.example', 'x-forwarded-proto': 'https',
  } })), true);
  for (const origin of ['https://evil.example','http://evil.example@app.example','null','https://app.example/']) {
    assert.equal(sameRequestOrigin(new Request('https://app.example/api/broker', { headers: { host: 'app.example', origin } })), false);
  }
});
