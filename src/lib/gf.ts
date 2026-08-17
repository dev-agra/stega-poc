// Galois Field GF(2^m) arithmetic via log/antilog tables.
// Used by the BCH encoder/decoder.

export class GF {
  readonly m: number;
  readonly n: number; // 2^m - 1
  readonly expTable: number[]; // expTable[i] = alpha^i, length 2*n+1 for safe wraparound
  readonly logTable: number[]; // logTable[alpha^i] = i, index 0 unused (log(0) undefined)

  constructor(m: number, primitivePoly: number) {
    this.m = m;
    this.n = (1 << m) - 1;
    const size = this.n;
    this.expTable = new Array(size * 2 + 2).fill(0);
    this.logTable = new Array(size + 1).fill(0);

    let reg = 1;
    for (let i = 0; i < size; i++) {
      this.expTable[i] = reg;
      this.logTable[reg] = i;
      reg <<= 1;
      if (reg & (1 << m)) reg ^= primitivePoly;
    }
    // extend for indices >= n (wraparound), used by mul/div convenience
    for (let i = size; i < this.expTable.length; i++) {
      this.expTable[i] = this.expTable[i - size];
    }
  }

  /** alpha^i, i can be any integer (wraps mod n) */
  exp(i: number): number {
    let idx = i % this.n;
    if (idx < 0) idx += this.n;
    return this.expTable[idx];
  }

  log(a: number): number {
    return this.logTable[a];
  }

  mul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return this.exp(this.log(a) + this.log(b));
  }

  div(a: number, b: number): number {
    if (a === 0) return 0;
    if (b === 0) throw new Error('GF division by zero');
    return this.exp(this.log(a) - this.log(b));
  }

  inv(a: number): number {
    if (a === 0) throw new Error('GF inverse of zero');
    return this.exp(-this.log(a));
  }

  pow(a: number, p: number): number {
    if (a === 0) return p === 0 ? 1 : 0;
    return this.exp(this.log(a) * p);
  }

  add(a: number, b: number): number {
    return a ^ b; // GF(2^m) addition is XOR
  }
}

/** m=6 primitive polynomial x^6 + x + 1 -> 0b1000011 = 0x43 */
export const GF64_PRIMITIVE_POLY = 0x43;
