// Binární halda pro A*: klíče seřazené podle skóre
export class MinHeap {
  private readonly keys: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, score: number): void {
    let i = this.keys.length;
    this.keys.push(key);
    this.scores.push(score);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[p] <= score) break;
      this.keys[i] = this.keys[p];
      this.scores[i] = this.scores[p];
      i = p;
    }
    this.keys[i] = key;
    this.scores[i] = score;
  }

  pop(): number {
    const top = this.keys[0];
    const lastKey = this.keys.pop()!;
    const lastScore = this.scores.pop()!;
    const n = this.keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        let ms = lastScore;
        if (l < n && this.scores[l] < ms) {
          m = l;
          ms = this.scores[l];
        }
        if (r < n && this.scores[r] < ms) m = r;
        if (m === i) break;
        this.keys[i] = this.keys[m];
        this.scores[i] = this.scores[m];
        i = m;
      }
      this.keys[i] = lastKey;
      this.scores[i] = lastScore;
    }
    return top;
  }
}
