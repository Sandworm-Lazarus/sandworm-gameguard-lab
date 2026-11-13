'use strict';
// Disposable PostgreSQL integration harness. Never expose this module as a web API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const DATABASE = /^gameguard_test_[a-z0-9_]{1,40}$/;
const SCHEMA = /^gameguard_harness_[a-f0-9]{16}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const MAX = 1000000000;
const fail = code => { throw new Error(code); };

function config(env = process.env) {
  if (env.GAMEGUARD_ALLOW_DISPOSABLE_DATABASE !== '1') fail('DISPOSABLE_DATABASE_OPT_IN_REQUIRED');
  let url;
  try { url = new URL(env.GAMEGUARD_TEST_DATABASE_URL); } catch { fail('INVALID_TEST_DATABASE'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) fail('INVALID_TEST_DATABASE');
  let database, user, password;
  try { database = decodeURIComponent(url.pathname.slice(1)); user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); }
  catch { fail('INVALID_TEST_DATABASE'); }
  if (!DATABASE.test(database) || !user || /[\0\r\n]/.test(user + password)) fail('INVALID_TEST_DATABASE');
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) fail('INVALID_TEST_DATABASE');
  const params = [...url.searchParams.keys()];
  if (params.some(key => key !== 'sslmode') || params.length > 1) fail('INVALID_TEST_DATABASE');
  const sslmode = url.searchParams.get('sslmode') || 'prefer';
  if (!['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode)) fail('INVALID_TEST_DATABASE');
  return { database, env: {
    PATH: process.env.PATH || '', ...(process.env.SystemRoot ? {SystemRoot:process.env.SystemRoot} : {}),
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: user, PGPASSWORD: password,
    PGDATABASE: database, PGSSLMODE: sslmode, PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'sandworm-gameguard-test'
  }};
}
function schemaName(value) {
  if (typeof value !== 'string' || !SCHEMA.test(value)) fail('INVALID_HARNESS_SCHEMA');
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_COMMAND');
  return "'" + value + "'";
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value,key))) fail('INVALID_COMMAND');
}
function commandSQL(principal, command) {
  exact(principal,['id']); exact(command,['key','account','item','quantity']);
  if (!Number.isSafeInteger(command.quantity) || command.quantity < 1 || command.quantity > MAX) fail('INVALID_COMMAND');
  return 'SELECT purchase(' + [identifier(principal.id),identifier(command.key),identifier(command.account),identifier(command.item),command.quantity].join(',') + ');';
}
function createHarness(env = process.env, selectedSchema) {
  const settings = config(env);
  const schema = schemaName(selectedSchema || 'gameguard_harness_' + crypto.randomBytes(8).toString('hex'));
  let created = false;
  function execute(sql, parse = false) {
    if (typeof sql !== 'string' || Buffer.byteLength(sql) > 32768) fail('QUERY_LIMIT');
    const prelude = "SET statement_timeout='8s'; SET lock_timeout='5s'; SET standard_conforming_strings=on;\n" +
      "DO $guard$ BEGIN IF current_database() <> '" + settings.database + "' THEN RAISE EXCEPTION 'WRONG_TEST_DATABASE'; END IF; END $guard$;\n" +
      'SET search_path TO ' + schema + ', pg_catalog;\n';
    return new Promise((resolve,reject) => {
      // Connection settings are environment variables, never argv or error text.
      const child = execFile('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-f','-'],
        {env:settings.env,timeout:15000,maxBuffer:262144,windowsHide:true},
        (error,stdout) => {
          if (error) { reject(new Error('DATABASE_COMMAND_FAILED')); return; }
          if (!parse) { resolve(); return; }
          try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error('INVALID_DATABASE_RESPONSE')); }
        });
      child.stdin.on('error',()=>{});
      child.stdin.end(prelude + sql);
    });
  }
  return Object.freeze({
    schema,
    async setup() {
      if (created) fail('HARNESS_ALREADY_CREATED');
      const source = fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8').replaceAll('__SCHEMA__',schema);
      await execute('BEGIN;\n' + source + '\nCOMMIT;');
      created = true;
    },
    async seed({balance=100,stock=1,price=10,inventory=0} = {}) {
      if (!created) fail('HARNESS_NOT_OWNER');
      if (![balance,stock,price,inventory].every(Number.isSafeInteger) || balance < 0 || balance > MAX ||
          stock < 0 || stock > MAX || price < 1 || price > MAX || inventory < 0 || inventory > MAX) fail('INVALID_FIXTURE');
      await execute('BEGIN; TRUNCATE successful_requests, inventory, shop, accounts, treasury;' +
        " INSERT INTO accounts VALUES ('alice','player-a'," + balance + "),('bob','player-b',100);" +
        " INSERT INTO shop VALUES ('potion'," + price + ',' + stock + ');' +
        " INSERT INTO inventory VALUES ('alice','potion'," + inventory + ');' +
        ' INSERT INTO treasury VALUES (1,0); COMMIT;');
    },
    async seedConcurrentBuyers(count = 20) {
      if (!created) fail('HARNESS_NOT_OWNER');
      if (!Number.isInteger(count) || count < 2 || count > 20) fail('INVALID_FIXTURE');
      await execute("INSERT INTO accounts SELECT 'buyer-' || n, 'player-' || n, 100 FROM generate_series(1," + count + ") AS n;");
    },
    purchase(principal, command) { return execute(commandSQL(principal,command),true); },
    // Causes a SQL error after purchase changes; psql disconnect must roll back all effects.
    abortPurchaseForTest(principal, command) {
      return execute('BEGIN;\n' + commandSQL(principal,command) + '\nSELECT 1/0;\nCOMMIT;');
    },
    snapshot() {
      return execute("SELECT jsonb_build_object(" +
        "'accounts',(SELECT jsonb_object_agg(id,balance) FROM accounts)," +
        "'stock',(SELECT stock FROM shop WHERE id='potion')," +
        "'inventory',(SELECT COALESCE(sum(quantity),0) FROM inventory)," +
        "'treasury',(SELECT balance FROM treasury WHERE id=1)," +
        "'requests',(SELECT count(*) FROM successful_requests));",true);
    },
    async cleanup() {
      if (!created) return;
      // Only a schema created by this instance is removed; no database or public-schema deletion.
      await execute('DROP SCHEMA ' + schemaName(schema) + ' CASCADE;');
      created = false;
    }
  });
}
module.exports = {config,schemaName,commandSQL,createHarness};
