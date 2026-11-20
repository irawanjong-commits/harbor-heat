// traffic.js — the living city: cars that drive the road grid on their own, turning at
// junctions and braking for each other, and pedestrians who stroll the pavements,
// flee from danger and sometimes fight back. Traffic routes are pure-pursuit waypoint
// driving over the lane offsets of each road.

import * as THREE from 'three';
import { ROAD_LINES, collideCircle } from './city.js';
import { Car, CAR_COLORS, steerToward, headingTo } from './vehicles.js';
import { buildHumanoid } from './player.js';
import { Rng, angleWrap, clamp } from './rng.js';

const LANE = 4;

/** The lane offset of a heading: traffic keeps to one side of the centre line. */
function laneOffset(fx, fz) {
  return { x: fz * LANE, z: -fx * LANE };
}

/** One traffic car's route state: its lane, its junction ahead and its waypoints. */
class TrafficDriver {
  constructor(car, rng) {
    this.car = car;
    this.rng = rng;
    // Start on a random road, mid-block, heading along it.
    const horizontal = rng.chance(0.5);
    const line = rng.pick(ROAD_LINES);
    const along = rng.range(-160, 160);
    const dirSign = rng.sign();
    if (horizontal) {
      this.fx = dirSign; this.fz = 0;
      this.roadLine = line;
      const off = laneOffset(this.fx, this.fz);
      car.group.position.set(along, 0, line + off.z);
    } else {
      this.fx = 0; this.fz = dirSign;
      this.roadLine = line;
      const off = laneOffset(this.fx, this.fz);
      car.group.position.set(line + off.x, 0, along);
    }
    car.heading = Math.atan2(this.fx, this.fz);
    car.driver = 'traffic';
    this.queue = [];
    this.planAhead();
  }

  /** The next junction coordinate strictly ahead of the car along its heading. */
  nextJunctionCoord() {
    const along = this.fx !== 0 ? this.car.x : this.car.z;
    const dir = this.fx !== 0 ? this.fx : this.fz;
    let best = null;
    for (const line of ROAD_LINES) {
      const rel = (line - along) * dir;
      if (rel > 6 && (best === null || rel < best.rel)) best = { coord: line, rel };
    }
    if (best === null) {
      // At the city's edge: turn around by picking the far junction.
      const coord = dir > 0 ? ROAD_LINES[0] : ROAD_LINES[ROAD_LINES.length - 1];
      return coord;
    }
    return best.coord;
  }

  /** Plan waypoints through the next junction: mostly straight, sometimes a turn. */
  planAhead() {
    const car = this.car;
    const jCoord = this.nextJunctionCoord();
    const jx = this.fx !== 0 ? jCoord : this.roadLine;
    const jz = this.fx !== 0 ? this.roadLine : jCoord;
    const roll = this.rng.next();
    let nfx = this.fx;
    let nfz = this.fz;
    if (roll > 0.58) {
      // A turn: left or right from the current heading.
      const left = roll < 0.79;
      if (this.fx !== 0) { nfx = 0; nfz = left ? -this.fx : this.fx; }
      else { nfz = 0; nfx = left ? this.fz : -this.fz; }
    }
    const entry = { x: jx + laneOffset(this.fx, this.fz).x, z: jz + laneOffset(this.fx, this.fz).z };
    const exit = { x: jx + laneOffset(nfx, nfz).x, z: jz + laneOffset(nfx, nfz).z };
    if (nfx === this.fx && nfz === this.fz) {
      this.queue.push({ x: entry.x + this.fx * 44, z: entry.z + this.fz * 44 });
    } else {
      // The corner where the entry lane line meets the exit lane line.
      const t = (exit.x - entry.x) * this.fx + (exit.z - entry.z) * this.fz;
      const corner = { x: entry.x + this.fx * t, z: entry.z + this.fz * t };
      this.queue.push(corner);
      this.queue.push({ x: corner.x + nfx * 44, z: corner.z + nfz * 44 });
      this.fx = nfx;
      this.fz = nfz;
      this.roadLine = nfx !== 0 ? jz : jx;
    }
  }

