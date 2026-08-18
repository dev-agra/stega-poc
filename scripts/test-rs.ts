import { buildRsCode, rsEncode, rsDecode } from '../src/lib/rs';

const code = buildRsCode(6, 6, 3); // k=6 symbols, t=3, n=12
console.log(`RS code: n=${code.n} k=${code.k} t=${code.t} (symbols, m=6 bits each)`);

function randomSymbols(len: number, max: number): number[] {
  return Array.from({ length: len }, () => Math.floor(Math.random() * max));
}

function flipRandomSymbols(symbols: number[], count: number, fieldSize: number): number[] {
  const out = symbols.slice();
  const positions = new Set<number>();
  while (positions.size < count) positions.add(Math.floor(Math.random() * symbols.length));
  for (const p of positions) {
    let newVal = Math.floor(Math.random() * fieldSize);
    while (newVal === out[p]) newVal = Math.floor(Math.random() * fieldSize);
    out[p] = newVal;
  }
  return out;
}

let pass = 0;
let fail = 0;
const trials = 200;
for (let trial = 0; trial < trials; trial++) {
  const msg = randomSymbols(code.k, 64);
  const codeword = rsEncode(code, msg);
  const errCount = Math.floor(Math.random() * (code.t + 1));
  const received = flipRandomSymbols(codeword, errCount, 64);
  const result = rsDecode(code, received);
  const ok = result.success && result.message?.join(',') === msg.join(',');
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL trial ${trial}: errCount=${errCount} success=${result.success} errorsFound=${result.errorsFound}`);
  }
}
console.log(`${pass}/${trials} passed with 0..t=${code.t} injected symbol errors`);

let overLimitRejected = 0;
const overTrials = 50;
for (let trial = 0; trial < overTrials; trial++) {
  const msg = randomSymbols(code.k, 64);
  const codeword = rsEncode(code, msg);
  const received = flipRandomSymbols(codeword, code.t + 2, 64);
  const result = rsDecode(code, received);
  if (!result.success) overLimitRejected++;
}
console.log(`Over-limit (t+2) symbol errors: ${overLimitRejected}/${overTrials} correctly rejected`);

let garbageRejected = 0;
const garbageTrials = 100;
for (let trial = 0; trial < garbageTrials; trial++) {
  const random = randomSymbols(code.n, 64);
  const result = rsDecode(code, random);
  if (!result.success) garbageRejected++;
}
console.log(`Pure random garbage: ${garbageRejected}/${garbageTrials} correctly rejected`);
