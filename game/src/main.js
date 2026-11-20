// main.js — Harbor Heat's boot and heartbeat: builds the world, owns the game state
// (title, playing, paused, busted, wasted), reads the keyboard and mouse, runs the
// camera, connects crime to the wanted level, saves progress, and stages the four
// deterministic screenshot scenes behind ?shot=cover|drive|chase|mission.

import * as THREE from 'three';
import { buildCity, buildEnvironment, updateCity, PLACES } from './city.js';
import { Rng, angleWrap, clamp } from './rng.js';
import { Car, CAR_COLORS, steerToward } from './vehicles.js';
import { TrafficManager, PedestrianManager } from './traffic.js';
import { Player } from './player.js';
import { WantedLevel, PoliceManager } from './police.js';
import { MissionManager, STORY_MISSIONS } from './missions.js';
import { Hud } from './hud.js';
import { SoundEngine } from './audio.js';
import { defaultSave, loadSave, storeSave, clearSave } from './save.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = Number(params.get('seed') || 1) || 1;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1600);
camera.position.set(120, 40, 170);
camera.lookAt(0, 10, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- world
buildEnvironment(scene);
const city = buildCity(scene, 20240);
const gameRng = new Rng(SEED * 7919 + 13);

const player = new Player(scene);
player.place(-146, 112, -2.2);
const traffic = new TrafficManager(scene, new Rng(SEED * 31 + 7), 12);
const peds = new PedestrianManager(scene, new Rng(SEED * 57 + 3), 22);
const police = new PoliceManager(scene);
const wanted = new WantedLevel();
const hud = new Hud();
const audio = new SoundEngine();

// Parked cars along the curbs, waiting to be borrowed.
const parkedCars = [];
function spawnParkedCars() {
  const spots = [
    { x: -4, z: 132, h: 0 }, { x: 4, z: 60, h: Math.PI }, { x: -60, z: -4, h: Math.PI / 2 },
    { x: 60, z: 4, h: -Math.PI / 2 }, { x: -116, z: -4, h: Math.PI / 2 }, { x: 116, z: 4, h: -Math.PI / 2 },
    { x: -4, z: -116, h: 0 }, { x: 4, z: -60, h: Math.PI }, { x: -160, z: 60, h: 0 },
    { x: 160, z: -60, h: Math.PI }, { x: -60, z: 116, h: Math.PI / 2 }, { x: 96, z: 158, h: 0.8 },
    { x: -4, z: 20, h: 0 }, { x: -168 + 4, z: -116, h: Math.PI },
  ];
  for (const spot of spots) {
    const kind = gameRng.chance(0.2) ? 'sport' : gameRng.chance(0.15) ? 'taxi' : 'car';
    const car = new Car(scene, { color: gameRng.pick(CAR_COLORS), kind, x: spot.x, z: spot.z, heading: spot.h });
    car.driver = 'parked';
    parkedCars.push(car);
  }
}
spawnParkedCars();

function allCars() {
  const set = new Set([...traffic.cars, ...parkedCars, ...police.cars]);
  if (player.inCar) set.add(player.inCar);
  return [...set];
}

// ---------------------------------------------------------------- state
const G = {
  mode: SHOT ? 'shot' : 'title',
  money: 120,
  time: 0,
  camYaw: Math.PI,
  camPitch: 0.32,
  lastMouse: -9,
  autosave: 0,
  ramCooldown: 0,
  shotReady: false,
  shotFrames: 0,
  shotObjective: null,
  endTimer: 0,
};

const missions = new MissionManager((type, data) => {
  if (type === 'missionStart') {
    hud.showBanner(data.title, data.intro, 3.6);
  } else if (type === 'pickup') {
    audio.pickup();
    hud.showToast('Package collected');
  } else if (type === 'ambush') {
    audio.busted();
    hud.showBanner('AMBUSH!', 'The police were waiting — run!', 2.6);
  } else if (type === 'missionComplete') {
    G.money += data.reward;
    audio.missionPass();
    window.setTimeout(() => audio.cash(), 350);
    hud.showBanner('MISSION PASSED', `${data.title} · +$${data.reward}`, 3.4);
    if (data.unlock === 'pistol') hud.showToast('Rosa slipped you a pistol — hold RIGHT MOUSE to aim, CLICK to fire', 5);
    snapshot();
  } else if (type === 'missionFailed') {
    audio.missionFail();
    hud.showBanner('MISSION FAILED', 'Out of time — Rosa will offer the job again', 3);
  }
});

// Mission marker: a pillar of gold light and a ring on the ground.
const marker = new THREE.Group();
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(1.5, 1.5, 34, 12, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd94d, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
);
beam.position.y = 17;
marker.add(beam);
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(3.4, 0.16, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xffd94d }),
);
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.25;
marker.add(ring);
marker.visible = false;
scene.add(marker);

