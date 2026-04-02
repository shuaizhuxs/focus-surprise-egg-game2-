const canonicalPuppyReward = { id: "puppy", name: "小狗", image: "assets/rewards/chihuahua.png" };

const rewards = [
  canonicalPuppyReward,
  { id: "dog-food", name: "狗粮", icon: "🥣" },
  { id: "bone", name: "小骨头", icon: "🦴" },
  { id: "toy", name: "小玩具", icon: "🎾" },
  { id: "collar", name: "项圈", icon: "🦮" },
  { id: "star-badge", name: "星星徽章", icon: "⭐" }
];

const rewardsById = new Map(rewards.map((reward) => [reward.id, reward]));
const rewardsByName = new Map(rewards.map((reward) => [reward.name, reward]));

const missions = ["完成 3 题", "读 1 页", "写 2 句", "整理桌面", "收拾书包"];

const milestoneMessages = {
  start: "孵化任务",
  quarter: "继续加油",
  half: "已经一半了",
  almost: "快完成啦",
  done: "你获得了新奖励",
  earlyExit: "任务没有完成，惊喜蛋没有打开"
};

const rewardStorageKey = "focus-egg-friend-rewards";
const soundStorageKey = "focus-egg-friend-sound";

const appCardEl = document.getElementById("app-card");
const timerEl = document.getElementById("timer");
const progressFillEl = document.getElementById("progress-fill");
const progressTrackEl = document.getElementById("progress-track");
const encouragementEl = document.getElementById("encouragement");
const eggShellEl = document.getElementById("egg-shell");
const eggGlowRingEl = document.getElementById("egg-glow-ring");
const rewardCardEl = document.getElementById("reward-card");
const rewardIconEl = document.getElementById("reward-icon");
const rewardNameEl = document.getElementById("reward-name");
const confirmPanelEl = document.getElementById("confirm-panel");
const collectionPanelEl = document.getElementById("collection-panel");
const collectionGridEl = document.getElementById("collection-grid");
const missionButtonsEl = document.getElementById("mission-buttons");
const startButtonEl = document.getElementById("start-button");
const resetButtonEl = document.getElementById("reset-button");
const againButtonEl = document.getElementById("again-button");
const exitButtonEl = document.getElementById("exit-button");
const continueButtonEl = document.getElementById("continue-button");
const confirmExitButtonEl = document.getElementById("confirm-exit-button");
const soundButtonEl = document.getElementById("sound-button");
const customTimeRowEl = document.getElementById("custom-time-row");
const customTimeInputEl = document.getElementById("custom-time-input");
const customTimeApplyEl = document.getElementById("custom-time-apply");
const customMissionRowEl = document.getElementById("custom-mission-row");
const customMissionInputEl = document.getElementById("custom-mission-input");
const customMissionApplyEl = document.getElementById("custom-mission-apply");
const durationButtons = Array.from(document.querySelectorAll(".choice-button[data-minutes]"));

let selectedMinutes = 3;
let selectedMission = missions[0];
let totalSeconds = selectedMinutes * 60;
let remainingSeconds = totalSeconds;
let timerId = null;
let reachedMilestones = new Set();
let soundEnabled = loadSoundPreference();
let audioContext = null;
let pendingExitConfirmation = false;
let audioReady = false;
let needsAudioResume = soundEnabled;
let audioUnlockPromise = null;
let queuedSoundKinds = [];
const fallbackSoundSources = new Map();
const fallbackAudioSupported = typeof Audio !== "undefined";

const soundRecipes = {
  click: [{ frequency: 520, duration: 0.08, volume: 0.03, type: "triangle" }],
  start: [
    { frequency: 392, duration: 0.14, volume: 0.035, type: "sine" },
    { frequency: 494, duration: 0.18, volume: 0.03, type: "sine", delay: 0.08 }
  ],
  milestone: [{ frequency: 620, duration: 0.1, volume: 0.025, type: "triangle" }],
  reward: [
    { frequency: 523, duration: 0.16, volume: 0.04, type: "sine" },
    { frequency: 659, duration: 0.18, volume: 0.035, type: "sine", delay: 0.08 },
    { frequency: 784, duration: 0.24, volume: 0.03, type: "triangle", delay: 0.16 }
  ],
  __warmup: [{ frequency: 440, duration: 0.01, volume: 0.0001, type: "sine" }]
};

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function setMessage(text) {
  encouragementEl.textContent = text;
}

