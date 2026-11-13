'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { config, schemaName, commandSQL, createHarness } = require('../postgres/harness.cjs');
const env = {
  GAMEGUARD_ALLOW_DISPOSABLE_DATABASE:'1',
  GAMEGUARD_TEST_DATABASE_URL:'postgresql://fixture@127.0.0.1/gameguard_test_unit?sslmode=disable'
};
const principal = {id:'player-a'};
const command = {key:'buy-1',account:'alice',item:'potion',quantity:1};

test('PostgreSQL configuration requires deliberate disposable database opt in',()=>{
  assert.throws(()=>config({}),/OPT_IN_REQUIRED/);
  assert.throws(()=>config({...env,GAMEGUARD_ALLOW_DISPOSABLE_DATABASE:'yes'}),/OPT_IN_REQUIRED/);
});
test('database guard rejects ordinary databases, query injection, remote options and malformed URLs without echoing input',()=>{
  for (const url of [
    'postgresql://fixture@127.0.0.1/production',
    'postgresql://fixture@127.0.0.1/gameguard_test_ok/other',
    'postgresql://fixture@127.0.0.1/gameguard_test_ok?options=-csearch_path=public',
    'postgresql://fixture@127.0.0.1/gameguard_test_ok?sslmode=disable&sslmode=require',
    'postgresql://fixture@127.0.0.1/gameguard_test_ok#fragment',
    'not-a-url-with-private-data'
  ]) {
    assert.throws(()=>config({...env,GAMEGUARD_TEST_DATABASE_URL:url}),
      error=>error.message==='INVALID_TEST_DATABASE'&&!error.message.includes(url));
  }
});
test('credentials remain in child environment and inherited PG overrides are excluded',()=>{
  const settings=config({...env,PGSERVICE:'attacker',PGOPTIONS:'-csearch_path=public'});
  assert.equal(settings.database,'gameguard_test_unit');
  assert.equal(settings.env.PGDATABASE,'gameguard_test_unit');
  assert.equal(settings.env.PGSERVICE,undefined);
  assert.equal(settings.env.PGOPTIONS,undefined);
  assert.equal(settings.env.PGPASSWORD,'');
});
test('IPv6 URL brackets are removed for libpq PGHOST without changing IPv4 hosts',()=>{
  const ipv6=config({...env,GAMEGUARD_TEST_DATABASE_URL:'postgresql://fixture@[::1]/gameguard_test_unit?sslmode=disable'});
  assert.equal(ipv6.env.PGHOST,'::1');
  assert.equal(config(env).env.PGHOST,'127.0.0.1');
});
test('schema cleanup identifiers are restricted to generated harness names',()=>{
  assert.equal(schemaName('gameguard_harness_0123456789abcdef'),'gameguard_harness_0123456789abcdef');
  for (const name of ['public','gameguard_harness_abc','gameguard_harness_0123456789abcdef;DROP SCHEMA public']) {
    assert.throws(()=>schemaName(name),/INVALID_HARNESS_SCHEMA/);
  }
});
test('purchase identity is a separate trusted principal; client actor fields are rejected',()=>{
  assert.match(commandSQL(principal,command),/SELECT purchase\('player-a','buy-1','alice','potion',1\);/);
  assert.throws(()=>commandSQL(principal,{...command,actor:'player-b'}),/INVALID_COMMAND/);
  assert.throws(()=>commandSQL({id:'player-a',actor:'player-b'},command),/INVALID_COMMAND/);
});
test('command validation rejects SQL text, coercion and unbounded quantities before database access',()=>{
  for(const bad of [
    {...command,key:"x'); DROP TABLE accounts;--"},
    {...command,quantity:'1'},
    {...command,quantity:0},
    {...command,quantity:1000000001},
    {...command,quantity:1.5},
    {...command,extra:true}
  ]) assert.throws(()=>commandSQL(principal,bad),/INVALID_COMMAND/);
});
test('fresh harnesses use separate random schemas without opening connections',()=>{
  const a=createHarness(env),b=createHarness(env);
  assert.notEqual(a.schema,b.schema);
  assert.match(a.schema,/^gameguard_harness_[a-f0-9]{16}$/);
});
