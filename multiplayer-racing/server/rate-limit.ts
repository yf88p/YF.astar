export class TokenBucket {
  private tokens: number;
  private updated: number;

  constructor(
    readonly rate: number,
    readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.updated = now;
  }

  take(now: number, count = 1): boolean {
    this.tokens = Math.min(
      this.burst,
      this.tokens + (Math.max(0, now - this.updated) * this.rate) / 1000,
    );
    this.updated = Math.max(now, this.updated);
    if (count > this.tokens) return false;
    this.tokens -= count;
    return true;
  }
}
