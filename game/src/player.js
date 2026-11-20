// player.js — the player character: a box-built figure with a walk cycle, an on-foot
// controller with building collision, fists and a pistol, health and regeneration.
// The same figure builder dresses every pedestrian in the city.

import * as THREE from 'three';
import { collideCircle } from './city.js';
import { angleWrap, clamp } from './rng.js';

/** Build a low-poly person; returns the group and the limbs the walk cycle swings. */
export function buildHumanoid({ shirt = 0x35c4b5, pants = 0x2f3542, skin = 0xc68863, hair = 0x201812 } = {}) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.95 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 1 });

  const legGeo = new THREE.BoxGeometry(0.3, 0.95, 0.32);
  legGeo.translate(0, -0.475, 0);
  const legL = new THREE.Group();
  legL.position.set(-0.17, 0.95, 0);
  const legLMesh = new THREE.Mesh(legGeo, pantsMat);
  legLMesh.castShadow = true;
  legL.add(legLMesh);
  group.add(legL);
  const legR = new THREE.Group();
  legR.position.set(0.17, 0.95, 0);
  const legRMesh = new THREE.Mesh(legGeo, pantsMat);
  legRMesh.castShadow = true;
  legR.add(legRMesh);
  group.add(legR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.85, 0.42), shirtMat);
  torso.position.y = 1.37;
  torso.castShadow = true;
  group.add(torso);

  const armGeo = new THREE.BoxGeometry(0.24, 0.8, 0.26);
  armGeo.translate(0, -0.36, 0);
  const armL = new THREE.Group();
  armL.position.set(-0.51, 1.74, 0);
  const armLMesh = new THREE.Mesh(armGeo, shirtMat);
  armLMesh.castShadow = true;
  armL.add(armLMesh);
  group.add(armL);
  const armR = new THREE.Group();
  armR.position.set(0.51, 1.74, 0);
  const armRMesh = new THREE.Mesh(armGeo, shirtMat);
  armRMesh.castShadow = true;
  armR.add(armRMesh);
  group.add(armR);

  const head = new THREE.Group();
  head.position.y = 1.98;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.48, 0.44), skinMat);
  skull.castShadow = true;
  head.add(skull);
  const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.48), hairMat);
  hairMesh.position.y = 0.22;
  head.add(hairMesh);
  group.add(head);

  return { group, legL, legR, armL, armR, torso, head };
}