  /** Drive toward the waypoints; brake for whatever is in front. */
  control(world) {
    const car = this.car;
    if (this.queue.length === 0) this.planAhead();
    let target = this.queue[0];
    let dx = target.x - car.x;
    let dz = target.z - car.z;
    if (dx * dx + dz * dz < 36) {
      this.queue.shift();
      if (this.queue.length === 0) this.planAhead();
      target = this.queue[0];
      dx = target.x - car.x;
      dz = target.z - car.z;
    }
    const desired = Math.atan2(dx, dz);
    const diff = angleWrap(desired - car.heading);
    const steer = steerToward(car.heading, desired, 1.9);
    let throttle = Math.abs(diff) > 1.1 ? 0.15 : 0.75;
    // Something ahead? Slow down or stop.
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const other of world.cars) {
      if (other === car) continue;
      const ox = other.x - car.x;
      const oz = other.z - car.z;
      const ahead = ox * fx + oz * fz;
      const side = Math.abs(ox * fz - oz * fx);
      if (ahead > 0 && ahead < 10 && side < 2.4) throttle = ahead < 6 ? -0.4 : 0;
    }
    for (const ped of world.peds) {
      if (!ped.alive) continue;
      const ox = ped.x - car.x;
      const oz = ped.z - car.z;
      const ahead = ox * fx + oz * fz;
      const side = Math.abs(ox * fz - oz * fx);
      if (ahead > 0 && ahead < 7 && side < 2.2) throttle = -0.5;
    }
    return { throttle, steer };
  }
}

/** All the self-driving cars, kept at a steady count as some are stolen or wrecked. */
export class TrafficManager {
  constructor(scene, rng, count = 12) {
    this.scene = scene;
    this.rng = rng;
    this.count = count;
    this.drivers = [];
    this.respawnTimer = 0;
    for (let i = 0; i < count; i += 1) this.spawn();
  }

  spawn() {
    const kind = this.rng.chance(0.14) ? 'taxi' : this.rng.chance(0.16) ? 'sport' : 'car';
    const car = new Car(this.scene, { color: this.rng.pick(CAR_COLORS), kind, x: 0, z: 0, heading: 0 });
    const driver = new TrafficDriver(car, this.rng);
    this.drivers.push(driver);
    return car;
  }

  /** The cars themselves, for collisions, minimaps and the player's E key. */
  get cars() {
    return this.drivers.map((d) => d.car);
  }

  update(dt, world) {
    const fullWorld = { ...world, cars: world.cars, peds: world.peds };
    for (const driver of this.drivers) {
      const car = driver.car;
      if (car.driver !== 'traffic') continue;
      if (car.dead) continue;
      car.update(dt, driver.control(fullWorld), fullWorld);
    }
    // Replace stolen or long-wrecked cars so the city never empties.
    this.drivers = this.drivers.filter((d) => d.car.driver === 'traffic' && !(d.car.dead && d.car.speed === 0 && Math.random() < 0.002));
    this.respawnTimer -= dt;
    if (this.drivers.length < this.count && this.respawnTimer <= 0) {
      this.spawn();
      this.respawnTimer = 4;
    }
  }
}

const SHIRT_COLORS = [0xe8e4da, 0xd64541, 0x3f8fbf, 0xf2b13d, 0x53b06a, 0xff7a59, 0xc792ff, 0x35c4b5];

