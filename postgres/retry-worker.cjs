'use strict';
// Isolated application-process fixture: credentials only arrive through env, never argv.
const { createHarness } = require('./harness.cjs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input) > 4096) {
    process.stderr.write('INVALID_WORKER_INPUT\n');
    process.exit(1);
  }
});
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(input);
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.keys(data).length !== 3 || !['schema','principal','command'].every(k=>Object.hasOwn(data,k))) throw Error();
    const harness = createHarness(process.env,data.schema);
    const result = await harness.purchase(data.principal,data.command);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    process.stderr.write('PURCHASE_WORKER_FAILED\n');
    process.exitCode = 1;
  }
});
