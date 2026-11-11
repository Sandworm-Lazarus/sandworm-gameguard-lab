(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameGuard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 262144;
  const MAX_EVENTS = 500;
  const MAX_UNITS = 1000000000;
  class GuardError extends Error { constructor(code) { super({INVALID_JSON:'Scenario must be valid JSON.',LIMIT:'Scenario exceeds a documented limit.',SCHEMA:'Scenario does not match the documented schema.',CRYPTO:'SHA-256 is unavailable in this browser context.'}[code] || 'Unable to process this scenario.'); this.name='GuardError'; this.code=code; } }
  const fail = code => { throw new GuardError(code); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const exact = (value, keys) => { if (!object(value) || Object.keys(value).length !== keys.length || !keys.every(k => Object.hasOwn(value,k))) fail('SCHEMA'); };
  const id = value => { if(typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(value)) fail('SCHEMA'); return value; };
  const units = (value, positive=false) => { if(!Number.isSafeInteger(value) || value < (positive?1:0) || value > MAX_UNITS) fail('SCHEMA'); return value; };
  function inventory(value) { if(!object(value) || Object.keys(value).length>100) fail('SCHEMA'); const out=Object.create(null); for(const [key,n] of Object.entries(value)) out[id(key)]=units(n); return out; }
  function validate(input) {
    if(typeof input !== 'string') fail('SCHEMA');
    if(new TextEncoder().encode(input).byteLength > MAX_BYTES) fail('LIMIT');
    let raw; try { raw=JSON.parse(input); } catch { fail('INVALID_JSON'); }
    exact(raw,['version','accounts','shop','treasury','events']);
    if(raw.version!==1 || !Array.isArray(raw.accounts) || raw.accounts.length<1 || raw.accounts.length>100 || !Array.isArray(raw.shop) || raw.shop.length>100 || !Array.isArray(raw.events) || raw.events.length>MAX_EVENTS) fail('SCHEMA');
    const accounts=Object.create(null), shop=Object.create(null);
    for(const account of raw.accounts){ exact(account,['id','owner','balance','inventory']); const key=id(account.id); if(Object.hasOwn(accounts,key))fail('SCHEMA'); accounts[key]={owner:id(account.owner),balance:units(account.balance),inventory:inventory(account.inventory)}; }
    for(const item of raw.shop){ exact(item,['id','price','stock']); const key=id(item.id); if(Object.hasOwn(shop,key))fail('SCHEMA'); shop[key]={price:units(item.price,true),stock:units(item.stock)}; }
    const events=raw.events.map(event=>{
      if(!object(event))fail('SCHEMA');
      if(event.type==='transfer') { exact(event,['type','key','actor','from','to','amount']); return {type:'transfer',key:id(event.key),actor:id(event.actor),from:id(event.from),to:id(event.to),amount:units(event.amount,true)}; }
      if(event.type==='purchase'||event.type==='use') { exact(event,['type','key','actor','account','item','quantity']); return {type:event.type,key:id(event.key),actor:id(event.actor),account:id(event.account),item:id(event.item),quantity:units(event.quantity,true)}; }
      fail('SCHEMA');
    });
    return {version:1,state:{accounts,shop,treasury:units(raw.treasury)},events};
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  const total = state => Object.values(state.accounts).reduce((sum,a)=>sum+a.balance,state.treasury);
  function invariants(state, originalTotal) {
    return {currencyConserved:total(state)===originalTotal,nonnegativeBalances:Object.values(state.accounts).every(a=>Number.isSafeInteger(a.balance)&&a.balance>=0)&&Number.isSafeInteger(state.treasury)&&state.treasury>=0,nonnegativeStock:Object.values(state.shop).every(i=>Number.isSafeInteger(i.stock)&&i.stock>=0),nonnegativeInventory:Object.values(state.accounts).every(a=>Object.values(a.inventory).every(q=>Number.isSafeInteger(q)&&q>=0))};
  }
  const has = (record,key) => Object.hasOwn(record,key);
  function execute(state,event,guarded) {
    const accountKey=event.type==='transfer'?event.from:event.account;
    if(!has(state.accounts,accountKey)) return 'ACCOUNT_MISSING';
    const account=state.accounts[accountKey];
    if(guarded && event.actor!==account.owner) return 'OWNERSHIP_DENIED';
    if(event.type==='transfer') {
      if(!has(state.accounts,event.to))return 'ACCOUNT_MISSING';
      if(event.from===event.to)return 'SAME_ACCOUNT';
      if(guarded&&account.balance<event.amount)return 'INSUFFICIENT_FUNDS';
      if(guarded&&!Number.isSafeInteger(state.accounts[event.to].balance+event.amount))return 'INTEGER_OVERFLOW';
      account.balance-=event.amount;state.accounts[event.to].balance+=event.amount;
    } else if(event.type==='purchase') {
      if(!has(state.shop,event.item))return 'ITEM_MISSING';
      const item=state.shop[event.item], cost=item.price*event.quantity;
      if(!Number.isSafeInteger(cost))return 'INTEGER_OVERFLOW';
      const before=has(account.inventory,event.item)?account.inventory[event.item]:0;
      if(guarded && item.stock<event.quantity)return 'INSUFFICIENT_STOCK';
      if(guarded && account.balance<cost)return 'INSUFFICIENT_FUNDS';
      if(guarded && (!Number.isSafeInteger(before+event.quantity)||!Number.isSafeInteger(state.treasury+cost)))return 'INTEGER_OVERFLOW';
      item.stock-=event.quantity;account.balance-=cost;state.treasury+=cost;account.inventory[event.item]=before+event.quantity;
    } else {
      const before=has(account.inventory,event.item)?account.inventory[event.item]:0;
      if(guarded&&before<event.quantity)return 'INSUFFICIENT_INVENTORY';
      account.inventory[event.item]=before-event.quantity;
    }
    return null;
  }
  function replay(scenario,guarded) {
    let state=clone(scenario.state);const originalTotal=total(state);const cache=new Map();const timeline=[];
    for(const [index,event] of scenario.events.entries()) {
      const fingerprint=JSON.stringify(event);const prior=cache.get(event.key);
      if(guarded&&prior){timeline.push({event:index+1,type:event.type,key:event.key,status:prior.fingerprint===fingerprint?'replayed':'denied',reason:prior.fingerprint===fingerprint?'SAME_COMMAND_NO_EFFECT':'KEY_CONFLICT',balanceTotal:total(state)});continue;}
      const candidate=clone(state);const reason=execute(candidate,event,guarded);
      if(reason){timeline.push({event:index+1,type:event.type,key:event.key,status:'denied',reason,balanceTotal:total(state)});continue;}
      if(guarded&&!Object.values(invariants(candidate,originalTotal)).every(Boolean)){timeline.push({event:index+1,type:event.type,key:event.key,status:'denied',reason:'INVARIANT_FAILURE',balanceTotal:total(state)});continue;}
      state=candidate;if(guarded)cache.set(event.key,{fingerprint});
      timeline.push({event:index+1,type:event.type,key:event.key,status:'applied',reason:guarded?'CHECKS_PASSED':'UNCHECKED_BASELINE',balanceTotal:total(state)});
    }
    return {state,timeline,invariants:invariants(state,originalTotal),summary:{applied:timeline.filter(e=>e.status==='applied').length,denied:timeline.filter(e=>e.status==='denied').length,replayed:timeline.filter(e=>e.status==='replayed').length},originalCurrencyTotal:originalTotal,finalCurrencyTotal:total(state)};
  }
  function compare(text) { const scenario=validate(text);return {formatVersion:1,engineVersion:'0.1.0',model:'synthetic-single-process-sequential',eventCount:scenario.events.length,initialState:clone(scenario.state),naive:replay(scenario,false),guarded:replay(scenario,true)}; }
  async function sha256(text) { let provider=typeof crypto!=='undefined'?crypto:null;if(!provider?.subtle&&typeof require==='function')provider=require('node:crypto').webcrypto;if(!provider?.subtle)fail('CRYPTO');const bytes=new Uint8Array(await provider.subtle.digest('SHA-256',new TextEncoder().encode(text)));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''); }
  async function report(text) { return {...compare(text),fixtureSha256:await sha256(text)}; }
  function sample(name='replay') {
    const base={version:1,accounts:[{id:'alice',owner:'player-a',balance:100,inventory:{potion:1}},{id:'bob',owner:'player-b',balance:25,inventory:{potion:0}}],shop:[{id:'potion',price:10,stock:2}],treasury:0,events:[]};
    const transfer={type:'transfer',key:'tx-01',actor:'player-a',from:'alice',to:'bob',amount:30};
    const purchase={type:'purchase',key:'buy-01',actor:'player-a',account:'alice',item:'potion',quantity:2};
    const scenarios={replay:[transfer,{...transfer}],ownership:[{...transfer,actor:'player-b'}],funds:[{...transfer,amount:150}],stock:[purchase,{...purchase,key:'buy-02'}],collision:[transfer,{...transfer,amount:31}],use:[{type:'use',key:'use-01',actor:'player-a',account:'alice',item:'potion',quantity:2}]};
    if(!Object.hasOwn(scenarios,name))fail('SCHEMA');base.events=scenarios[name];return JSON.stringify(base,null,2);
  }
  return Object.freeze({compare,report,sha256,sample,limits:Object.freeze({maxBytes:MAX_BYTES,maxEvents:MAX_EVENTS,maxUnits:MAX_UNITS}),GuardError});
});