function normalizeRewardText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function createStoredReward(reward, earnedAt) {
  return earnedAt ? { ...reward, earnedAt } : { ...reward };
}

function isLegacyPuppyReward(entry) {
  const dogAliases = new Set([
    "puppy",
    "dog",
    "chihuahua",
    "black chihuahua",
    "white chihuahua",
    "tiny chihuahua",
    "brown chihuahua",
    "cream chihuahua",
    "long-hair chihuahua",
    "long hair chihuahua",
    "小狗",
    "吉娃娃"
  ]);

  const values = [entry.id, entry.name, entry.icon, entry.image]
    .map((value) => normalizeRewardText(value))
    .filter(Boolean);

  return values.some((value) => dogAliases.has(value) || value.includes("chihuahua"));
}

function normalizeStoredReward(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const earnedAt = typeof entry.earnedAt === "string" ? entry.earnedAt : undefined;

  if (isLegacyPuppyReward(entry)) {
    return createStoredReward(canonicalPuppyReward, earnedAt);
  }

  const normalizedId = normalizeRewardText(entry.id);
  if (normalizedId === "item") {
    return null;
  }

  if (rewardsById.has(normalizedId)) {
    return createStoredReward(rewardsById.get(normalizedId), earnedAt);
  }

  const normalizedName = typeof entry.name === "string" ? entry.name.trim() : "";
  if (rewardsByName.has(normalizedName)) {
    return createStoredReward(rewardsByName.get(normalizedName), earnedAt);
  }

  return null;
}

function normalizeCollection(collection) {
  return collection
    .map((entry) => normalizeStoredReward(entry))
    .filter(Boolean);
}

function getCanonicalReward(reward, earnedAt) {
  return normalizeStoredReward(earnedAt ? { ...reward, earnedAt } : reward);
}

function renderRewardVisual(container, reward, options = {}) {
  const { imageClassName = "", emojiClassName = "" } = options;
  container.replaceChildren();
  container.classList.toggle("has-image", Boolean(reward.image));

  if (reward.image) {
    const image = document.createElement("img");
    image.src = reward.image;
    image.alt = reward.name;
    image.className = imageClassName;
    container.appendChild(image);
    return;
  }

  const emoji = document.createElement("span");
  emoji.textContent = reward.icon || "";
  if (emojiClassName) {
    emoji.className = emojiClassName;
  }
  container.appendChild(emoji);
}

function loadCollection() {
  const saved = localStorage.getItem(rewardStorageKey);

  if (!saved) {
    return [];
  }

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalizedCollection = normalizeCollection(parsed);
    if (JSON.stringify(normalizedCollection) !== JSON.stringify(parsed)) {
      saveCollection(normalizedCollection);
    }

    return normalizedCollection;
  } catch {
    return [];
  }
}

function saveCollection(collection) {
  localStorage.setItem(rewardStorageKey, JSON.stringify(collection));
}

function loadSoundPreference() {
  const saved = localStorage.getItem(soundStorageKey);
  return saved !== "off";
}

function saveSoundPreference() {
  localStorage.setItem(soundStorageKey, soundEnabled ? "on" : "off");
}

function updateSoundButton() {
  const label = !soundEnabled ? "声音关" : needsAudioResume || !audioReady ? "点一下恢复声音" : "声音开";
  soundButtonEl.textContent = label;
  soundButtonEl.setAttribute("aria-label", label);
}

function getAudioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function handleAudioContextStateChange() {
  if (!soundEnabled) {
    return;
  }

  if (!audioContext) {
    audioReady = fallbackAudioSupported;
    needsAudioResume = !audioReady;
    updateSoundButton();
    return;
  }

  if (audioContext.state === "running") {
    audioReady = true;
    needsAudioResume = false;
    updateSoundButton();
    flushQueuedSounds();
    return;
  }

  if (audioContext.state === "suspended" || audioContext.state === "interrupted") {
    audioReady = false;
    needsAudioResume = true;
    updateSoundButton();
    return;
  }

  if (audioContext.state === "closed") {
    audioReady = fallbackAudioSupported;
    needsAudioResume = !audioReady;
    updateSoundButton();
  }
}

