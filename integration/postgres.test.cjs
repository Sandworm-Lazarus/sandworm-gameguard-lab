'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createHarness } = require('../postgres/harness.cjs');

// Missing test DB configuration is a hard failure, never a silently skipped integration run.
const harness = createHarness();
const principal = {id:'player-a'};
const buy = (key='buy-1',overrides={}) => ({key,account:'alice',item:'potion',quantity:1,...overrides});
const total = snapshot => Object.values(snapshot.accounts).reduce((sum,n)=>sum+n,0)+snapshot.treasury;

function restartedPurchase(schema,who,command) {
  return new Promise((resolve,reject)=>{
    const child=execFile(process.execPath,[path.join(__dirname,'../postgres/retry-worker.cjs')],
      {env:process.env,timeout:20000,maxBuffer:65536,windowsHide:true},(error,stdout)=>{
        if(error){reject(new Error('RESTART_FIXTURE_FAILED'));return;}
        try{resolve(JSON.parse(stdout));}catch{reject(new Error('RESTART_RESPONSE_INVALID'));}
      });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({schema,principal:who,command}));
  });
}

test('real PostgreSQL transaction contract',{timeout:120000},async t=>{
  await harness.setup();
  t.after(async()=>{await harness.cleanup();});

  await t.test('purchase commits debit, stock, inventory, treasury and durable receipt together',async()=>{
    await harness.seed({stock:2});
    const before=await harness.snapshot();
    const result=await harness.purchase(principal,buy());
    assert.deepEqual(result,{status:'applied',reason:'CHECKS_PASSED',cost:10,quantity:1});
    const after=await harness.snapshot();
    assert.equal(after.accounts.alice,90);assert.equal(after.stock,1);assert.equal(after.inventory,1);
    assert.equal(after.treasury,10);assert.equal(after.requests,1);assert.equal(total(after),total(before));
  });

  await t.test('trusted owner is checked before a persisted receipt can be replayed',async()=>{
    await harness.seed();
    await harness.purchase(principal,buy());
    const before=await harness.snapshot();
    assert.equal((await harness.purchase({id:'player-b'},buy())).reason,'OWNERSHIP_DENIED');
    assert.deepEqual(await harness.snapshot(),before);
  });

  await t.test('twenty independent buyers cannot buy the last item more than once',async()=>{
    await harness.seed();await harness.seedConcurrentBuyers(20);
    const before=await harness.snapshot();
    const outcomes=await Promise.all(Array.from({length:20},(_,n)=>harness.purchase(
      {id:'player-'+(n+1)},buy('parallel-'+n,{account:'buyer-'+(n+1)}))));
    assert.equal(outcomes.filter(r=>r.status==='applied').length,1);
    assert.equal(outcomes.filter(r=>r.reason==='INSUFFICIENT_STOCK').length,19);
    const after=await harness.snapshot();
    assert.equal(after.stock,0);assert.equal(after.inventory,1);assert.equal(after.requests,1);
    assert.equal(after.treasury,10);assert.equal(total(after),total(before));
  });

  await t.test('concurrent copies of one idempotency key produce one durable effect',async()=>{
    await harness.seed({stock:20});
    const outcomes=await Promise.all(Array.from({length:12},()=>harness.purchase(principal,buy('same-key'))));
    assert.equal(outcomes.filter(r=>r.status==='applied').length,1);
    assert.equal(outcomes.filter(r=>r.status==='replayed').length,11);
    const after=await harness.snapshot();
    assert.equal(after.stock,19);assert.equal(after.inventory,1);assert.equal(after.accounts.alice,90);
    assert.equal(after.requests,1);assert.equal(after.treasury,10);
  });

  await t.test('two authenticated owners may use the same client key independently',async()=>{
    await harness.seed({stock:2});
    assert.equal((await harness.purchase(principal,buy('shared-key'))).status,'applied');
    assert.equal((await harness.purchase({id:'player-b'},buy('shared-key',{account:'bob'}))).status,'applied');
    const after=await harness.snapshot();
    assert.equal(after.requests,2);assert.equal(after.inventory,2);assert.equal(after.treasury,20);
  });

  await t.test('lost-response retry survives a fresh Node process and PostgreSQL connection',async()=>{
    await harness.seed({stock:3});
    await restartedPurchase(harness.schema,principal,buy('restart-key'));
    const before=await harness.snapshot();
    const retry=await restartedPurchase(harness.schema,principal,buy('restart-key'));
    assert.equal(retry.status,'replayed');
    assert.deepEqual(await harness.snapshot(),before);
  });

  await t.test('same key with changed command is denied across process restarts',async()=>{
    await harness.seed({stock:3});
    await restartedPurchase(harness.schema,principal,buy('conflict'));
    const before=await harness.snapshot();
    const conflict=await restartedPurchase(harness.schema,principal,buy('conflict',{quantity:2}));
    assert.equal(conflict.reason,'KEY_CONFLICT');assert.deepEqual(await harness.snapshot(),before);
  });

  await t.test('insufficient funds does not mutate state or reserve the failed key',async()=>{
    await harness.seed({balance:1,stock:2});
    const before=await harness.snapshot();
    assert.equal((await harness.purchase(principal,buy('failed-key'))).reason,'INSUFFICIENT_FUNDS');
    assert.deepEqual(await harness.snapshot(),before);
    assert.equal((await harness.purchase({id:'player-b'},buy('failed-key',{account:'bob'}))).status,'applied');
  });

  await t.test('SQL failure after debit rolls back stock, money, inventory and receipt on disconnect',async()=>{
    await harness.seed({stock:2});
    const before=await harness.snapshot();
    await assert.rejects(harness.abortPurchaseForTest(principal,buy('aborted')),/DATABASE_COMMAND_FAILED/);
    assert.deepEqual(await harness.snapshot(),before);
    assert.equal((await harness.purchase(principal,buy('aborted'))).status,'applied');
  });

  await t.test('inventory capacity denial is atomic',async()=>{
    await harness.seed({inventory:1000000000});
    const before=await harness.snapshot();
    assert.equal((await harness.purchase(principal,buy('capacity'))).reason,'INVENTORY_LIMIT');
    assert.deepEqual(await harness.snapshot(),before);
  });

  await t.test('unowned account and missing item do not leave partial changes',async()=>{
    await harness.seed({stock:2});
    const before=await harness.snapshot();
    assert.equal((await harness.purchase(principal,buy('wrong-owner',{account:'bob'}))).reason,'OWNERSHIP_DENIED');
    assert.equal((await harness.purchase(principal,buy('missing-item',{item:'missing'}))).reason,'ITEM_MISSING');
    assert.deepEqual(await harness.snapshot(),before);
  });
});
