// police.js — the law of Porto Serena: a wanted level that rises with witnessed crime
// and cools when the player lies low, and police cars that hunt, ram and pin the
// player until the bust meter fills.

import { ROAD_LINES } from './city.js';
import { Car, steerToward } from './vehicles.js';
import { clamp } from './rng.js';

const CRIME_HEAT = {
  kill: 2.0,
  hitrun: 1.2,
  assault: 1.0,
  shots: 0.9,
  steal: 1.0,
  ramPolice: 1.0,
  vandalism: 0.35,
  crash: 0.25,
};

/** The wanted level: heat underneath, stars on top, and the bust meter. */
export class WantedLevel {
  constructor() {
    this.heat = 0;
    this.sinceCrime = 99;
    this.bustMeter = 0;
    this.locked = 0; // missions can hold the heat at a floor (an ambush, a finale)
  }

  get stars() {
    return clamp(Math.floor(this.heat + 0.0001), 0, 5);
  }

  /** Report a crime; witnessed ones count in full, others at a discount. */
  report(kind, witnessed = true) {
    const add = (CRIME_HEAT[kind] || 0.3) * (witnessed ? 1 : 0.45);
    if (add <= 0) return;
    this.heat = clamp(this.heat + add, 0, 5.6);
    this.sinceCrime = 0;
  }

  /** Force at least this much heat (mission ambushes and finales). */
  forceAtLeast(stars) {
    this.locked = stars;
    this.heat = Math.max(this.heat, stars);
    this.sinceCrime = 0;
  }

  /** Clear the slate (busted, wasted, or a mission that ends the chase). */
  clear() {
    this.heat = 0;
    this.locked = 0;
    this.bustMeter = 0;
    this.sinceCrime = 99;
  }

  /**
   * Cool the heat and run the bust meter. ctx = { nearestPolice (units or Infinity),
   * playerSpeed, inCar, onBusted }.
   */
  update(dt, ctx) {
    this.sinceCrime += dt;
    const floor = this.locked;
    if (this.sinceCrime > 9 && ctx.nearestPolice > 26 && this.heat > floor) {
      this.heat = Math.max(floor, this.heat - dt * 0.055);
    }
    if (this.locked > 0 && this.sinceCrime > 14) this.locked = 0;
    const pinRange = ctx.inCar ? 10.5 : 7.5;
    const pinned = ctx.nearestPolice < pinRange && (ctx.inCar ? ctx.playerSpeed < 2.6 : true);
    if (pinned && this.stars > 0) {
      this.bustMeter = Math.min(1, this.bustMeter + dt * 0.42);
      if (this.bustMeter >= 1 && ctx.onBusted) ctx.onBusted();
    } else {
      this.bustMeter = Math.max(0, this.bustMeter - dt * 0.7);
    }
  }
}

/** The police fleet: spawns to match the wanted level and hunts the player. */
export class PoliceManager {
  constructor(scene) {
    this.scene = scene;
    this.cars = [];
    this.spawnTimer = 0;
    this.leaving = new Map();
  }

  desiredCount(stars) {
    if (stars <= 0) return 0;
    return Math.min(1 + stars, 6);
  }

  spawnNear(player) {
    const angle = Math.random() * Math.PI * 2;
    let x = player.x + Math.sin(angle) * 78;
    let z = player.z + Math.cos(angle) * 78;
    // Snap to the nearest road on one axis so the car starts on a street.
    const snap = (v) => ROAD_LINES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), ROAD_LINES[0]);
    if (Math.random() < 0.5) z = snap(z); else x = snap(x);
    x = clamp(x, -176, 176);
    z = clamp(z, -176, 186);
    const car = new Car(this.scene, { color: 0xf2f2f2, kind: 'police', x, z, heading: Math.atan2(player.x - x, player.z - z) });
    car.driver = 'police';
    this.cars.push(car);
    return car;
  }

  removeCar(car) {
    this.scene.remove(car.group);
    this.cars = this.cars.filter((c) => c !== car);
    this.leaving.delete(car);
  }

  /** Distance to the nearest active police car (Infinity when there are none). */
  nearestDistance(player) {
    let best = Infinity;
    for (const car of this.cars) {
      if (this.leaving.has(car)) continue;
      const d = Math.hypot(car.x - player.x, car.z - player.z);
      if (d < best) best = d;
    }
    return best;
  }

  update(dt, ctx) {
    const { player, wanted, world, t } = ctx;
    const stars = wanted.stars;
    this.spawnTimer -= dt;
    if (stars > 0) {
      for (const car of this.cars) this.leaving.delete(car);
      if (this.cars.length < this.desiredCount(stars) && this.spawnTimer <= 0) {
        this.spawnNear(player);
        this.spawnTimer = 2.2;
      }
    }
    const playerSpeed = player.inCar ? Math.abs(player.inCar.speed) : Math.hypot(0, 0);
    for (const car of [...this.cars]) {
      car.flashBeacons(t);
      if (car.dead) {
        this.removeCar(car);
        continue;
      }
      if (stars === 0 && !this.leaving.has(car)) this.leaving.set(car, 7);
      if (this.leaving.has(car)) {
        const left = this.leaving.get(car) - dt;
        this.leaving.set(car, left);
        const dist = Math.hypot(car.x - player.x, car.z - player.z);
        if (left <= 0 || dist > 130) {
          this.removeCar(car);
          continue;
        }
        // Drive away from the player and despawn in the distance.
        const away = Math.atan2(car.x - player.x, car.z - player.z);
        const tx = car.x + Math.sin(away) * 60;
        const tz = car.z + Math.cos(away) * 60;
        const control = {
          throttle: 0.8,
          steer: steerToward(car.heading, Math.atan2(tx - car.x, tz - car.z), 1.8),
        };
        car.update(dt, control, world);
        continue;
      }
      // Hunt: aim at where the player is heading, not just where they are.
      const lead = player.inCar ? 0.45 : 0.1;
      const vx = player.inCar ? Math.sin(player.inCar.heading) * player.inCar.speed : 0;
      const vz = player.inCar ? Math.cos(player.inCar.heading) * player.inCar.speed : 0;
      const tx = player.x + vx * lead;
      const tz = player.z + vz * lead;
      const dist = Math.hypot(tx - car.x, tz - car.z);
      const desired = Math.atan2(tx - car.x, tz - car.z);
      let throttle = 1;
      if (!player.inCar && dist < 4.2) throttle = 0; // stop beside a player on foot: the meter does the rest
      else if (dist < 9) throttle = 0.55;
      if (Math.abs(car.speed) < 0.8 && dist > 6) {
        car.stuckTime = (car.stuckTime || 0) + dt;
        if (car.stuckTime > 1.1) {
          car.stuckTime = -1.4; // reverse for a while to unstick
        }
      } else if (car.stuckTime > 0) car.stuckTime = 0;
      if (car.stuckTime < 0) {
        car.stuckTime += dt;
        throttle = -0.8;
      }
      const control = { throttle, steer: steerToward(car.heading, desired, 2.1) };
      car.update(dt, control, world);
    }
    return playerSpeed;
  }
}