function ensureAudioContext() {
  if (!soundEnabled || audioContext) {
    return audioContext;
  }

  const Context = getAudioContextConstructor();
  if (!Context) {
    return null;
  }

  audioContext = new Context();
  audioContext.onstatechange = handleAudioContextStateChange;
  handleAudioContextStateChange();
  return audioContext;
}

function playToneSequenceWithContext(sequence, context) {
  sequence.forEach(({ frequency, duration, volume, type = "sine", delay = 0 }) => {
    const start = context.currentTime + delay;
    const end = start + duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  });
}

function getSoundSequence(kind) {
  return soundRecipes[kind] || [];
}

function waveSample(type, progress) {
  if (type === "triangle") {
    return 1 - 4 * Math.abs(Math.round(progress - 0.25) - (progress - 0.25));
  }

  if (type === "square") {
    return progress < 0.5 ? 1 : -1;
  }

  return Math.sin(progress * Math.PI * 2);
}

function createWaveFileDataUri(kind) {
  const sequence = getSoundSequence(kind);
  const sampleRate = 22050;
  const totalDuration = sequence.reduce((max, tone) => Math.max(max, (tone.delay || 0) + tone.duration + 0.04), 0.08);
  const totalSamples = Math.max(1, Math.ceil(totalDuration * sampleRate));
  const pcm = new Int16Array(totalSamples);

  sequence.forEach(({ frequency, duration, volume, type = "sine", delay = 0 }) => {
    const startSample = Math.floor(delay * sampleRate);
    const endSample = Math.min(totalSamples, Math.ceil((delay + duration) * sampleRate));

    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
      const elapsed = (sampleIndex - startSample) / sampleRate;
      const toneProgress = elapsed / duration;
      const envelope = Math.sin(Math.min(1, toneProgress) * Math.PI);
      const sample = waveSample(type, elapsed * frequency) * volume * envelope;
      const nextValue = pcm[sampleIndex] + sample * 32767;
      pcm[sampleIndex] = Math.max(-32768, Math.min(32767, nextValue));
    }
  });

  const byteLength = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + byteLength);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + byteLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, byteLength, true);

  pcm.forEach((sample, index) => {
    view.setInt16(44 + index * 2, sample, true);
  });

  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });

  return `data:audio/wav;base64,${window.btoa(binary)}`;
}

function getFallbackSoundSource(kind) {
  if (!fallbackSoundSources.has(kind)) {
    fallbackSoundSources.set(kind, createWaveFileDataUri(kind));
  }

  return fallbackSoundSources.get(kind);
}

async function playFallbackSound(kind, volume = 1) {
  if (!fallbackAudioSupported) {
    return false;
  }

  try {
    const audio = new Audio(getFallbackSoundSource(kind));
    audio.volume = volume;
    audio.preload = "auto";
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      await playPromise;
    }
    return true;
  } catch {
    return false;
  }
}

function enqueueSound(kind) {
  if (queuedSoundKinds.length >= 8) {
    queuedSoundKinds.shift();
  }
  queuedSoundKinds.push(kind);
}

async function playSoundNow(kind) {
  if (!soundEnabled) {
    return false;
  }

  const context = ensureAudioContext();
  if (context && context.state === "running") {
    playToneSequenceWithContext(getSoundSequence(kind), context);
    return true;
  }

  return playFallbackSound(kind);
}

async function warmupAudio() {
  const context = ensureAudioContext();

  if (context) {
    try {
      await context.resume();
      playToneSequenceWithContext(getSoundSequence("__warmup"), context);
      handleAudioContextStateChange();
      if (context.state === "running") {
        return true;
      }
    } catch {
      needsAudioResume = true;
    }
  }

  const fallbackReady = await playFallbackSound("__warmup", 0);
  if (fallbackReady) {
    audioReady = true;
    needsAudioResume = false;
    updateSoundButton();
  }
  return fallbackReady;
}

function flushQueuedSounds() {
  if (!soundEnabled || !audioReady || needsAudioResume || queuedSoundKinds.length === 0) {
    return;
  }

  const pending = [...queuedSoundKinds];
  queuedSoundKinds = [];
  pending.forEach((kind, index) => {
    window.setTimeout(() => {
      void playSoundNow(kind);
    }, index * 30);
  });
}

