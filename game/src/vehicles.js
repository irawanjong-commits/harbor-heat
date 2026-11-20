// vehicles.js — the cars of Porto Serena: low-poly bodies built from boxes, arcade
// driving physics, building and car collisions, and damage. One Car class serves the
// player, the traffic and the police; what differs is who provides the controls.

import * as THREE from 'three';
import { collideCircle } from './city.js';
import { angleWrap, clamp } from './rng.js';

const GLASS = new THREE.MeshStandardMaterial({ color: 0x18222e, metalness: 0.7, roughness: 0.25 });
const TIRE = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.95 });
const CHROME = new THREE.MeshStandardMaterial({ color: 0xb9c0c9, metalness: 0.8, roughness: 0.35 });
const HEADLIGHT = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
const TAILLIGHT = new THREE.MeshBasicMaterial({ color: 0xff3b30 });

export const CAR_COLORS = [0xd64541, 0x3f8fbf, 0xf2b13d, 0x53b06a, 0xe8e4da, 0x7a5fd0, 0x2f3542, 0xff7a59, 0x35c4b5, 0xc0c6ce];

/** Build one car's mesh; returns the group and the parts other modules animate. */
export function createCarMesh(color, kind) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 });
  const isSport = kind === 'sport';
  const bodyH = isSport ? 0.5 : 0.62;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, bodyH, isSport ? 4.55 : 4.3), paint);
  body.position.y = 0.32 + bodyH / 2;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.52, isSport ? 1.9 : 2.15), GLASS);
  cabin.position.set(0, 0.32 + bodyH + 0.26, isSport ? -0.35 : -0.2);
  cabin.castShadow = true;
  group.add(cabin);
  if (isSport) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.42), paint);
    spoiler.position.set(0, 1.02, -2.05);
    group.add(spoiler);
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.34), new THREE.MeshBasicMaterial({ color: 0xffd94d }));
    sign.position.set(0, 1.42, -0.2);
    group.add(sign);
  }
  let beaconRed = null;
  let beaconBlue = null;
  if (kind === 'police') {
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 2.4), new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.6 }));
      panel.position.set(side * 0.99, 0.66, 0);
      group.add(panel);
    }
    beaconRed = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2211, emissiveIntensity: 0.4 });
    beaconBlue = new THREE.MeshStandardMaterial({ color: 0x000033, emissive: 0x2255ff, emissiveIntensity: 0.4 });
    const barR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.44), beaconRed);
    barR.position.set(-0.3, 1.42, -0.2);
    group.add(barR);
    const barB = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.44), beaconBlue);
    barB.position.set(0.3, 1.42, -0.2);
    group.add(barB);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 10);
  const wheels = [];
  const frontWheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.37, wz);
    const wheel = new THREE.Mesh(wheelGeo, TIRE);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    pivot.add(wheel);
    group.add(pivot);
    wheels.push(wheel);
    if (wz > 0) frontWheels.push(pivot);
  }
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), HEADLIGHT);
    head.position.set(side * 0.62, 0.72, 2.16);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), TAILLIGHT);
    tail.position.set(side * 0.62, 0.74, -2.16);
    group.add(tail);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.25), CHROME);
  bumper.position.set(0, 0.36, 2.18);
  group.add(bumper);
  return { group, wheels, frontWheels, beaconRed, beaconBlue };
}

