/**
 * Excel-style decimal rounding: half away from zero on the *decimal* value.
 *
 * `toFixed` and float multiplication round the binary double, and values like
 * 1.005 are stored as 1.00499999999999989…, so they print "1.00" where Excel
 * prints "1.01" — Excel rounds the decimal the user typed.
 *
 * The implementation works on the number's shortest decimal string
 * (`String(value)`, exponential forms included) and shifts the decimal point
 * with exact BigInt arithmetic instead of multiplying by `10 ** decimals`,
 * so no binary rounding noise enters the decision.
 */

export function roundHalfAwayFromZero(value: number, decimals: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(decimals)) return value;
  if (value === 0) return 0;
  const places = Math.trunc(decimals);
  // Absurd precision requests fall back to the input rather than building
  // giant strings; anything past double range would be noise anyway.
  if (places > 350 || places < -350) return value;

  const sign = value < 0 ? -1 : 1;
  const { digits, exponent } = decimalParts(Math.abs(value));

  // |value| * 10^places = digits * 10^(exponent + places). A negative shift
  // means the scaled value still has a fractional part to round away.
  const shift = exponent + places;
  if (shift >= 0) return value; // already exact at this precision

  const digitsBig = BigInt(digits);
  const cut = 10n ** BigInt(-shift);
  const truncated = digitsBig / cut;
  const remainder = digitsBig % cut;
  const rounded = remainder >= cut / 2n ? truncated + 1n : truncated;

  return sign * unscale(rounded, places);
}

/** Split a non-negative double into significant digits and decimal exponent: abs = digits * 10^exponent. */
function decimalParts(abs: number): { digits: string; exponent: number } {
  const text = String(abs);
  const eAt = text.indexOf('e');
  if (eAt >= 0) {
    // Exponential form ("1e-7", "1.5e+21") — flatten the mantissa and fold
    // its fractional length into the exponent.
    const mantissa = text.slice(0, eAt);
    const dot = mantissa.indexOf('.');
    const fracLen = dot >= 0 ? mantissa.length - dot - 1 : 0;
    const digits = (dot >= 0 ? mantissa.slice(0, dot) + mantissa.slice(dot + 1) : mantissa).replace(/^0+(?=\d)/, '');
    return { digits, exponent: Number(text.slice(eAt + 1)) - fracLen };
  }
  const dot = text.indexOf('.');
  if (dot < 0) return { digits: text, exponent: 0 };
  const digits = (text.slice(0, dot) + text.slice(dot + 1)).replace(/^0+(?=\d)/, '');
  return { digits, exponent: -(text.length - dot - 1) };
}

/** Build the final double from the rounded scaled integer: scaled / 10^places. */
function unscale(scaled: bigint, places: number): number {
  const text = scaled.toString();
  if (places <= 0) return Number(text + '0'.repeat(-places));
  if (text.length <= places) return Number(`0.${text.padStart(places, '0')}`);
  return Number(`${text.slice(0, -places)}.${text.slice(-places)}`);
}