async function unlockAudioFromGesture() {
  if (!soundEnabled) {
    return false;
  }

  if (audioUnlockPromise) {
    return audioUnlockPromise;
  }

  audioUnlockPromise = (async () => {
    const unlocked = await warmupAudio();
    if (!unlocked) {
      audioReady = false;
      needsAudioResume = true;
      updateSoundButton();
      return false;
    }

    audioReady = true;
    needsAudioResume = false;
    updateSoundButton();
    flushQueuedSounds();
    return true;
  })();

  try {
    return await audioUnlockPromise;
  } finally {
    audioUnlockPromise = null;
  }
}

function markAudioAsNeedingResume() {
  if (!soundEnabled) {
    return;
  }

  if (audioContext || fallbackAudioSupported) {
    audioReady = false;
    needsAudioResume = true;
    updateSoundButton();
  }
}

function safePlaySound(kind) {
  if (!soundEnabled) {
    return;
  }

  if (!audioReady || needsAudioResume) {
    enqueueSound(kind);
    updateSoundButton();
    return;
  }

  void playSoundNow(kind).then((played) => {
    if (!played) {
      enqueueSound(kind);
      audioReady = false;
      needsAudioResume = true;
      updateSoundButton();
    }
  });
}

function playSound(kind) {
  safePlaySound(kind);
}

function renderCollection() {
  const collection = loadCollection();
  collectionGridEl.innerHTML = "";

  if (collection.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "collection-empty";
    emptyState.textContent = "完成一次任务，就会收到奖励。";
    collectionGridEl.appendChild(emptyState);
    return;
  }

  collection.forEach((reward) => {
    const item = document.createElement("article");
    item.className = "collection-item";
    const icon = document.createElement("div");
    icon.className = "collection-item-icon";
    icon.setAttribute("aria-hidden", "true");
    renderRewardVisual(icon, reward, {
      imageClassName: "collection-item-image",
      emojiClassName: "collection-item-emoji"
    });

    const name = document.createElement("div");
    name.className = "collection-item-name";
    name.textContent = reward.name;

    item.append(icon, name);
    collectionGridEl.appendChild(item);
  });
}

function renderMissionButtons() {
  missionButtonsEl.innerHTML = "";

  [...missions, "自定义"].forEach((mission, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `choice-button${index === 0 ? " is-selected" : ""}`;
    button.textContent = mission;
    button.dataset.mission = mission === "自定义" ? "custom" : mission;
    button.addEventListener("click", () => {
      if (timerId) {
        return;
      }

      playSound("click");

      if (button.dataset.mission === "custom") {
        customMissionRowEl.hidden = false;
        customMissionInputEl.focus();
        selectedMission = customMissionInputEl.value.trim() || "自定义任务";
      } else {
        customMissionRowEl.hidden = true;
        selectedMission = mission;
      }

      updateMissionSelection();
      setMessage(selectedMission);
    });
    missionButtonsEl.appendChild(button);
  });
}

function updateMissionSelection() {
  const buttons = Array.from(missionButtonsEl.querySelectorAll(".choice-button"));
  buttons.forEach((button) => {
    const isCustom = button.dataset.mission === "custom";
    button.classList.toggle(
      "is-selected",
      isCustom ? !missions.includes(selectedMission) : button.dataset.mission === selectedMission
    );
    button.disabled = Boolean(timerId);
  });
}

function updateTimerUI() {
  timerEl.textContent = formatTime(remainingSeconds);

  const progress = totalSeconds === 0 ? 0 : ((totalSeconds - remainingSeconds) / totalSeconds) * 100;
  const roundedProgress = Math.min(100, Math.max(0, Math.round(progress)));
  progressFillEl.style.width = `${roundedProgress}%`;
  progressTrackEl.setAttribute("aria-valuenow", String(roundedProgress));
}

function lockSetup(locked) {
  durationButtons.forEach((button) => {
    button.disabled = locked;
  });

  customTimeInputEl.disabled = locked;
  customTimeApplyEl.disabled = locked;
  customMissionInputEl.disabled = locked;
  customMissionApplyEl.disabled = locked;
  updateMissionSelection();
}