// Muzzle flash light and a reusable impact spark.
const flash = new THREE.PointLight(0xffc873, 0, 20);
scene.add(flash);
const spark = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
spark.visible = false;
scene.add(spark);
let sparkTimer = 0;

// ---------------------------------------------------------------- crime
function commitCrime(kind, x, z) {
  const nearest = police.nearestDistance(player);
  const pedNear = peds.peds.some((p) => p.alive && Math.hypot(p.x - x, p.z - z) < 22);
  const witnessed = nearest < 60 || pedNear;
  wanted.report(kind, witnessed);
  if (kind === 'kill' || kind === 'shots' || kind === 'assault' || kind === 'hitrun') {
    peds.panicAt(x, z, 20);
  }
}

const world = {
  colliders: city.colliders,
  cars: [],
  peds: peds.peds,
  onCrash(car, intensity) {
    audio.crash(intensity);
    if (car.driver === 'player') {
      if (intensity > 9) player.takeDamage((intensity - 9) * 1.3);
      if (G.ramCooldown <= 0 && police.cars.some((pc) => Math.hypot(pc.x - car.x, pc.z - car.z) < 6)) {
        G.ramCooldown = 2.5;
        commitCrime('ramPolice', car.x, car.z);
      }
    }
  },
  onHitPed(car, ped) {
    audio.thud();
    if (car.driver === 'player') commitCrime('hitrun', car.x, car.z);
  },
};

// ---------------------------------------------------------------- save
function snapshot() {
  const inCar = player.inCar;
  storeSave({
    money: G.money,
    missionIndex: missions.missionIndex,
    storyDone: missions.storyDone,
    errandsDone: missions.errandsDone,
    hasPistol: player.hasPistol,
    health: Math.round(player.health),
    x: Math.round(inCar ? inCar.x : player.x),
    z: Math.round(inCar ? inCar.z : player.z),
    heading: inCar ? inCar.heading : player.heading,
  });
}

function applySave(save) {
  G.money = save.money;
  missions.missionIndex = save.missionIndex;
  missions.storyDone = save.storyDone;
  missions.errandsDone = save.errandsDone;
  player.hasPistol = save.hasPistol;
  player.health = clamp(save.health, 25, 100);
  player.place(save.x, save.z, save.heading);
}

function startGame(fresh) {
  audio.unlock();
  if (fresh) {
    clearSave();
    const save = defaultSave();
    missions.missionIndex = 0;
    missions.storyDone = false;
    missions.errandsDone = 0;
    missions.current = null;
    missions.betweenTimer = 0.5;
    player.hasPistol = false;
    player.health = 100;
    G.money = save.money;
    player.place(-146, 112, -2.2);
  } else {
    const save = loadSave();
    if (save) applySave(save);
    missions.current = null;
    missions.betweenTimer = 0.5;
  }
  wanted.clear();
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('pause-screen').classList.add('hidden');
  hud.setVisible(true);
  G.mode = 'playing';
  renderer.domElement.requestPointerLock();
}

// ---------------------------------------------------------------- busted / wasted
const endScreen = document.getElementById('end-screen');
const endTitle = document.getElementById('end-title');
const endSub = document.getElementById('end-sub');

