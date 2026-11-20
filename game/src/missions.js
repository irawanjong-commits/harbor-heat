// missions.js — Rosa's story: four linked jobs that teach the city (fetch, deliver,
// rescue, escape) and, once the story is done, endless paid errands. A mission is a
// list of steps; each step is a place to reach, sometimes against a clock, sometimes
// with the police forced onto the player's tail.

import { PLACES } from './city.js';

export const STORY_MISSIONS = [
  {
    id: 'welcome',
    title: 'Welcome to Porto Serena',
    intro: 'Rosa runs Bar Ondina and half the favours in this town. Start with her.',
    reward: 250,
    unlock: 'pistol',
    steps: [
      { kind: 'goto', at: PLACES.bar, label: 'Meet Rosa outside Bar Ondina', radius: 7 },
      { kind: 'pickup', at: PLACES.marina, label: "Pick up Rosa's supply crate at the marina", radius: 7 },
      { kind: 'deliver', at: PLACES.bar, label: 'Bring the crate back to Rosa', radius: 7 },
    ],
  },
  {
    id: 'hot-crate',
    title: 'Hot Crate',
    intro: 'The Hotel Marisol needs its delivery before the ice melts. Rosa is paying for speed.',
    reward: 400,
    steps: [
      { kind: 'goto', at: PLACES.bar, label: 'Pick up the job from Rosa', radius: 7 },
      { kind: 'deliver', at: PLACES.hotel, label: 'Deliver the crate to Hotel Marisol — fast', radius: 8, timeLimit: 150 },
    ],
  },
  {
    id: 'family-trouble',
    title: 'Family Trouble',
    intro: "Rosa's nephew Teo is stuck at the bus terminal, and the police know his face.",
    reward: 600,
    steps: [
      { kind: 'goto', at: PLACES.bar, label: 'Rosa is waiting — hear her out', radius: 7 },
      { kind: 'pickup', at: PLACES.terminal, label: 'Pick up Teo at the bus terminal', radius: 8, setWanted: 3 },
      { kind: 'escape', at: PLACES.safehouse, label: "Reach the cousin's garage and lie low", radius: 8 },
    ],
  },
  {
    id: 'harbor-heat',
    title: 'Harbor Heat',
    intro: 'One last job: a cash bag at the boathouse, a boat at the pier, and every cop in town.',
    reward: 1200,
    steps: [
      { kind: 'goto', at: PLACES.bar, label: 'One last favour for Rosa', radius: 7 },
      { kind: 'pickup', at: PLACES.marina, label: 'Grab the cash bag from the boathouse', radius: 7, setWanted: 4 },
      { kind: 'escape', at: PLACES.pier, label: 'Reach the escape boat at the end of the pier', radius: 6 },
    ],
  },
];

const ERRAND_SPOTS = [PLACES.hotel, PLACES.terminal, PLACES.marina, PLACES.safehouse, PLACES.bar];

/** Runs the current mission: steps, timers, rewards and failures. */
export class MissionManager {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.missionIndex = 0; // next story mission to offer
    this.storyDone = false;
    this.errandsDone = 0;
    this.current = null; // active mission definition
    this.stepIndex = 0;
    this.timer = null; // seconds left on the current step, when it has one
    this.betweenTimer = 1.2; // pause before the first/next job appears
    this.active = false;
  }

  get step() {
    return this.current ? this.current.steps[this.stepIndex] : null;
  }

  /** Where the player must go next, or null between jobs. */
  target() {
    const step = this.step;
    return step ? step.at : null;
  }

  /** The HUD's objective lines: mission title, current instruction, time left. */
  objective() {
    if (!this.current) {
      return { title: this.storyDone ? 'Porto Serena is yours' : 'Free roam', text: this.storyDone ? 'Find Rosa at Bar Ondina for paid errands.' : 'Head to Bar Ondina — Rosa has work.', timer: null };
    }
    const step = this.step;
    return {
      title: this.current.title,
      text: step ? step.label : '',
      timer: this.timer !== null ? Math.max(0, Math.ceil(this.timer)) : null,
    };
  }

  /** Begin a mission definition: reset steps, arm the first timer, announce it. */
  begin(definition) {
    this.current = definition;
    this.stepIndex = 0;
    this.active = true;
    this.armStep();
    this.onEvent('missionStart', definition);
  }

  armStep() {
    const step = this.step;
    this.timer = step && step.timeLimit ? step.timeLimit : null;
    if (step) this.onEvent('step', step);
  }

  /** Offer the next job: the next story mission, or a paid errand after the story. */
  offerNext(playerPos) {
    if (this.missionIndex < STORY_MISSIONS.length) {
      this.begin(STORY_MISSIONS[this.missionIndex]);
      return;
    }
    this.storyDone = true;
    // A repeatable errand: somewhere across town, against a generous clock.
    let spot = ERRAND_SPOTS[Math.floor(Math.random() * ERRAND_SPOTS.length)];
    if (playerPos && Math.hypot(spot.x - playerPos.x, spot.z - playerPos.z) < 60) spot = PLACES.hotel;
    const dist = playerPos ? Math.hypot(spot.x - playerPos.x, spot.z - playerPos.z) : 200;
    this.begin({
      id: 'errand',
      title: 'Errand for Rosa',
      intro: 'A little something needs moving across town.',
      reward: Math.round(120 + dist * 0.4),
      steps: [
        { kind: 'goto', at: PLACES.bar, label: 'Pick up the package from Rosa', radius: 7 },
        { kind: 'deliver', at: spot, label: `Deliver the package to ${spot.name}`, radius: 8, timeLimit: Math.round(60 + dist * 0.55) },
      ],
    });
  }

  /** Finish the current mission: pay out, advance the story, queue the next job. */
  complete(ctx) {
    const done = this.current;
    this.current = null;
    this.active = false;
    this.timer = null;
    if (done.id === 'errand') this.errandsDone += 1;
    else this.missionIndex += 1;
    if (done.unlock) ctx.player.hasPistol = true;
    if (done.id === 'harbor-heat') this.storyDone = true;
    this.betweenTimer = 3.5;
    this.onEvent('missionComplete', done);
  }

  /** Fail the current mission (the clock ran out): it will be offered again. */
  fail(ctx) {
    const failed = this.current;
    this.current = null;
    this.active = false;
    this.timer = null;
    ctx.wanted.locked = 0;
    this.betweenTimer = 3;
    this.onEvent('missionFailed', failed);
  }

  /**
   * Advance the state machine. ctx = { player, wanted } where player has x/z.
   * Step transitions fire onEvent('step' | 'pickup' | 'missionComplete' | 'missionFailed').
   */
  update(dt, ctx) {
    if (!this.current) {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) this.offerNext(ctx.player);
      return;
    }
    const step = this.step;
    if (!step) {
      this.complete(ctx);
      return;
    }
    if (this.timer !== null) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.fail(ctx);
        return;
      }
    }
    const dx = ctx.player.x - step.at.x;
    const dz = ctx.player.z - step.at.z;
    if (dx * dx + dz * dz <= step.radius * step.radius) {
      if (step.setWanted) {
        ctx.wanted.forceAtLeast(step.setWanted);
        this.onEvent('ambush', step);
      }
      if (step.kind === 'pickup') this.onEvent('pickup', step);
      if (step.kind === 'escape') ctx.wanted.clear();
      this.stepIndex += 1;
      if (this.stepIndex >= this.current.steps.length) this.complete(ctx);
      else this.armStep();
    }
  }
}