function enterFocusMode() {
  appCardEl.classList.remove("is-finished");
  appCardEl.classList.add("is-focusing");
  exitButtonEl.hidden = false;
  confirmPanelEl.hidden = true;
}

function exitFocusMode() {
  appCardEl.classList.remove("is-focusing");
  exitButtonEl.hidden = true;
}

function enterFinishedMode() {
  appCardEl.classList.remove("is-focusing");
  appCardEl.classList.add("is-finished");
  exitButtonEl.hidden = true;
}

function exitFinishedMode() {
  appCardEl.classList.remove("is-finished");
}

function showExitConfirmation() {
  if (!timerId) {
    return;
  }

  pendingExitConfirmation = true;
  appCardEl.classList.add("is-confirming");
  confirmPanelEl.hidden = false;
  exitButtonEl.hidden = true;
}

function hideExitConfirmation() {
  pendingExitConfirmation = false;
  appCardEl.classList.remove("is-confirming");
  confirmPanelEl.hidden = true;
  exitButtonEl.hidden = !timerId;
}

function resetRewardView() {
  rewardCardEl.hidden = true;
  rewardIconEl.replaceChildren();
  rewardNameEl.textContent = "";
  eggShellEl.hidden = false;
  eggShellEl.classList.remove("is-opening", "is-glowing", "is-wiggling");
  eggShellEl.dataset.crack = "0";
  eggGlowRingEl.classList.remove("is-visible");
  hideExitConfirmation();
}

function chooseDuration(value) {
  if (value === "custom") {
    customTimeRowEl.hidden = false;
    customTimeInputEl.focus();
    return;
  }

  customTimeRowEl.hidden = true;
  selectedMinutes = Number(value);
  totalSeconds = selectedMinutes * 60;
  remainingSeconds = totalSeconds;

  durationButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.minutes === String(value));
  });

  updateTimerUI();
}

function applyCustomTime() {
  const value = Number(customTimeInputEl.value);

  if (!value || value < 1) {
    customTimeInputEl.value = "3";
  }

  selectedMinutes = Math.max(1, Number(customTimeInputEl.value || 3));
  totalSeconds = selectedMinutes * 60;
  remainingSeconds = totalSeconds;

  durationButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.minutes === "custom");
  });

  setMessage(`${selectedMinutes}分钟`);
  updateTimerUI();
}

function applyCustomMission() {
  const value = customMissionInputEl.value.trim();
  selectedMission = value || "自定义任务";
  updateMissionSelection();
  setMessage(selectedMission);
}

function applyMilestone(progress) {
  if (progress >= 25 && !reachedMilestones.has(25)) {
    reachedMilestones.add(25);
    eggShellEl.dataset.crack = "1";
    setMessage(milestoneMessages.quarter);
    playSound("milestone");
  }

  if (progress >= 50 && !reachedMilestones.has(50)) {
    reachedMilestones.add(50);
    eggShellEl.dataset.crack = "2";
    eggShellEl.classList.remove("is-wiggling");
    void eggShellEl.offsetWidth;
    eggShellEl.classList.add("is-wiggling");
    setMessage(milestoneMessages.half);
    playSound("milestone");
  }

  if (progress >= 75 && !reachedMilestones.has(75)) {
    reachedMilestones.add(75);
    eggShellEl.classList.add("is-glowing");
    eggGlowRingEl.classList.add("is-visible");
    setMessage(milestoneMessages.almost);
    playSound("milestone");
  }
}

function finishSession() {
  window.clearInterval(timerId);
  timerId = null;
  remainingSeconds = 0;
  updateTimerUI();

  const reward = randomItem(rewards);
  const earnedAt = new Date().toISOString();
  const storedReward = getCanonicalReward(reward, earnedAt);
  const collection = loadCollection();
  collection.unshift(storedReward);
  saveCollection(collection);
  renderCollection();

  eggGlowRingEl.classList.add("is-visible");
  eggShellEl.classList.add("is-opening");
  setMessage("打开惊喜蛋");
  lockSetup(false);
  playSound("reward");

  window.setTimeout(() => {
    eggShellEl.hidden = true;
    renderRewardVisual(rewardIconEl, storedReward, {
      imageClassName: "reward-image",
      emojiClassName: "reward-emoji"
    });
    rewardNameEl.textContent = storedReward.name;
    setMessage(milestoneMessages.done);
    rewardCardEl.hidden = false;
    collectionPanelEl.open = true;
    enterFinishedMode();
    startButtonEl.disabled = false;
  }, 980);
}

