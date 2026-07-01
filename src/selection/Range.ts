export interface RangeAddress {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

export class Range {
  public readonly r1: number;
  public readonly c1: number;
  public readonly r2: number;
  public readonly c2: number;

  public constructor(address: RangeAddress) {
    this.r1 = Math.min(address.r1, address.r2);
    this.c1 = Math.min(address.c1, address.c2);
    this.r2 = Math.max(address.r1, address.r2);
    this.c2 = Math.max(address.c1, address.c2);
  }

  public static single(r: number, c: number): Range {
    return new Range({ r1: r, c1: c, r2: r, c2: c });
  }

  public static normalize(address: RangeAddress): RangeAddress {
    const range = new Range(address);
    return range.toAddress();
  }

  public contains(r: number, c: number): boolean {
    return r >= this.r1 && r <= this.r2 && c >= this.c1 && c <= this.c2;
  }

  public expand(r: number, c: number): Range {
    return new Range({ r1: this.r1, c1: this.c1, r2: r, c2: c });
  }

  public get rowCount(): number {
    return this.r2 - this.r1 + 1;
  }

  public get colCount(): number {
    return this.c2 - this.c1 + 1;
  }

  public toAddress(): RangeAddress {
    return { r1: this.r1, c1: this.c1, r2: this.r2, c2: this.c2 };
  }
}
