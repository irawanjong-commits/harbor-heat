// rng.js — a small seeded random number generator (mulberry32), so the city, traffic and
// screenshot scenes are built from a seed and the same seed always gives the same world.

/** Create a generator from a numeric seed; returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator with the helpers the game wants: ranges, integers, picks and signs. */
export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max], both ends included. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** One item of an array. */
  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  /** True with the given probability. */
  chance(probability) {
    return this.next() < probability;
  }

  /** -1 or 1. */
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

/** Wrap an angle in radians to [-PI, PI], for steering towards a heading. */
export function angleWrap(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

/** Clamp a number into [min, max]. */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