function earlyExitSession() {
  window.clearInterval(timerId);
  timerId = null;
  reachedMilestones = new Set();
  resetRewardView();
  updateTimerUI();
  exitFocusMode();
  exitFinishedMode();
  startButtonEl.textContent = "开始";
  startButtonEl.disabled = false;
  lockSetup(false);
  setMessage(milestoneMessages.earlyExit);
}

function startSession() {
  if (timerId) {
    return;
  }

  resetRewardView();
  reachedMilestones = new Set();
  totalSeconds = selectedMinutes * 60;
  remainingSeconds = totalSeconds;
  updateTimerUI();
  setMessage(selectedMission);
  lockSetup(true);
  enterFocusMode();
  startButtonEl.textContent = "孵化中";
  startButtonEl.disabled = true;
  hideExitConfirmation();
  playSound("start");

  timerId = window.setInterval(() => {
    remainingSeconds -= 1;
    updateTimerUI();

    const progress = ((totalSeconds - remainingSeconds) / totalSeconds) * 100;
    applyMilestone(progress);

    if (remainingSeconds <= 0) {
      finishSession();
    }
  }, 1000);
}

function resetSession() {
  window.clearInterval(timerId);
  timerId = null;
  reachedMilestones = new Set();
  totalSeconds = selectedMinutes * 60;
  remainingSeconds = totalSeconds;
  resetRewardView();
  updateTimerUI();
  exitFocusMode();
  exitFinishedMode();
  setMessage("孵化任务");
  startButtonEl.textContent = "开始";
  startButtonEl.disabled = false;
  collectionPanelEl.open = false;
  lockSetup(false);
}

durationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (timerId) {
      return;
    }

    playSound("click");
    chooseDuration(button.dataset.minutes);
  });
});

customTimeApplyEl.addEventListener("click", () => {
  playSound("click");
  applyCustomTime();
});

customTimeInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    playSound("click");
    applyCustomTime();
  }
});

customMissionApplyEl.addEventListener("click", () => {
  playSound("click");
  applyCustomMission();
});

customMissionInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    playSound("click");
    applyCustomMission();
  }
});

startButtonEl.addEventListener("click", () => {
  if (timerId) {
    return;
  }

  playSound("click");
  startSession();
});

resetButtonEl.addEventListener("click", () => {
  playSound("click");
  resetSession();
});

againButtonEl.addEventListener("click", () => {
  playSound("click");
  resetSession();
});

exitButtonEl.addEventListener("click", () => {
  playSound("click");
  showExitConfirmation();
});

confirmExitButtonEl.addEventListener("click", () => {
  playSound("click");
  earlyExitSession();
});

document.addEventListener(
  "click",
  (event) => {
    if (!pendingExitConfirmation) {
      return;
    }

    if (confirmPanelEl.contains(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    hideExitConfirmation();
  },
  true
);

["pointerdown", "touchend", "keydown"].forEach((eventName) => {
  document.addEventListener(
    eventName,
    () => {
      if (!soundEnabled || (audioReady && !needsAudioResume && queuedSoundKinds.length === 0)) {
        return;
      }

      void unlockAudioFromGesture();
    },
    { capture: true, passive: eventName !== "keydown" }
  );
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    markAudioAsNeedingResume();
  }
});

window.addEventListener("pageshow", () => {
  markAudioAsNeedingResume();
});

window.addEventListener("focus", () => {
  markAudioAsNeedingResume();
});

soundButtonEl.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  if (!soundEnabled) {
    queuedSoundKinds = [];
    audioReady = false;
    needsAudioResume = false;
  } else {
    needsAudioResume = true;
  }
  saveSoundPreference();
  updateSoundButton();
  if (soundEnabled) {
    void unlockAudioFromGesture().then((ready) => {
      if (ready) {
        playSound("click");
      }
    });
  }
});

renderMissionButtons();
renderCollection();
chooseDuration(String(selectedMinutes));
setMessage("孵化任务");
updateSoundButton();
startButtonEl.disabled = false;
exitButtonEl.hidden = true;
