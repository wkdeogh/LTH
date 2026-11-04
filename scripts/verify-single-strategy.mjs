import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const id = '621f66d2-de56-4dba-a8ff-1583bf491141';
const mockPort = 4319, appPort = 4320, origin = 'http://127.0.0.1:' + appPort;
const strategy = { id, name: 'SOXL 20분할', symbol: 'SOXL', split_count: 20, principal: 10000, cash_balance: 5000,
  position_qty: 100, avg_price: 50, t_value: 10, mode: 'normal', reverse_started_at: null, reverse_first_sell_done: false,
  compounding_type: 'compound', is_archived: false, version: 1, started_at: '2026-11-02', created_at: '2026-11-02T01:00:00Z', updated_at: '2026-11-02T01:00:00Z' };
const candles = ['2026-11-02','2026-11-03'].map(trade_date => ({ symbol:'SOXL',trade_date,open_price:50,high_price:60,low_price:49,close_price:55,adjusted_close:55,volume:1000 }));
const reads = [], rejectedWrites = [];
const mock = createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method)) {
    rejectedWrites.push(req.method + ' ' + req.url); res.writeHead(405); res.end(); return;
  }
  const url = new URL(req.url,'http://127.0.0.1:' + mockPort), table = url.pathname.split('/').at(-1);
  reads.push(table);
  let rows = table === 'strategies' ? [strategy] : table === 'market_candles' ? candles : [];
  if (table === 'strategies' && url.searchParams.get('id') !== 'eq.' + id) rows = [];
  const single = String(req.headers.accept).includes('application/vnd.pgrst.object+json');
  res.setHeader('content-type','application/json');
  res.setHeader('content-range','0-' + Math.max(rows.length-1,0) + '/' + rows.length);
  res.setHeader('access-control-allow-origin','*');
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(single ? rows[0] ?? null : rows));
});
await new Promise(resolve => mock.listen(mockPort,'127.0.0.1',resolve));
let logs = '';
const app = spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(appPort)], {
  env: {...process.env, SUPABASE_URL:'http://127.0.0.1:' + mockPort, SUPABASE_SERVICE_ROLE_KEY:'fixture-only',
    APP_PASSWORD:'', MERITZ_APP_KEY:'', MERITZ_APP_SECRET:'', VAPID_PUBLIC_KEY:'', VAPID_PRIVATE_KEY:''},
  stdio:['ignore','pipe','pipe'],
});
app.stdout.on('data',d=>{logs+=d}); app.stderr.on('data',d=>{logs+=d});
let browser;
try {
  for(let i=0;i<100;i++){
    try { if((await fetch(origin)).ok)break; }catch{}
    if(app.exitCode!==null)throw Error(logs);
    await new Promise(resolve=>setTimeout(resolve,150));
    if(i===99)throw Error('App startup timeout: '+logs);
  }
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  await mkdir('.codex/single-strategy-verification',{recursive:true});
  const results=[];
  for(const width of [390,320,1280]){
    const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      if(!['GET','HEAD'].includes(route.request().method()))return route.abort();
      return route.continue();
    });
    for(const path of ['/', '/strategies/'+id, '/strategies/'+id+'/plan', '/strategies/'+id+'/rounds?view=rounds', '/guide']){
      await page.goto(origin+path,{waitUntil:'networkidle'});
      await page.waitForTimeout(450);
      assert.equal(await page.getByText('새 전략 추가',{exact:true}).count(),0);
      assert.equal(await page.getByText('메인으로 설정',{exact:true}).count(),0);
      assert.equal(await page.getByText('전략 삭제',{exact:true}).count(),0);
      assert.equal(await page.locator('select[name="symbol"],select[name="split_count"]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,path+' overflow '+width);
      if(path==='/')assert.equal(await page.locator('.strategy-card').count(),1);
      if(path==='/strategies/'+id){
        const correction=page.locator('details').filter({has:page.getByText('현재 상태 보정',{exact:false})});
        // Inspect every disclosure, including the state correction fields.
        await page.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true}));
        assert.equal(await page.locator('select[name="symbol"],select[name="split_count"]').count(),0);
      }
      if(width===390 || path==='/')await page.screenshot({path:'.codex/single-strategy-verification/'+width+'-'+(path==='/'?'home':path==='/guide'?'guide':path.endsWith('/plan')?'plan':path.includes('rounds')?'rounds':'detail')+'.png',fullPage:true});
    }
    assert.deepEqual(errors,[]);
    await page.goto(origin+'/strategies/new',{waitUntil:'networkidle'});
    assert.equal(page.url(),origin+'/');
    await page.goto(origin+'/strategies/969974e0-e549-4eb0-84ad-d6b023d677aa',{waitUntil:'networkidle'});
    assert.equal(page.url(),origin+'/');
    await page.goto(origin+'/rounds',{waitUntil:'networkidle'});
    assert.match(page.url(),new RegExp(id+'/rounds'));
    results.push({width,oneStrategy:true,creationRedirect:true,archivedRedirect:true,overflow:false});
    await page.close();
  }
  assert.deepEqual(rejectedWrites,[]);
  assert.ok(reads.includes('strategies')&&reads.includes('market_candles'));
  await writeFile('.codex/single-strategy-verification/results.json',JSON.stringify({results,liveRequests:false,dbWrites:rejectedWrites},null,2));
  console.log(JSON.stringify({results,dbWrites:rejectedWrites}));
} finally {
  await browser?.close();
  app.kill('SIGTERM');
  if(app.exitCode===null)await once(app,'exit');
  await new Promise(resolve=>mock.close(resolve));
}