/** The player: position, heading, health, fists and (once Rosa provides it) a pistol. */
export class Player {
  constructor(scene) {
    const parts = buildHumanoid({ shirt: 0x35c4b5, pants: 0x27324a, skin: 0xc68863, hair: 0x201812 });
    this.group = parts.group;
    this.limbs = parts;
    scene.add(this.group);
    this.heading = Math.PI;
    this.health = 100;
    this.maxHealth = 100;
    this.hasPistol = false;
    this.inCar = null;
    this.walkPhase = 0;
    this.moving = false;
    this.punchTimer = 0;
    this.punchCooldown = 0;
    this.shootCooldown = 0;
    this.sinceHurt = 99;
    this.aiming = false;
    // A simple pistol prop that appears in the right hand when the gun is out.
    this.gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.16, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x1c1e24, metalness: 0.6, roughness: 0.4 }),
    );
    this.gun.position.set(0, -0.78, 0.18);
    this.gun.visible = false;
    this.limbs.armR.add(this.gun);
  }

  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }
  get pos() { return this.group.position; }

  /** Place the player (respawns, save loading, screenshot scenes). */
  place(x, z, heading) {
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.group.rotation.y = heading;
  }

  /** Enter a car: hide the figure; the car becomes the body. */
  enterCar(car) {
    this.inCar = car;
    this.group.visible = false;
  }

  /** Leave the car beside its door. */
  exitCar() {
    if (!this.inCar) return;
    const car = this.inCar;
    this.inCar = null;
    const sideX = Math.cos(car.heading);
    const sideZ = -Math.sin(car.heading);
    this.place(car.x + sideX * 2.4, car.z + sideZ * 2.4, car.heading);
    this.group.visible = true;
  }

  /** Hurt the player; the caller decides what death means (main watches health). */
  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.sinceHurt = 0;
  }

  /**
   * Move on foot. wish = { x, z } unit wish direction in world space (or zero),
   * run = sprint. Collides with buildings and the shoreline like everything else.
   */
  update(dt, wish, run, colliders) {
    if (this.inCar) return;
    this.punchCooldown -= dt;
    this.shootCooldown -= dt;
    this.sinceHurt += dt;
    if (this.health > 0 && this.health < this.maxHealth && this.sinceHurt > 6) {
      this.health = Math.min(this.maxHealth, this.health + 6 * dt);
    }
    const hasWish = wish.x !== 0 || wish.z !== 0;
    this.moving = hasWish;
    if (hasWish) {
      const targetHeading = Math.atan2(wish.x, wish.z);
      const diff = angleWrap(targetHeading - this.heading);
      this.heading += clamp(diff, -11 * dt, 11 * dt);
      const speed = this.aiming ? 2.6 : run ? 9.6 : 5.8;
      let nx = this.x + Math.sin(this.heading) * speed * dt * (Math.abs(diff) > 2.4 ? 0.25 : 1);
      let nz = this.z + Math.cos(this.heading) * speed * dt * (Math.abs(diff) > 2.4 ? 0.25 : 1);
      const resolved = collideCircle(nx, nz, 0.55, colliders);
      nx = resolved.x;
      nz = resolved.z;
      this.group.position.x = clamp(nx, -190, 190);
      this.group.position.z = clamp(nz, -190, 250);
      this.walkPhase += dt * speed * 1.7;
    }
    // On the pier deck the feet ride higher.
    const onPier = this.x > 102 && this.x < 126 && this.z > 194 && this.z < 252;
    this.group.position.y = onPier ? 0.82 : 0;
    this.group.rotation.y = this.heading;
    // Walk cycle and combat poses.
    const swing = this.moving ? Math.sin(this.walkPhase) * 0.6 : 0;
    this.limbs.legL.rotation.x = swing;
    this.limbs.legR.rotation.x = -swing;
    if (this.punchTimer > 0) {
      this.punchTimer -= dt;
      this.limbs.armR.rotation.x = -2.3 * Math.sin((this.punchTimer / 0.22) * Math.PI);
    } else if (this.aiming) {
      this.limbs.armR.rotation.x = -1.5;
      this.limbs.armL.rotation.x = -1.35;
    } else {
      this.limbs.armL.rotation.x = -swing * 0.8;
      this.limbs.armR.rotation.x = swing * 0.8;
    }
    this.gun.visible = this.hasPistol && (this.aiming || this.punchTimer > 0);
  }

  /**
   * Throw a punch: hits the nearest pedestrian or car in front. ctx carries
   * { peds, cars, audio, onCrime(kind, x, z), onPedDown(ped) }.
   */
  tryPunch(ctx) {
    if (this.inCar || this.punchCooldown > 0) return;
    this.punchCooldown = 0.38;
    this.punchTimer = 0.22;
    if (ctx.audio) ctx.audio.punch();
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    let bestPed = null;
    let bestDist = 2.1;
    for (const ped of ctx.peds) {
      if (!ped.alive) continue;
      const dx = ped.x - this.x;
      const dz = ped.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist && dx * fx + dz * fz > 0.2) { bestPed = ped; bestDist = dist; }
    }
    if (bestPed) {
      const killed = bestPed.takeHit(45);
      if (killed) {
        ctx.onCrime('kill', this.x, this.z);
        if (ctx.onPedDown) ctx.onPedDown(bestPed);
      } else {
        ctx.onCrime('assault', this.x, this.z);
        if (Math.random() < 0.35) {
          bestPed.state = 'fight';
          bestPed.stateTimer = 6;
        } else {
          bestPed.fleeFrom(this.x, this.z);
        }
      }
      return;
    }
    for (const car of ctx.cars) {
      const dx = car.x - this.x;
      const dz = car.z - this.z;
      if (dx * dx + dz * dz < 7.3 && dx * fx + dz * fz > 0) {
        car.damage(3);
        ctx.onCrime('vandalism', this.x, this.z);
        return;
      }
    }
  }

  /**
   * Fire the pistol along the camera's aim. ctx carries { camera, peds, cars,
   * audio, onCrime, onShotImpact(x, y, z), onPedDown(ped), onCarShot(car) }.
   * Returns true when a shot was fired.
   */
  tryShoot(ctx) {
    if (this.inCar || !this.hasPistol || this.shootCooldown > 0) return false;
    this.shootCooldown = 0.26;
    this.punchTimer = 0.1;
    if (ctx.audio) ctx.audio.shot();
    ctx.onCrime('shots', this.x, this.z);
    const origin = ctx.camera.position;
    const dir = new THREE.Vector3();
    ctx.camera.getWorldDirection(dir);
    // Nearest hit among pedestrians (chest sphere) and cars (body sphere).
    let bestT = 95;
    let hitPed = null;
    let hitCar = null;
    for (const ped of ctx.peds) {
      if (!ped.alive) continue;
      const cx = ped.x - origin.x;
      const cy = 1.25 - origin.y;
      const cz = ped.z - origin.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;
      if (t < 0 || t > bestT) continue;
      const px = origin.x + dir.x * t - ped.x;
      const py = origin.y + dir.y * t - 1.25;
      const pz = origin.z + dir.z * t - ped.z;
      if (px * px + py * py + pz * pz < 0.42) { bestT = t; hitPed = ped; hitCar = null; }
    }
    for (const car of ctx.cars) {
      const cx = car.x - origin.x;
      const cy = 0.8 - origin.y;
      const cz = car.z - origin.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;
      if (t < 0 || t > bestT) continue;
      const px = origin.x + dir.x * t - car.x;
      const py = origin.y + dir.y * t - 0.8;
      const pz = origin.z + dir.z * t - car.z;
      if (px * px + py * py + pz * pz < 5.3) { bestT = t; hitCar = car; hitPed = null; }
    }
    const impact = {
      x: origin.x + dir.x * bestT,
      y: origin.y + dir.y * bestT,
      z: origin.z + dir.z * bestT,
    };
    if (ctx.onShotImpact) ctx.onShotImpact(impact, hitPed || hitCar);
    if (hitPed) {
      const killed = hitPed.takeHit(100);
      if (killed) {
        ctx.onCrime('kill', this.x, this.z);
        if (ctx.onPedDown) ctx.onPedDown(hitPed);
      }
    } else if (hitCar) {
      hitCar.damage(22);
      ctx.onCrime('vandalism', this.x, this.z);
      if (ctx.onCarShot) ctx.onCarShot(hitCar);
    }
    return true;
  }
}