function endRun(kind) {
  if (G.mode !== 'playing') return;
  G.mode = 'over';
  G.endTimer = 2.8;
  document.exitPointerLock();
  audio.setEngine(false, 0);
  audio.setSiren(false);
  if (player.inCar) {
    player.inCar.driver = 'parked';
    if (!parkedCars.includes(player.inCar)) parkedCars.push(player.inCar);
    player.exitCar();
  }
  if (kind === 'busted') {
    const fine = 150 + wanted.stars * 120;
    G.money = Math.max(0, G.money - fine);
    audio.busted();
    endTitle.textContent = 'BUSTED';
    endTitle.classList.add('bad');
    endSub.textContent = `The Porto Serena PD fined you $${fine}. You walk out of the station at dawn.`;
  } else {
    const bill = 200;
    G.money = Math.max(0, G.money - bill);
    endTitle.textContent = 'WASTED';
    endTitle.classList.add('bad');
    endSub.textContent = `You wake up at Clinica del Sol with a $${bill} bill and a headache.`;
  }
  endScreen.classList.remove('hidden');
}

function respawn(kind) {
  endScreen.classList.add('hidden');
  const spot = kind === 'busted' ? PLACES.policeStation : PLACES.clinic;
  player.place(spot.x, spot.z, 0);
  player.health = 100;
  wanted.clear();
  G.mode = 'playing';
  snapshot();
  renderer.domElement.requestPointerLock();
}

// ---------------------------------------------------------------- input
const keys = new Set();
let mouseDownRight = false;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (G.mode === 'playing') {
    if (e.code === 'KeyE') toggleCar();
    if (e.code === 'KeyF') player.tryPunch(punchCtx());
    if (e.code === 'KeyP') pauseGame();
  } else if (G.mode === 'paused' && (e.code === 'KeyP' || e.code === 'Enter')) {
    resumeGame();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('click', () => {
  if (G.mode === 'playing' && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  if (G.mode === 'playing' && document.pointerLockElement !== renderer.domElement && !SHOT) {
    pauseGame();
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || G.mode !== 'playing') return;
  G.camYaw -= e.movementX * 0.0026;
  G.camPitch = clamp(G.camPitch + e.movementY * 0.0022, 0.06, 0.95);
  G.lastMouse = G.time;
});
document.addEventListener('mousedown', (e) => {
  if (G.mode !== 'playing' || player.inCar) return;
  if (e.button === 2) {
    mouseDownRight = true;
    player.aiming = player.hasPistol;
  }
  if (e.button === 0 && document.pointerLockElement === renderer.domElement) {
    if (player.hasPistol) player.tryShoot(shootCtx());
    else player.tryPunch(punchCtx());
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) {
    mouseDownRight = false;
    player.aiming = false;
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

function punchCtx() {
  return { peds: peds.peds, cars: allCars(), audio, onCrime: commitCrime, onPedDown: () => {} };
}

function shootCtx() {
  return {
    camera,
    peds: peds.peds,
    cars: allCars(),
    audio,
    onCrime: commitCrime,
    onShotImpact(impact, hit) {
      flash.position.set(player.x, 1.6, player.z);
      flash.intensity = 26;
      spark.position.set(impact.x, Math.max(0.3, impact.y), impact.z);
      spark.visible = true;
      sparkTimer = 0.09;
      if (hit) audio.thud();
    },
    onPedDown: () => {},
    onCarShot: () => {},
  };
}

function toggleCar() {
  if (player.inCar) {
    const car = player.inCar;
    if (Math.abs(car.speed) > 7) {
      hud.showToast('Too fast to jump out — slow down first');
      return;
    }
    car.driver = 'parked';
    if (!parkedCars.includes(car) && !police.cars.includes(car)) parkedCars.push(car);
    player.exitCar();
    audio.setEngine(false, 0);
    audio.click();
    return;
  }
  let best = null;
  let bestDist = 3.6;
  for (const car of allCars()) {
    if (car.dead || car.driver === 'police') continue;
    const d = Math.hypot(car.x - player.x, car.z - player.z);
    if (d < bestDist) { best = car; bestDist = d; }
  }
  if (!best) return;
  const wasTraffic = best.driver === 'traffic';
  best.driver = 'player';
  player.enterCar(best);
  G.camYaw = best.heading;
  audio.click();
  if (wasTraffic) {
    commitCrime('steal', best.x, best.z);
    hud.showToast('Car stolen!');
  }
}

function pauseGame() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused';
  snapshot();
  document.exitPointerLock();
  document.getElementById('pause-screen').classList.remove('hidden');
  audio.setEngine(false, 0);
  audio.setSiren(false);
}

function resumeGame() {
  document.getElementById('pause-screen').classList.add('hidden');
  G.mode = 'playing';
  renderer.domElement.requestPointerLock();
}

document.getElementById('btn-new').addEventListener('click', () => startGame(true));
document.getElementById('btn-continue').addEventListener('click', () => startGame(false));
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-quit-title').addEventListener('click', () => {
  snapshot();
  document.getElementById('pause-screen').classList.add('hidden');
  document.getElementById('title-screen').classList.remove('hidden');
  hud.setVisible(false);
  G.mode = 'title';
});
if (!loadSave()) document.getElementById('btn-continue').style.display = 'none';
window.addEventListener('beforeunload', () => { if (G.mode === 'playing') snapshot(); });

// ---------------------------------------------------------------- per-frame updates
function wishDirection() {
  const f = { x: Math.sin(G.camYaw), z: Math.cos(G.camYaw) };
  const r = { x: -f.z, z: f.x };
  let x = 0;
  let z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) { x += f.x; z += f.z; }
  if (keys.has('KeyS') || keys.has('ArrowDown')) { x -= f.x; z -= f.z; }
  if (keys.has('KeyD') || keys.has('ArrowRight')) { x += r.x; z += r.z; }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { x -= r.x; z -= r.z; }
  const len = Math.hypot(x, z);
  if (len > 0) { x /= len; z /= len; }
  return { x, z };
}

function carControl() {
  let throttle = 0;
  let steer = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steer += 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) steer -= 1;
  return { throttle, steer };
}