/** One car in the world: position, heading, speed, health and who is driving it. */
export class Car {
  constructor(scene, { color = 0xd64541, kind = 'car', x = 0, z = 0, heading = 0 } = {}) {
    const parts = createCarMesh(color, kind);
    this.group = parts.group;
    this.wheels = parts.wheels;
    this.frontWheels = parts.frontWheels;
    this.beaconRed = parts.beaconRed;
    this.beaconBlue = parts.beaconBlue;
    this.kind = kind;
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.health = 100;
    this.driver = 'parked'; // parked | traffic | police | player
    this.maxSpeed = kind === 'sport' ? 40 : kind === 'police' ? 39 : 33;
    this.accel = kind === 'sport' ? 17 : 14;
    this.wheelSpin = 0;
    this.dead = false;
    scene.add(this.group);
  }

  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }
  get pos() { return this.group.position; }

  /** Unit forward vector for the current heading. */
  forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  /** Take damage; a wreck at 0 health stops dead and smokes (visually: darkens). */
  damage(amount) {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.dead = true;
  }

  /**
   * Advance the car one step. control = { throttle: -1..1, steer: -1..1 }.
   * world = { colliders, cars, peds, onCrash(car, intensity), onHitPed(car, ped) }.
   */
  update(dt, control, world) {
    if (this.dead) control = { throttle: 0, steer: 0 };
    const throttle = clamp(control.throttle || 0, -1, 1);
    const steerIn = clamp(control.steer || 0, -1, 1);
    if (throttle > 0) this.speed += this.accel * throttle * dt * (this.speed < 0 ? 2.2 : 1);
    else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= 30 * dt; // braking
      else this.speed += 9 * throttle * dt; // reverse
    }
    // Rolling drag and a soft top speed.
    this.speed -= this.speed * 0.35 * dt;
    if (throttle === 0) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 3.5 * dt);
    this.speed = clamp(this.speed, -11, this.maxSpeed);
    const steerAuthority = 0.52 / (1 + Math.abs(this.speed) * 0.045);
    this.steer += (steerIn * steerAuthority - this.steer) * Math.min(1, dt * 8);
    if (Math.abs(this.speed) > 0.05) {
      this.heading += (this.speed / 2.9) * Math.tan(this.steer) * dt;
    }
    const f = this.forward();
    let nx = this.x + f.x * this.speed * dt;
    let nz = this.z + f.z * this.speed * dt;

    // Buildings: slide out, and pay for the hit in speed and health.
    const resolved = collideCircle(nx, nz, 2.25, world.colliders);
    if (resolved.hit) {
      const impact = Math.abs(this.speed);
      if (impact > 5) {
        this.damage((impact - 5) * 1.6);
        if (world.onCrash) world.onCrash(this, impact);
      }
      this.speed = impact > 4 ? -this.speed * 0.22 : 0;
      nx = resolved.x;
      nz = resolved.z;
    }
    // Other cars: push apart and trade speed.
    for (const other of world.cars) {
      if (other === this) continue;
      const dx = nx - other.x;
      const dz = nz - other.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 20.3 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (4.5 - d) / 2;
      nx += (dx / d) * push;
      nz += (dz / d) * push;
      const rel = Math.abs(this.speed - other.speed);
      if (rel > 6) {
        this.damage((rel - 6) * 1.1);
        if (world.onCrash) world.onCrash(this, rel);
      }
      this.speed *= 0.72;
    }
    // Pedestrians: a fast car knocks them down; a slow one just gets in the way.
    if (world.peds && Math.abs(this.speed) > 1) {
      for (const ped of world.peds) {
        if (!ped.alive) continue;
        const dx = ped.x - nx;
        const dz = ped.z - nz;
        if (dx * dx + dz * dz < 3.2) {
          if (Math.abs(this.speed) > 4) {
            ped.knockDown(this);
            if (world.onHitPed) world.onHitPed(this, ped);
            this.speed *= 0.82;
          } else {
            ped.fleeFrom(nx, nz);
          }
        }
      }
    }
    this.group.position.x = nx;
    this.group.position.z = nz;
    this.group.rotation.y = this.heading;
    // Wheel visuals.
    this.wheelSpin += (this.speed * dt) / 0.37;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
    for (const pivot of this.frontWheels) pivot.rotation.y = this.steer * 1.15;
    // A wreck sits dark and low.
    if (this.dead) this.group.position.y = -0.06;
    return { speed: this.speed };
  }

  /** Flash a police light bar (called by the police manager each frame). */
  flashBeacons(t) {
    if (!this.beaconRed) return;
    const phase = Math.sin(t * 11) > 0;
    this.beaconRed.emissiveIntensity = phase ? 3.2 : 0.15;
    this.beaconBlue.emissiveIntensity = phase ? 0.15 : 3.2;
  }
}

/** Angle from a car toward a point, wrapped for steering. */
export function headingTo(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/** Steering input that turns a heading toward a target heading. */
export function steerToward(heading, targetHeading, gain = 1.6) {
  return clamp(angleWrap(targetHeading - heading) * gain, -1, 1);
}
