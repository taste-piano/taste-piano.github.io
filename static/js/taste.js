"use strict";

const PROMPTS = window.TASTE_PROMPTS;

const EMOTION_COLORS = {
  happy: "#E0A526", calm: "#3E9C8F", sad: "#4F6FA8", anxious: "#8E5BB0", angry: "#C8553D",
};
const SECTION_COLORS = {
  A: "#7256b8", B: "#2b7bb9", C: "#2e8b6d", D: "#b8892b",
  E: "#b3453f", F: "#8a5aa8", G: "#3f7f96", H: "#7d7a34",
};
const SYSTEMS = [
  {key: "ar", name: "TASTE (AR)", banded: true, compare: false, container: "main-players"},
  {key: "dit", name: "TASTE (DiT)", banded: true, compare: true, container: "dit-player",
   note: "Latent diffusion variant; follows the given section plan"},
  {key: "text2midi", name: "text2midi", banded: false, compare: true, container: "baseline-players"},
  {key: "midi_llm", name: "MIDI-LLM", banded: false, compare: true, container: "baseline-players"},
];
const TAGS = [
  ["Key", "key"], ["Tempo", "tempo"], ["Emotion", "emotion"],
  ["Genre", "genre"], ["Accompaniment", "accompaniment"], ["Performance", "performance"],
];

const BAND_H = 16;
const ROLL_H = 170;
const PEDAL_H = 10;
const AXIS_H = 16;
const PEDAL_INK = "#c2601f";
const SOFT = [157, 180, 214];  // velocity 0 note colour
const LOUD = [24, 46, 92];     // velocity 127 note colour

const pieceCache = new Map();
const players = [];
let promptIndex = 0;
let lastUsed = null;
let compareOpen = false;

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function loadPiece(url) {
  if (!pieceCache.has(url)) {
    pieceCache.set(url, fetch(url).then(response => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.json();
    }));
  }
  return pieceCache.get(url);
}