function updateWorld(dt, control) {
  world.cars = allCars();
  G.ramCooldown -= dt;
  // The player, walking or driving.
  if (player.inCar) {
    const car = player.inCar;
    car.update(dt, control.car, world);
    if (control.handbrake) car.speed -= car.speed * 2.6 * dt;
    player.group.position.set(car.x, 0, car.z);
    player.heading = car.heading;
    if (car.dead) {
      hud.showToast('Your ride is wrecked!');
      car.driver = 'parked';
      if (!parkedCars.includes(car)) parkedCars.push(car);
      player.exitCar();
    }
  } else {
    player.update(dt, control.wish, control.run, city.colliders);
  }
  traffic.update(dt, world);
  police.update(dt, { player, wanted, world, t: G.time });
  peds.update(dt, {
    playerX: player.x,
    playerZ: player.z,
    colliders: city.colliders,
    onPunchPlayer: () => { player.takeDamage(6); audio.punch(); },
  });
  missions.update(dt, { player, wanted });
  // Wanted heat, bust meter and consequences.
  if (G.mode === 'playing' || G.mode === 'shot') {
    wanted.update(dt, {
      nearestPolice: police.nearestDistance(player),
      playerSpeed: player.inCar ? Math.abs(player.inCar.speed) : player.moving ? 5 : 0,
      inCar: Boolean(player.inCar),
      onBusted: () => endRun('busted'),
    });
    if (player.health <= 0) endRun('wasted');
  }
  // Marker on the current objective.
  const target = missions.target();
  if (target && G.mode !== 'title') {
    marker.visible = true;
    marker.position.set(target.x, 0, target.z);
    ring.scale.setScalar(1 + Math.sin(G.time * 4) * 0.08);
  } else {
    marker.visible = false;
  }
  // Prompt for the nearest stealable car.
  if (G.mode === 'playing' && !player.inCar) {
    let near = false;
    for (const car of world.cars) {
      if (car.dead || car.driver === 'police') continue;
      if (Math.hypot(car.x - player.x, car.z - player.z) < 3.6) { near = true; break; }
    }
    hud.setPrompt(near ? '<b>E</b> — steal the car' : null);
  } else if (G.mode === 'playing' && player.inCar) {
    hud.setPrompt(Math.abs(player.inCar.speed) < 7 ? '<b>E</b> — get out' : null);
  }
  // Sound that follows the action.
  const nearest = police.nearestDistance(player);
  audio.setSiren(wanted.stars > 0 && nearest < 75 && G.mode === 'playing');
  if (player.inCar && G.mode === 'playing') audio.setEngine(true, Math.abs(player.inCar.speed) / player.inCar.maxSpeed);
  else audio.setEngine(false, 0);
  // Effects decay.
  if (flash.intensity > 0) flash.intensity = Math.max(0, flash.intensity - dt * 260);
  if (sparkTimer > 0) {
    sparkTimer -= dt;
    if (sparkTimer <= 0) spark.visible = false;
  }
  updateCity(city, G.time);
}

