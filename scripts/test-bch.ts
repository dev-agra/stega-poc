import { buildBchCode, bchEncode, bchDecode } from '../src/lib/bch';

const code = buildBchCode(6, 5);
console.log(`BCH code: n=${code.n} k=${code.k} t=${code.t}`);

function randomBits(len: number): number[] {
  return Array.from({ length: len }, () => (Math.random() < 0.5 ? 1 : 0));
}

function flipRandomBits(bits: number[], count: number): number[] {
  const out = bits.slice();
  const positions = new Set<number>();
  while (positions.size < count) {
    positions.add(Math.floor(Math.random() * bits.length));
  }
  for (const p of positions) out[p] ^= 1;
  return out;
}

let pass = 0;
let fail = 0;
const trials = 200;

for (let trial = 0; trial < trials; trial++) {
  const msg = randomBits(code.k);
  const codeword = bchEncode(code, msg);

  // sanity: zero errors should decode perfectly
  const errCount = Math.floor(Math.random() * (code.t + 1)); // 0..t errors
  const received = flipRandomBits(codeword, errCount);
  const result = bchDecode(code, received);

  const ok =
    result.success &&
    result.message !== null &&
    result.message.join('') === msg.join('');

  if (ok) pass++;
  else {
    fail++;
    console.log(
      `FAIL trial ${trial}: errCount=${errCount} success=${result.success} errorsFound=${result.errorsFound}`
    );
  }
}

console.log(`\n${pass}/${trials} passed with 0..t=${code.t} injected errors`);

// Test over-limit errors are rejected or corrected wrongly -> expect success=false ideally
let overLimitRejected = 0;
const overTrials = 50;
for (let trial = 0; trial < overTrials; trial++) {
  const msg = randomBits(code.k);
  const codeword = bchEncode(code, msg);
  const received = flipRandomBits(codeword, code.t + 3); // well beyond t
  const result = bchDecode(code, received);
  if (!result.success) overLimitRejected++;
}
console.log(`Over-limit errors (t+3): ${overLimitRejected}/${overTrials} correctly rejected as uncorrectable`);

// Test random garbage (no valid codeword at all) -> should mostly reject
let garbageRejected = 0;
const garbageTrials = 100;
for (let trial = 0; trial < garbageTrials; trial++) {
  const random = randomBits(code.n);
  const result = bchDecode(code, random);
  if (!result.success) garbageRejected++;
}
console.log(`Pure random garbage: ${garbageRejected}/${garbageTrials} correctly rejected`);
