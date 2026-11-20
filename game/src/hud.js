// hud.js — everything drawn over the 3D view: health, money and wanted stars, the
// mission objective panel, prompts and banners, and the live minimap on a 2D canvas
// (roads, water, traffic, police, the player and the mission marker).

import { ROAD_LINES, SHORE_Z } from './city.js';

const MAP_SIZE = 190;
const MAP_MIN = -196;
const MAP_SPAN = 452; // x: -196..196 and z: -196..256 share one scale

function mapX(x) {
  return ((x - MAP_MIN) / MAP_SPAN) * MAP_SIZE;
}

function mapY(z) {
  return ((z - MAP_MIN) / MAP_SPAN) * MAP_SIZE;
}

/** The heads-up display: owns the DOM nodes index.html declares and the minimap. */
export class Hud {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      healthFill: document.getElementById('health-fill'),
      healthText: document.getElementById('health-text'),
      money: document.getElementById('money'),
      stars: document.getElementById('stars'),
      objectiveTitle: document.getElementById('objective-title'),
      objectiveText: document.getElementById('objective-text'),
      objectiveTimer: document.getElementById('objective-timer'),
      prompt: document.getElementById('prompt'),
      banner: document.getElementById('banner'),
      bannerTitle: document.getElementById('banner-title'),
      bannerSub: document.getElementById('banner-sub'),
      toast: document.getElementById('toast'),
      bustWrap: document.getElementById('bust-wrap'),
      bustFill: document.getElementById('bust-fill'),
      speed: document.getElementById('speed'),
      crosshair: document.getElementById('crosshair'),
      minimap: document.getElementById('minimap'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.lastStars = -1;
    this.lastMoney = null;
  }

  /** Show or hide the whole in-game layer (title screen and shot scenes differ). */
  setVisible(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
  }

  /** A big centre banner: mission titles, BUSTED, WASTED, story beats. */
  showBanner(title, sub = '', seconds = 3) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.style.opacity = '1';
    this.bannerTimer = seconds;
  }

  /** A small message under the banner: payments, pickups, warnings. */
  showToast(text, seconds = 2.6) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = '1';
    this.toastTimer = seconds;
  }

  /** The contextual key prompt at the bottom centre ("E — steal the car"). */
  setPrompt(text) {
    if (text) {
      this.el.prompt.textContent = text;
      this.el.prompt.style.opacity = '1';
    } else {
      this.el.prompt.style.opacity = '0';
    }
  }

  /** Per-frame refresh. state = { player, money, wanted, objective, cars, police, peds, target, t } */
  update(dt, state) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.style.opacity = '0';
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.style.opacity = '0';
    }
    const healthPct = Math.max(0, Math.round(state.player.health));
    this.el.healthFill.style.width = `${healthPct}%`;
    this.el.healthFill.style.background = healthPct > 35 ? '#53d769' : '#ff5040';
    this.el.healthText.textContent = `${healthPct}`;
    if (state.money !== this.lastMoney) {
      this.lastMoney = state.money;
      this.el.money.textContent = `$${state.money.toLocaleString('en-US')}`;
    }
    const stars = state.wanted.stars;
    if (stars !== this.lastStars) {
      this.lastStars = stars;
      this.el.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
      this.el.stars.style.color = stars > 0 ? '#ffd94d' : 'rgba(255,255,255,0.25)';
    }
    const obj = state.objective;
    this.el.objectiveTitle.textContent = obj.title;
    this.el.objectiveText.textContent = obj.text;
    this.el.objectiveTimer.textContent = obj.timer !== null && obj.timer !== undefined ? `⏱ ${obj.timer}s` : '';
    // Bust meter.
    const bust = state.wanted.bustMeter;
    this.el.bustWrap.style.opacity = bust > 0.02 ? '1' : '0';
    this.el.bustFill.style.width = `${Math.round(bust * 100)}%`;
    // Speed while driving.
    if (state.player.inCar) {
      const kmh = Math.round(Math.abs(state.player.inCar.speed) * 3.2);
      this.el.speed.textContent = `${kmh} km/h`;
      this.el.speed.style.opacity = '1';
    } else {
      this.el.speed.style.opacity = '0';
    }
    this.el.crosshair.style.opacity = state.player.aiming ? '1' : '0';
    this.drawMinimap(state);
  }

  /** The minimap: whole city, north up, the player always centred in attention. */
  drawMinimap(state) {
    const ctx = this.mapCtx;
    const t = state.t;
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    // Water and beach.
    ctx.fillStyle = '#1d6f8e';
    ctx.fillRect(0, mapY(SHORE_Z), MAP_SIZE, MAP_SIZE - mapY(SHORE_Z));
    ctx.fillStyle = '#c9ab72';
    ctx.fillRect(0, mapY(178), MAP_SIZE, mapY(SHORE_Z) - mapY(178));
    // Roads.
    ctx.strokeStyle = '#4a5058';
    ctx.lineWidth = 3;
    for (const c of ROAD_LINES) {
      ctx.beginPath();
      ctx.moveTo(mapX(c), mapY(-186));
      ctx.lineTo(mapX(c), mapY(186));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mapX(-186), mapY(c));
      ctx.lineTo(mapX(186), mapY(c));
      ctx.stroke();
    }
    // Traffic.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const car of state.cars) {
      ctx.fillRect(mapX(car.x) - 1.5, mapY(car.z) - 1.5, 3, 3);
    }
    // Police, flashing.
    const flash = Math.sin(t * 10) > 0;
    ctx.fillStyle = flash ? '#ff4444' : '#4488ff';
    for (const car of state.police) {
      ctx.beginPath();
      ctx.arc(mapX(car.x), mapY(car.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mission target, pulsing gold.
    if (state.target) {
      const pulse = 4.5 + Math.sin(t * 5) * 1.6;
      ctx.strokeStyle = '#ffd94d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mapX(state.target.x), mapY(state.target.z), pulse + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd94d';
      ctx.beginPath();
      ctx.arc(mapX(state.target.x), mapY(state.target.z), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player: a white arrow on foot, a white wedge in a car.
    const p = state.player;
    ctx.save();
    ctx.translate(mapX(p.x), mapY(p.z));
    ctx.rotate(Math.PI - (p.inCar ? p.inCar.heading : p.heading));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(3.6, 4.4);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-3.6, 4.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Frame.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, MAP_SIZE - 2, MAP_SIZE - 2);
  }
}
