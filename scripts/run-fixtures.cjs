'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const engine=require('../dist/gameguard.js');
const root=path.resolve(__dirname,'..');
const sourceSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/gameguard.js'))).digest('hex');
(async()=>{
  const reports=[];
  for(const name of ['replay','ownership','funds','stock','collision','use']){
    const fixture=engine.sample(name),result=await engine.report(fixture);
    reports.push({name,fixtureSha256:result.fixtureSha256,guarded:result.guarded.summary,naive:result.naive.summary,guardedInvariants:result.guarded.invariants});
    if(!Object.values(result.guarded.invariants).every(Boolean))throw new Error('Guarded invariant failure');
  }
  process.stdout.write(JSON.stringify({engineVersion:'0.1.0',sourceSha256,reports},null,2)+'\n');
})().catch(()=>{process.stderr.write('Fixture verification failed.\n');process.exitCode=1;});