function updateCamera(dt) {
  if (G.mode === 'title') {
    const a = G.time * 0.045;
    camera.position.set(Math.sin(a) * 150, 44, Math.cos(a) * 150);
    camera.lookAt(0, 6, 0);
    return;
  }
  if (SHOT === 'cover') {
    camera.position.set(118, 11, 10);
    camera.lookAt(-90, 13, -8);
    return;
  }
  const focus = player.inCar
    ? { x: player.inCar.x, y: 1.2, z: player.inCar.z }
    : { x: player.x, y: 1.55, z: player.z };
  if (player.inCar && G.time - G.lastMouse > 2.2) {
    // Drift back behind the car when the mouse is idle.
    const diff = angleWrap(player.inCar.heading - G.camYaw);
    G.camYaw += diff * Math.min(1, dt * 1.6);
  }
  const dist = player.inCar ? 10.5 : player.aiming ? 4.4 : 7.6;
  const height = player.inCar ? 3.8 : 2.1 + G.camPitch * 3.4;
  const back = { x: Math.sin(G.camYaw), z: Math.cos(G.camYaw) };
  const desired = {
    x: focus.x - back.x * dist,
    y: focus.y + height,
    z: focus.z - back.z * dist,
  };
  const k = 1 - Math.exp(-dt * 9);
  camera.position.x += (desired.x - camera.position.x) * k;
  camera.position.y += (desired.y - camera.position.y) * k;
  camera.position.z += (desired.z - camera.position.z) * k;
  if (camera.position.y < 0.7) camera.position.y = 0.7;
  camera.lookAt(focus.x + back.x * 3, focus.y + 0.4, focus.z + back.z * 3);
}

function hudState() {
  const obj = missions.objective();
  const target = missions.target();
  if (G.shotObjective) return { ...baseHud(), objective: G.shotObjective, target: G.shotObjective.target || target };
  if (target) {
    const d = Math.round(Math.hypot(target.x - player.x, target.z - player.z));
    obj.text = `${obj.text} · ${d}m`;
  }
  return { ...baseHud(), objective: obj, target };
}

function baseHud() {
  return {
    player,
    money: G.money,
    wanted,
    cars: traffic.cars,
    police: police.cars,
    peds: peds.peds,
    t: G.time,
  };
}

