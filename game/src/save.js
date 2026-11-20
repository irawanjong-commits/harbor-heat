// save.js — the localStorage save: money, story progress, position and unlocks, so a player
// can close the tab and continue from the title screen. One key, plain JSON, no server.

const SAVE_KEY = 'harbor-heat-save-v1';

/** The fresh-game state a new player starts with. */
export function defaultSave() {
  return {
    money: 120,
    missionIndex: 0,
    storyDone: false,
    errandsDone: 0,
    hasPistol: false,
    health: 100,
    x: 6,
    z: 148,
    heading: Math.PI,
  };
}

/** Read the save, or null when there is none (or it is unreadable). */
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return { ...defaultSave(), ...parsed };
  } catch {
    return null;
  }
}

/** Write the save (best effort: storage can be unavailable in some contexts). */
export function storeSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // A private window or a full store: the game simply runs unsaved.
  }
}

/** Forget the save, for a fresh start. */
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to forget.
  }
}