/** One pedestrian: strolls a block's pavement ring, flees danger, may fight back. */
export class Pedestrian {
  constructor(scene, rng, blockX, blockZ) {
    this.rng = rng;
    this.home = { x: blockX, z: blockZ };
    const parts = buildHumanoid({
      shirt: rng.pick(SHIRT_COLORS),
      pants: rng.pick([0x2f3542, 0x5a4632, 0x715f6b, 0x37474f]),
      skin: rng.pick([0xf2c89b, 0xc68863, 0x8d5a3b, 0x6e442a]),
      hair: rng.pick([0x201812, 0x4a3220, 0x8a6d3b, 0xb0b0b0]),
    });
    this.group = parts.group;
    this.limbs = parts;
    scene.add(this.group);
    this.edge = rng.int(0, 3);
    this.along = rng.range(0, 34);
    this.dirSign = rng.sign();
    this.speed = rng.range(1.5, 2.4);
    this.state = 'walk';
    this.alive = true;
    this.health = 100;
    this.stateTimer = 0;
    this.punchCooldown = 0;
    this.walkPhase = rng.range(0, 6);
    this.fleeX = 0;
    this.fleeZ = 0;
    this.placeOnPath();
  }

  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }

  /** Position and heading on the pavement ring (a square 17 units from the centre). */
  placeOnPath() {
    const h = 17;
    const t = this.along;
    let x; let z; let heading;
    if (this.edge === 0) { x = this.home.x - h + t; z = this.home.z - h; heading = Math.PI / 2; }
    else if (this.edge === 1) { x = this.home.x + h; z = this.home.z - h + t; heading = 0; }
    else if (this.edge === 2) { x = this.home.x + h - t; z = this.home.z + h; heading = -Math.PI / 2; }
    else { x = this.home.x - h; z = this.home.z + h - t; heading = Math.PI; }
    if (this.dirSign < 0) heading += Math.PI;
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.group.rotation.y = heading;
  }

  /** Run directly away from a frightening point for a few seconds. */
  fleeFrom(x, z) {
    if (!this.alive) return;
    this.state = 'flee';
    this.stateTimer = this.rng.range(2, 3.5);
    this.fleeX = x;
    this.fleeZ = z;
  }

  /** Knocked down by a car or by damage: falls, lies still, later gets up elsewhere. */
  knockDown() {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'down';
    this.stateTimer = 8;
    this.group.rotation.x = -Math.PI / 2;
    this.group.position.y = 0.25;
  }

  /** Take a punch or a bullet; returns true when this finishes the pedestrian. */
  takeHit(damage) {
    if (!this.alive) return false;
    this.health -= damage;
    if (this.health <= 0) {
      this.knockDown();
      return true;
    }
    return false;
  }

  update(dt, ctx) {
    if (this.state === 'down') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        // Get up on a fresh corner of the home block, as if nothing happened.
        this.alive = true;
        this.health = 100;
        this.state = 'walk';
        this.group.rotation.x = 0;
        this.group.position.y = 0;
        this.edge = this.rng.int(0, 3);
        this.along = this.rng.range(0, 34);
        this.placeOnPath();
      }
      return;
    }
    this.punchCooldown -= dt;
    if (this.state === 'flee') {
      this.stateTimer -= dt;
      const away = Math.atan2(this.x - this.fleeX, this.z - this.fleeZ);
      this.heading = away;
      this.moveFree(dt, 5.4, ctx.colliders);
      if (this.stateTimer <= 0) {
        this.state = 'walk';
        // Resume the stroll from the nearest corner of the home ring.
        this.edge = this.rng.int(0, 3);
        this.along = this.rng.range(0, 34);
        this.placeOnPath();
      }
    } else if (this.state === 'fight') {
      const dx = ctx.playerX - this.x;
      const dz = ctx.playerZ - this.z;
      const dist = Math.hypot(dx, dz);
      this.heading = Math.atan2(dx, dz);
      this.group.rotation.y = this.heading;
      if (dist > 1.5) this.moveFree(dt, 4.4, ctx.colliders);
      else if (this.punchCooldown <= 0) {
        this.punchCooldown = 0.9;
        this.limbs.armR.rotation.x = -2.2;
        if (ctx.onPunchPlayer) ctx.onPunchPlayer(this);
      }
      this.stateTimer -= dt;
      if (this.stateTimer <= 0 || dist > 26) this.state = 'walk';
    } else {
      // Stroll the ring.
      this.along += this.speed * this.dirSign * dt;
      if (this.along > 34) { this.along = 0; this.edge = (this.edge + (this.dirSign > 0 ? 1 : 3)) % 4; }
      if (this.along < 0) { this.along = 34; this.edge = (this.edge + (this.dirSign > 0 ? 3 : 1)) % 4; }
      this.placeOnPath();
    }
    // Walk-cycle swing.
    this.walkPhase += dt * (this.state === 'walk' ? 6 : 11);
    const swing = Math.sin(this.walkPhase) * 0.55;
    this.limbs.legL.rotation.x = swing;
    this.limbs.legR.rotation.x = -swing;
    if (this.state !== 'fight') {
      this.limbs.armL.rotation.x = -swing * 0.8;
      this.limbs.armR.rotation.x = swing * 0.8;
    }
  }

  /** Free movement with building collision, used when fleeing or fighting. */
  moveFree(dt, speed, colliders) {
    let nx = this.x + Math.sin(this.heading) * speed * dt;
    let nz = this.z + Math.cos(this.heading) * speed * dt;
    const resolved = collideCircle(nx, nz, 0.55, colliders);
    nx = resolved.x;
    nz = resolved.z;
    this.group.position.x = clamp(nx, -186, 186);
    this.group.position.z = clamp(nz, -186, 248);
    this.group.rotation.y = this.heading;
  }
}

/** Every pedestrian in the city. */
export class PedestrianManager {
  constructor(scene, rng, count = 22) {
    this.peds = [];
    const blocks = [];
    for (const bx of [-140, -84, -28, 28, 84, 140]) {
      for (const bz of [-140, -84, -28, 28, 84, 140]) blocks.push([bx, bz]);
    }
    for (let i = 0; i < count; i += 1) {
      const [bx, bz] = blocks[rng.int(0, blocks.length - 1)];
      this.peds.push(new Pedestrian(scene, rng, bx, bz));
    }
    // A few beach strollers.
    for (let i = 0; i < 4; i += 1) {
      const ped = new Pedestrian(scene, rng, rng.pick([-84, -28, 28, 84]), 140);
      ped.group.position.z = 188 + rng.range(0, 4);
      this.peds.push(ped);
    }
  }

  update(dt, ctx) {
    for (const ped of this.peds) ped.update(dt, ctx);
  }

  /** Everyone in earshot of a point runs from it. */
  panicAt(x, z, radius) {
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      const dx = ped.x - x;
      const dz = ped.z - z;
      if (dx * dx + dz * dz < radius * radius) ped.fleeFrom(x, z);
    }
  }
}