// ---------------------------------------------------------------- screenshot scenes
function stageShot() {
  hud.setVisible(true);
  document.getElementById('title-screen').classList.add('hidden');
  const settle = (steps, drive) => {
    for (let i = 0; i < steps; i += 1) {
      G.time += 1 / 30;
      const control = drive ? drive(i) : { wish: { x: 0, z: 0 }, run: false, car: { throttle: 0, steer: 0 }, handbrake: false };
      updateWorld(1 / 30, control);
      updateCamera(1 / 30);
    }
  };
  if (SHOT === 'cover') {
    document.getElementById('title-screen').classList.remove('hidden');
    hud.setVisible(false);
    missions.betweenTimer = 9999;
    player.place(28, -7, -Math.PI / 2);
    settle(70, null);
  } else if (SHOT === 'drive') {
    const car = new Car(scene, { color: 0x35c4b5, kind: 'sport', x: -2, z: 104, heading: Math.PI });
    car.driver = 'player';
    car.speed = 17;
    parkedCars.push(car);
    player.enterCar(car);
    player.hasPistol = true;
    G.money = 860;
    missions.begin(STORY_MISSIONS[1]);
    missions.stepIndex = 1;
    missions.armStep();
    hud.bannerTimer = 0;
    hud.el.banner.style.opacity = '0';
    G.camYaw = Math.PI;
    settle(34, () => ({ wish: { x: 0, z: 0 }, run: false, car: { throttle: 0.65, steer: steerToward(car.heading, Math.PI, 1.4) }, handbrake: false }));
    G.camYaw = car.heading;
    updateCamera(0.5);
  } else if (SHOT === 'chase') {
    const car = new Car(scene, { color: 0xd64541, kind: 'sport', x: -52, z: 44, heading: Math.PI });
    car.driver = 'player';
    car.speed = 19;
    parkedCars.push(car);
    player.enterCar(car);
    player.hasPistol = true;
    G.money = 1240;
    wanted.heat = 4.3;
    const copSpots = [
      { x: -55.8, z: 47, h: Math.PI, s: 19 }, { x: -48.4, z: 55, h: Math.PI, s: 18 }, { x: -58, z: 16, h: Math.PI, s: 16 },
    ];
    for (const spot of copSpots) {
      const cop = new Car(scene, { color: 0xf2f2f2, kind: 'police', x: spot.x, z: spot.z, heading: spot.h });
      cop.driver = 'police';
      cop.speed = spot.s;
      police.cars.push(cop);
    }
    G.shotObjective = { title: 'Porto Serena PD', text: 'LOSE THE COPS — break away and lie low', timer: null, target: null };
    missions.betweenTimer = 9999;
    G.camYaw = Math.PI;
    settle(26, () => ({ wish: { x: 0, z: 0 }, run: false, car: { throttle: 0.85, steer: steerToward(car.heading, Math.PI, 1.4) }, handbrake: false }));
    G.camYaw = car.heading;
    updateCamera(0.5);
  } else if (SHOT === 'mission') {
    player.place(108.5, 169.5, 0.72);
    player.hasPistol = true;
    player.aiming = true;
    G.money = 375;
    missions.begin(STORY_MISSIONS[0]);
    missions.stepIndex = 1;
    missions.armStep();
    hud.bannerTimer = 0;
    hud.el.banner.style.opacity = '0';
    G.camYaw = 0.72;
    settle(24, null);
    updateCamera(0.6);
  }
}

// ---------------------------------------------------------------- boot and loop
if (SHOT) stageShot();
else hud.setVisible(false);

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (G.mode === 'over') {
    G.endTimer -= dt;
    if (G.endTimer <= 0) respawn(endTitle.textContent === 'BUSTED' ? 'busted' : 'wasted');
  }
  if (G.mode === 'playing') {
    G.time += dt;
    const control = player.inCar
      ? { wish: { x: 0, z: 0 }, run: false, car: carControl(), handbrake: keys.has('Space') }
      : { wish: wishDirection(), run: keys.has('ShiftLeft') || keys.has('ShiftRight'), car: { throttle: 0, steer: 0 }, handbrake: false };
    updateWorld(dt, control);
    updateCamera(dt);
    hud.update(dt, hudState());
    G.autosave += dt;
    if (G.autosave > 15) {
      G.autosave = 0;
      snapshot();
    }
  } else if (G.mode === 'title') {
    G.time += dt;
    traffic.update(dt, { ...world, cars: allCars() });
    updateCity(city, G.time);
    updateCamera(dt);
  } else if (G.mode === 'shot') {
    if (!G.shotReady) {
      G.time += dt;
      renderer.render(scene, camera);
      G.shotFrames += 1;
      if (G.shotFrames > 14) {
        G.shotReady = true;
        window.__shotReady = true;
      }
      hud.update(0.016, hudState());
      return;
    }
  }
  renderer.render(scene, camera);
}
frame();