function velocityColor(velocity) {
  const f = Math.min(1, velocity / 127);
  const c = SOFT.map((soft, i) => Math.round(soft + (LOUD[i] - soft) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// --- pianoroll overview ---

function draw(player) {
  const {piece, canvas, cursor, system} = player;
  const width = Math.floor(player.stack.clientWidth);
  if (width === 0) return;  // hidden (collapsed compare panel); redrawn on open
  const bandH = system.banded ? BAND_H : 0;
  const rollTop = bandH;
  const pedalTop = rollTop + ROLL_H + 2;
  const axisTop = pedalTop + PEDAL_H;
  const totalH = axisTop + AXIS_H;

  const ratio = window.devicePixelRatio || 1;
  for (const c of [canvas, cursor]) {
    c.width = Math.floor(width * ratio);
    c.height = Math.floor(totalH * ratio);
    c.style.height = `${totalH}px`;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, totalH);

  const band = piece.band;
  const planEnd = band.ends_sec.length ? band.ends_sec[band.ends_sec.length - 1] : 0;
  const duration = Math.max(1, piece.duration_sec, planEnd);
  const timeX = t => (Math.min(Math.max(t, 0), duration) / duration) * width;
  player.layout = {ratio, width, duration, totalH, bottom: axisTop};

  context.fillStyle = "#fbfcfd";
  context.fillRect(0, rollTop, width, ROLL_H);

  for (let i = 0; i < band.letters.length; i += 1) {
    const x0 = timeX(band.starts_sec[i]);
    const x1 = timeX(band.ends_sec[i]);
    const color = SECTION_COLORS[band.letters[i]] || "#6d7582";
    context.fillStyle = color;
    context.fillRect(x0, 0, Math.max(1, x1 - x0 - 1), bandH - 3);
    context.globalAlpha = 0.07;
    context.fillRect(x0, rollTop, Math.max(1, x1 - x0), ROLL_H);
    context.globalAlpha = 1;
    if (x1 - x0 > 11) {
      context.fillStyle = "#ffffff";
      context.font = "700 10px 'Noto Sans', system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(band.letters[i], (x0 + x1) / 2, (bandH - 3) / 2 + 0.5);
    }
  }
  context.strokeStyle = "rgba(90, 96, 108, 0.45)";
  context.lineWidth = 1;
  for (const b of band.boundaries_sec) {
    const x = Math.round(timeX(b)) + 0.5;
    context.beginPath();
    context.moveTo(x, rollTop);
    context.lineTo(x, rollTop + ROLL_H);
    context.stroke();
  }

  let low = 127;
  let high = 0;
  for (const note of piece.notes) {
    if (note[2] < low) low = note[2];
    if (note[2] > high) high = note[2];
  }
  low = Math.max(0, low - 2);
  high = Math.min(127, high + 2);
  const rowH = ROLL_H / (high - low + 1);
  for (const [onset, dur, pitch, velocity] of piece.notes) {
    const x0 = timeX(onset);
    context.fillStyle = velocityColor(velocity);
    context.fillRect(x0, rollTop + ROLL_H - (pitch - low + 1) * rowH,
                     Math.max(1, timeX(onset + dur) - x0), Math.max(1, rowH - 0.3));
  }
  context.strokeStyle = "#e1e4e8";
  context.strokeRect(0.5, rollTop + 0.5, width - 1, ROLL_H - 1);

  context.fillStyle = "#f2f3f5";
  context.fillRect(0, pedalTop, width, PEDAL_H);
  context.fillStyle = PEDAL_INK;
  context.globalAlpha = 0.6;
  for (const [down, up] of piece.pedal) {
    const x0 = timeX(down);
    context.fillRect(x0, pedalTop + 2, Math.max(1, timeX(up) - x0), PEDAL_H - 4);
  }
  context.globalAlpha = 1;

  context.font = "10px 'Noto Sans', system-ui, sans-serif";
  context.textBaseline = "top";
  context.fillStyle = "#7a7f88";
  const step = duration > 150 ? 60 : duration > 50 ? 30 : 10;
  for (let t = 0; t <= duration; t += step) {
    const x = timeX(t);
    context.textAlign = t === 0 ? "left" : x > width - 16 ? "right" : "center";
    context.fillText(formatTime(t), x, axisTop + 3);
  }
}

function drawCursor(player) {
  if (!player.layout || player.layout.width === 0) return;
  const {ratio, width, duration, totalH, bottom} = player.layout;
  const context = player.cursor.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, totalH);
  const time = player.audio.currentTime;
  if (!(time > 0)) return;
  const x = (Math.min(time, duration) / duration) * width;
  context.fillStyle = "rgba(20, 22, 25, 0.06)";
  context.fillRect(0, 0, x, bottom);
  context.strokeStyle = "#141619";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, bottom);
  context.stroke();
}

function updateTime(player) {
  const total = Number.isFinite(player.audio.duration) ? player.audio.duration : player.entry.audio_sec;
  player.time.textContent = `${formatTime(player.audio.currentTime)} / ${formatTime(total)}`;
}

function tick(player) {
  drawCursor(player);
  updateTime(player);
  player.frame = player.audio.paused ? null : requestAnimationFrame(() => tick(player));
}

// --- players ---

function toggle(player) {
  lastUsed = player;
  if (player.audio.paused) {
    players.forEach(other => { if (other !== player) other.audio.pause(); });
    player.audio.play();
  } else {
    player.audio.pause();
  }
}

function seekTo(player, clientX) {
  if (!player.layout) return;
  const rect = player.stack.getBoundingClientRect();
  const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  player.audio.currentTime = fraction * player.layout.duration;
  lastUsed = player;
  drawCursor(player);
  updateTime(player);
}

function buildPlayer(system, container) {
  const card = el("div", "player-card");
  const head = el("div", "player-head");
  const button = el("button", "play-button");
  button.type = "button";
  button.setAttribute("aria-label", `Play ${system.name}`);
  button.innerHTML = '<svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>'
    + '<svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>';
  const name = el("span", "player-name", system.name);
  const time = el("span", "player-time", "0:00 / 0:00");
  const midi = el("a", "midi-link", "MIDI");
  midi.title = `Download the ${system.name} MIDI file`;
  head.append(button, name, time, midi);

  const stack = el("div", "roll-stack");
  const canvas = el("canvas");
  const cursor = el("canvas", "cursor");
  stack.append(canvas, cursor);
  card.append(head);
  if (system.note) card.append(el("p", "player-note", system.note));
  card.append(stack);
  container.append(card);

  const audio = new Audio();
  audio.preload = "metadata";
  const player = {system, card, button, time, midi, stack, canvas, cursor, audio,
                  entry: null, piece: null, layout: null, frame: null};
  players.push(player);

  button.addEventListener("click", () => toggle(player));
  const onPlay = () => {
    card.classList.add("is-playing");
    button.setAttribute("aria-label", `Pause ${system.name}`);
    if (player.frame === null) player.frame = requestAnimationFrame(() => tick(player));
  };
  const onStop = () => {
    card.classList.remove("is-playing");
    button.setAttribute("aria-label", `Play ${system.name}`);
    drawCursor(player);
    updateTime(player);
  };
  player.onStop = onStop;
  audio.addEventListener("play", onPlay);
  audio.addEventListener("pause", onStop);
  audio.addEventListener("ended", onStop);
  audio.addEventListener("loadedmetadata", () => updateTime(player));
  audio.addEventListener("seeked", () => { drawCursor(player); updateTime(player); });

  stack.addEventListener("pointerdown", event => {
    stack.setPointerCapture(event.pointerId);
    player.dragging = true;
    seekTo(player, event.clientX);
  });
  stack.addEventListener("pointermove", event => {
    if (player.dragging) seekTo(player, event.clientX);
  });
  const release = () => { player.dragging = false; };
  stack.addEventListener("pointerup", release);
  stack.addEventListener("pointercancel", release);
  return player;
}

function loadPlayer(player) {
  const entry = player.entry;
  if (player.piece && player.pieceUrl === entry.piece) {
    draw(player);
    drawCursor(player);
    return;
  }
  player.card.classList.add("is-loading");
  loadPiece(entry.piece).then(piece => {
    if (player.entry !== entry) return;
    player.piece = piece;
    player.pieceUrl = entry.piece;
    player.card.classList.remove("is-loading");
    draw(player);
    drawCursor(player);
  });
}

// --- prompt selection ---

function tagChip(label, value) {
  const chip = el("span", "tag-chip");
  chip.append(el("span", "tag-label", label), el("span", "tag-value", value));
  return chip;
}

function selectPrompt(index) {
  promptIndex = index;
  const prompt = PROMPTS[index];
  players.forEach(player => player.audio.pause());

  document.querySelectorAll(".prompt-chip").forEach((chip, i) => {
    chip.classList.toggle("is-active", i === index);
    chip.setAttribute("aria-selected", String(i === index));
  });
  document.getElementById("imagery").textContent = `“${prompt.imagery}”`;
  const tags = document.getElementById("tags");
  tags.replaceChildren(...TAGS.map(([label, field]) => tagChip(label, prompt[field])));

  for (const player of players) {
    player.entry = prompt.players[player.system.key];
    player.audio.src = player.entry.audio;
    player.midi.href = player.entry.midi;
    player.midi.download = `${prompt.id}_${player.system.key}.mid`;
    // a src change drops the queued "pause" event, so reset the UI directly
    player.onStop();
    if (!player.system.compare || compareOpen) loadPlayer(player);
  }
}

function buildChips() {
  const row = document.getElementById("prompt-chips");
  PROMPTS.forEach((prompt, index) => {
    const chip = el("button", "prompt-chip");
    chip.type = "button";
    chip.setAttribute("role", "tab");
    const dot = el("span", "emotion-dot");
    dot.style.background = EMOTION_COLORS[prompt.emotion];
    dot.title = prompt.emotion;
    chip.append(dot, el("span", "", prompt.title));
    chip.addEventListener("click", () => { if (index !== promptIndex) selectPrompt(index); });
    row.append(chip);
  });
}

function setupCompareToggle() {
  const button = document.getElementById("compare-toggle");
  const panel = document.getElementById("compare-panel");
  button.addEventListener("click", () => {
    compareOpen = !compareOpen;
    panel.hidden = !compareOpen;
    button.setAttribute("aria-expanded", String(compareOpen));
    for (const player of players) {
      if (!player.system.compare) continue;
      if (compareOpen) loadPlayer(player);
      else player.audio.pause();
    }
  });
}

buildChips();
SYSTEMS.forEach(system => buildPlayer(system, document.getElementById(system.container)));
lastUsed = players[0];
setupCompareToggle();
selectPrompt(0);

function isTyping(target) {
  return target.closest("input, textarea, select, [contenteditable]") !== null;
}
document.addEventListener("keydown", event => {
  if (event.code !== "Space" || isTyping(event.target)) return;
  event.preventDefault();
  if (!event.repeat) toggle(lastUsed);
});
// Firefox activates a focused button on keyup; space is the player shortcut here
document.addEventListener("keyup", event => {
  if (event.code === "Space" && !isTyping(event.target)) event.preventDefault();
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    players.forEach(player => { if (player.piece) { draw(player); drawCursor(player); } });
  }, 80);
});
