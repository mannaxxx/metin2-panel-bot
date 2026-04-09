process.env.TZ = 'Europe/Istanbul';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { Client, GatewayIntentBits, Partials, ChannelType, Events } = require('discord.js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = (process.env.DATA_DIR || '/root/panel-data').trim();
const LEGACY_DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const BADGES_PATH = path.join(DATA_DIR, 'badges.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const MESSAGE_TRACKER_PATH = path.join(DATA_DIR, 'message-tracker.json');
const PAYMENT_TRACKER_PATH = path.join(DATA_DIR, 'payments.json');
const ARCHIVE_TRACKER_PATH = path.join(DATA_DIR, 'archived-staff.json');
const GAME_NAMES_PATH = path.join(DATA_DIR, 'game-names.json');
const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });


function createJsonBackup(reason = 'manual') {
  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const payload = {
    reason,
    createdAt: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
    config: fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : null,
    stats: fs.existsSync(STATS_PATH) ? JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')) : null,
    messageTracker: fs.existsSync(MESSAGE_TRACKER_PATH) ? JSON.parse(fs.readFileSync(MESSAGE_TRACKER_PATH, 'utf8')) : null,
    paymentTracker: fs.existsSync(PAYMENT_TRACKER_PATH) ? JSON.parse(fs.readFileSync(PAYMENT_TRACKER_PATH, 'utf8')) : null,
    archiveTracker: fs.existsSync(ARCHIVE_TRACKER_PATH) ? JSON.parse(fs.readFileSync(ARCHIVE_TRACKER_PATH, 'utf8')) : null,
    gameNames: fs.existsSync(GAME_NAMES_PATH) ? JSON.parse(fs.readFileSync(GAME_NAMES_PATH, 'utf8')) : null,
    badges: fs.existsSync(BADGES_PATH) ? JSON.parse(fs.readFileSync(BADGES_PATH, 'utf8')) : null,
  };
  const backupFile = path.join(backupDir, `backup-${timestamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(payload, null, 2), 'utf8');
  return backupFile;
}

function startAutomaticBackups() {
  setInterval(() => {
    try {
      const file = createJsonBackup('hourly-auto');
      console.log('Otomatik saatlik yedek alindi:', path.basename(file));
    } catch (err) {
      console.error('Otomatik saatlik yedek alinamadi:', err.message);
    }
  }, AUTO_BACKUP_INTERVAL_MS);
}

function migrateLegacyDataIfNeeded() {
  try {
    if (!fs.existsSync(LEGACY_DATA_DIR)) return;
    const files = ['config.json', 'stats.json', 'badges.json'];
    for (const file of files) {
      const legacyFile = path.join(LEGACY_DATA_DIR, file);
      const targetFile = path.join(DATA_DIR, file);
      if (fs.existsSync(legacyFile) && !fs.existsSync(targetFile)) {
        fs.copyFileSync(legacyFile, targetFile);
      }
    }
  } catch (err) {
    console.error('Eski veri klasoru tasinamadi:', err.message);
  }
}

migrateLegacyDataIfNeeded();


const secureRuntime = {
  botToken: (process.env.BOT_TOKEN || process.env.DISCORD_TOKEN || '').trim(),
  guildId: (process.env.GUILD_ID || '').trim(),
  panelPassword: (process.env.PANEL_PASSWORD || '123456').trim(),
  sessionSecret: (process.env.SESSION_SECRET || 'metin2-panel-secret').trim()
};

const defaultConfig = {
  selectedChannelIds: [],
  selectedRoleIds: [],
  usernameSourceChannelId: '',
  cachedChannels: [],
  cachedRoles: [],
  cachedMembers: [],
  panelTitle: 'Yetkili Aktivite Takibi',
  panelSubtitle: 'Discord kanalındaki yetkili mesaj istatistikleri',
  managementSectionTitle: 'Yetkili Yönetimi',
  lastSyncAt: null
};

const ACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const MEMBER_CACHE_TTL_MS = 20 * 1000;
const BACKGROUND_MEMBER_REFRESH_MS = 15 * 1000;
let trackedMembersCacheAt = 0;
let trackedMembersRefreshPromise = null;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();

const defaultStats = {
  currentDay: '',
  currentWeek: '',
  logs: {
    daily: {},
    weekly: {}
  },
  activities: [],
  users: {}
};


const defaultMessageTracker = {
  currentDay: '',
  currentWeek: '',
  currentMonth: '',
  users: {}
};

const defaultPaymentTracker = {
  records: {},
  history: []
};

const defaultArchiveTracker = {
  archivedUsers: {}
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowDate() {
  return new Date();
}

function getLocalDayKey(date = nowDate()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalHourKey(date = nowDate()) {
  return String(date.getHours()).padStart(2, '0') + ':00';
}


function getBadgeList(totalCount) {
  const list = [];
  if (totalCount >= (badgeConfig.activeBadgeMin || 50)) list.push('🔥 Aktif');
  if (totalCount >= (badgeConfig.legendBadgeMin || 200)) list.push('⚡ Efsane');
  if (totalCount >= (badgeConfig.leaderBadgeMin || 500)) list.push('👑 Lider');
  return list;
}
function getActivityScore(member) {
  const daily = Number(member.dailyCount || 0);
  const weekly = Number(member.weeklyCount || 0);
  const total = Number(member.totalCount || 0);
  return Math.max(0, Math.min(999, daily * 4 + weekly * 2 + total));
}
function getLastActiveLabel(ts) {
  if (!ts) return 'Henüz aktif değil';
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 1) return 'Az önce';
  if (diffMin < 60) return diffMin + ' dk önce';
  const h = Math.floor(diffMin / 60);
  if (h < 24) return h + ' saat önce';
  const d = Math.floor(h / 24);
  return d + ' gün önce';
}
function getWeekKey(date = nowDate()) {
  const target = new Date(date);
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthKey(date = nowDate()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function createHourlyLogMap() {
  const output = {};
  for (let i = 0; i < 24; i += 1) {
    output[String(i).padStart(2, '0') + ':00'] = 0;
  }
  return output;
}

function isUserActiveByTimestamp(lastMessageAt) {
  if (!lastMessageAt) return false;
  const last = new Date(lastMessageAt).getTime();
  if (!Number.isFinite(last)) return false;
  return (Date.now() - last) < ACTIVE_TIMEOUT_MS;
}

function normalizePresenceStatus(status) {
  if (status === 'online' || status === 'idle' || status === 'dnd') return status;
  return 'offline';
}

function isPresenceOnline(status) {
  return ['online', 'idle', 'dnd'].includes(normalizePresenceStatus(status));
}

function getPresenceLabel(status) {
  const value = normalizePresenceStatus(status);
  if (value === 'online') return 'Çevrimiçi';
  if (value === 'idle') return 'Boşta';
  if (value === 'dnd') return 'Rahatsız Etmeyin';
  return 'Çevrimdışı';
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function getLoginAttemptState(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || current.expiresAt <= now) {
    const fresh = { count: 0, expiresAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(ip, fresh);
    return fresh;
  }
  return current;
}

function isLoginBlocked(ip) {
  const state = getLoginAttemptState(ip);
  return state.count >= LOGIN_MAX_ATTEMPTS && state.expiresAt > Date.now();
}

function registerFailedLogin(ip) {
  const state = getLoginAttemptState(ip);
  state.count += 1;
  loginAttempts.set(ip, state);
  return Math.max(0, LOGIN_MAX_ATTEMPTS - state.count);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}


function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return clone(fallback);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`${filePath} okunamadı:`, error);
    return clone(fallback);
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

let config = { ...defaultConfig, ...readJson(CONFIG_PATH, defaultConfig) };
config.cachedChannels = Array.isArray(config.cachedChannels) ? config.cachedChannels : [];
config.cachedRoles = Array.isArray(config.cachedRoles) ? config.cachedRoles : [];
config.selectedChannelIds = Array.isArray(config.selectedChannelIds) ? config.selectedChannelIds : [];
config.cachedMembers = Array.isArray(config.cachedMembers) ? config.cachedMembers : [];
config.selectedRoleIds = Array.isArray(config.selectedRoleIds) ? config.selectedRoleIds : [];
config.usernameSourceChannelId = typeof config.usernameSourceChannelId === 'string' ? config.usernameSourceChannelId : '';
config.managementSectionTitle = (config.managementSectionTitle || defaultConfig.managementSectionTitle).trim() || defaultConfig.managementSectionTitle;

const defaultBadgeConfig = { activeBadgeMin: 50, legendBadgeMin: 200, leaderBadgeMin: 500 };
let badgeConfig = readJson(BADGES_PATH, defaultBadgeConfig);
let stats = readJson(STATS_PATH, defaultStats);
stats.currentDay = stats.currentDay || getLocalDayKey();
stats.currentWeek = stats.currentWeek || getWeekKey();
let messageTracker = readJson(MESSAGE_TRACKER_PATH, defaultMessageTracker);
messageTracker.currentDay = messageTracker.currentDay || getLocalDayKey();
messageTracker.currentWeek = messageTracker.currentWeek || getWeekKey();
messageTracker.currentMonth = messageTracker.currentMonth || getMonthKey();
let paymentTracker = readJson(PAYMENT_TRACKER_PATH, defaultPaymentTracker);
paymentTracker.records = paymentTracker && typeof paymentTracker.records === 'object' ? paymentTracker.records : {};
paymentTracker.history = Array.isArray(paymentTracker?.history) ? paymentTracker.history : [];
let archiveTracker = readJson(ARCHIVE_TRACKER_PATH, defaultArchiveTracker);
archiveTracker.archivedUsers = archiveTracker && typeof archiveTracker.archivedUsers === 'object' ? archiveTracker.archivedUsers : {};
let gameNames = readJson(GAME_NAMES_PATH, {});
gameNames = gameNames && typeof gameNames === 'object' ? gameNames : {};
let discordState = {
  connected: false,
  userTag: '',
  lastError: '',
  syncing: false,
  lastSyncAt: config.lastSyncAt || null
};

let client = null;
let currentToken = '';
let activeGuildId = secureRuntime.guildId || '';

function sanitizeConfigForDisk(value) {
  return {
    selectedChannelIds: Array.isArray(value.selectedChannelIds) ? value.selectedChannelIds : [],
    selectedRoleIds: Array.isArray(value.selectedRoleIds) ? value.selectedRoleIds : [],
    usernameSourceChannelId: typeof value.usernameSourceChannelId === 'string' ? value.usernameSourceChannelId : '',
    cachedChannels: Array.isArray(value.cachedChannels) ? value.cachedChannels : [],
    cachedRoles: Array.isArray(value.cachedRoles) ? value.cachedRoles : [],
    cachedMembers: Array.isArray(value.cachedMembers) ? value.cachedMembers : [],
    panelTitle: value.panelTitle || defaultConfig.panelTitle,
    panelSubtitle: value.panelSubtitle || defaultConfig.panelSubtitle,
    managementSectionTitle: value.managementSectionTitle || defaultConfig.managementSectionTitle,
    lastSyncAt: discordState.lastSyncAt || null
  };
}

function saveConfig() {
  config.lastSyncAt = discordState.lastSyncAt;
  writeJson(CONFIG_PATH, sanitizeConfigForDisk(config));
}

function ensureDailyReset() {
  const today = getLocalDayKey();
  const weekKey = getWeekKey();

  if (!stats.logs || typeof stats.logs !== 'object') {
    stats.logs = { daily: {}, weekly: {} };
  }
  if (!Array.isArray(stats.activities)) {
    stats.activities = [];
  }
  if (!stats.logs.daily || typeof stats.logs.daily !== 'object') {
    stats.logs.daily = {};
  }
  if (!stats.logs.weekly || typeof stats.logs.weekly !== 'object') {
    stats.logs.weekly = {};
  }

  if (stats.currentDay !== today) {
    stats.currentDay = today;
    Object.values(stats.users).forEach((user) => {
      user.dailyCount = 0;
      user.hourlyToday = createHourlyLogMap();
    });
    stats.logs.daily = createHourlyLogMap();
  }

  if (stats.currentWeek !== weekKey) {
    stats.currentWeek = weekKey;
    Object.values(stats.users).forEach((user) => {
      user.weeklyCount = 0;
    });
    stats.logs.weekly = {};
  }

  for (const user of Object.values(stats.users)) {
    if (!user.hourlyToday || typeof user.hourlyToday !== 'object') {
      user.hourlyToday = createHourlyLogMap();
    }
    if (typeof user.weeklyCount !== 'number') {
      user.weeklyCount = 0;
    }
  }

  if (!stats.logs.daily || Object.keys(stats.logs.daily).length !== 24) {
    stats.logs.daily = { ...createHourlyLogMap(), ...(stats.logs.daily || {}) };
  }

  writeJson(STATS_PATH, stats);
}

function manualDailyReset() {
  stats.currentDay = getLocalDayKey();
  Object.values(stats.users).forEach((user) => {
    user.dailyCount = 0;
    user.hourlyToday = createHourlyLogMap();
  });
  stats.logs = stats.logs || { daily: {}, weekly: {} };
  stats.logs.daily = createHourlyLogMap();
  writeJson(STATS_PATH, stats);
}


function resetActivityTracker() {
  stats = clone(defaultStats);
  stats.currentDay = getLocalDayKey();
  stats.currentWeek = getWeekKey();
  stats.logs.daily = createHourlyLogMap();
  writeJson(STATS_PATH, stats);
}

function resetLogsPanel() {
  ensureDailyReset();
  stats.activities = [];
  stats.logs = {
    daily: createHourlyLogMap(),
    weekly: {}
  };
  writeJson(STATS_PATH, stats);
}

function resetMessageTrackerPanel() {
  messageTracker = clone(defaultMessageTracker);
  messageTracker.currentDay = getLocalDayKey();
  messageTracker.currentWeek = getWeekKey();
  messageTracker.currentMonth = getMonthKey();
  writeJson(MESSAGE_TRACKER_PATH, messageTracker);
}

function resetPaymentsPanel() {
  paymentTracker = clone(defaultPaymentTracker);
  writeJson(PAYMENT_TRACKER_PATH, paymentTracker);
}


function saveMessageTracker() {
  writeJson(MESSAGE_TRACKER_PATH, messageTracker);
}

function ensureMessageTrackerReset() {
  const today = getLocalDayKey();
  const weekKey = getWeekKey();
  const monthKey = getMonthKey();

  if (!messageTracker || typeof messageTracker !== 'object') {
    messageTracker = clone(defaultMessageTracker);
  }
  if (!messageTracker.users || typeof messageTracker.users !== 'object') {
    messageTracker.users = {};
  }

  if (messageTracker.currentDay !== today) {
    for (const user of Object.values(messageTracker.users)) {
      user.yesterdayCount = Number(user.todayCount || 0);
      user.todayCount = 0;
    }
    messageTracker.currentDay = today;
  }

  if (messageTracker.currentWeek !== weekKey) {
    for (const user of Object.values(messageTracker.users)) {
      user.weeklyCount = 0;
    }
    messageTracker.currentWeek = weekKey;
  }

  if (messageTracker.currentMonth !== monthKey) {
    for (const user of Object.values(messageTracker.users)) {
      user.monthlyCount = 0;
    }
    messageTracker.currentMonth = monthKey;
  }

  for (const user of Object.values(messageTracker.users)) {
    user.todayCount = Number(user.todayCount || 0);
    user.yesterdayCount = Number(user.yesterdayCount || 0);
    user.weeklyCount = Number(user.weeklyCount || 0);
    user.monthlyCount = Number(user.monthlyCount || 0);
  }

  saveMessageTracker();
}

function upsertMessageTrackerUser(member) {
  ensureMessageTrackerReset();
  const id = member.user.id;
  if (!messageTracker.users[id]) {
    messageTracker.users[id] = {
      userId: id,
      username: member.user.username,
      displayName: member.displayName || member.user.username,
      gameName: getGameNameForUser(id),
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 }),
      todayCount: 0,
      yesterdayCount: 0,
      weeklyCount: 0,
      monthlyCount: 0,
      presenceStatus: normalizePresenceStatus(member.presence?.status),
      updatedAt: null
    };
  } else {
    messageTracker.users[id].username = member.user.username;
    messageTracker.users[id].displayName = member.displayName || member.user.username;
    messageTracker.users[id].gameName = getGameNameForUser(id);
    messageTracker.users[id].avatarUrl = member.displayAvatarURL({ extension: 'png', size: 128 });
    messageTracker.users[id].presenceStatus = normalizePresenceStatus(member.presence?.status);
  }
  return messageTracker.users[id];
}

async function buildMessageTrackerData() {
  ensureMessageTrackerReset();
  let trackedMembers = Array.isArray(config.cachedMembers) ? [...config.cachedMembers] : [];
  if (discordState.connected && config.selectedRoleIds.length && trackedMembers.length === 0) {
    trackedMembers = await refreshTrackedMembers({ refreshGuild: false, force: true });
  }

  const activeIds = (trackedMembers || []).map((member) => member.userId);
  pruneUntrackedUsersFromPanels(activeIds);
  const rows = [];

  for (const member of trackedMembers) {
    const existing = messageTracker.users[member.userId] || {};
    rows.push({
      userId: member.userId,
      displayName: member.displayName || member.username,
      username: member.username,
      gameName: getGameNameForUser(member.userId),
      avatarUrl: member.avatarUrl,
      roleTags: Array.isArray(member.roleTags) ? member.roleTags : [],
      presenceStatus: normalizePresenceStatus(member.presenceStatus),
      presenceLabel: getPresenceLabel(member.presenceStatus),
      todayCount: Number(existing.todayCount || 0),
      yesterdayCount: Number(existing.yesterdayCount || 0),
      weeklyCount: Number(existing.weeklyCount || 0),
      monthlyCount: Number(existing.monthlyCount || 0)
    });
  }

  rows.sort((a, b) => b.todayCount - a.todayCount || b.weeklyCount - a.weeklyCount || b.monthlyCount - a.monthlyCount || a.displayName.localeCompare(b.displayName, 'tr'));
  rows.forEach((row, index) => row.rank = index + 1);

  return {
    rows,
    summary: {
      trackedModerators: rows.length,
      todayMessages: rows.reduce((sum, row) => sum + row.todayCount, 0),
      yesterdayMessages: rows.reduce((sum, row) => sum + row.yesterdayCount, 0),
      weeklyMessages: rows.reduce((sum, row) => sum + row.weeklyCount, 0),
      monthlyMessages: rows.reduce((sum, row) => sum + row.monthlyCount, 0)
    }
  };
}

function savePaymentTracker() {
  writeJson(PAYMENT_TRACKER_PATH, paymentTracker);
}

function saveArchiveTracker() {
  writeJson(ARCHIVE_TRACKER_PATH, archiveTracker);
}

function saveGameNames() {
  writeJson(GAME_NAMES_PATH, gameNames);
}

function normalizeGameName(raw) {
  const value = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length < 2 || value.length > 24) return '';
  if (/https?:\/\//i.test(value)) return '';
  if (/[@#]/.test(value)) return '';
  return value;
}

function setGameNameForUser(userId, rawName) {
  if (!userId) return '';
  const normalized = normalizeGameName(rawName);
  if (!normalized) return '';
  gameNames[userId] = { value: normalized, updatedAt: new Date().toISOString() };
  saveGameNames();
  return normalized;
}

function getGameNameForUser(userId) {
  const entry = gameNames[userId];
  return entry && typeof entry.value === 'string' ? entry.value : '';
}

function archiveStaffRecord(record) {
  if (!record || !record.userId) return;
  archiveTracker.archivedUsers[record.userId] = {
    ...(archiveTracker.archivedUsers[record.userId] || {}),
    ...record,
    archivedAt: new Date().toISOString()
  };
  saveArchiveTracker();
}

function pruneUntrackedUsersFromPanels(trackedIds) {
  const activeIds = new Set(trackedIds || []);
  let changed = false;

  for (const [userId, record] of Object.entries(paymentTracker.records || {})) {
    if (activeIds.has(userId)) continue;
    archiveStaffRecord({
      ...record,
      source: 'payment',
      messageCounts: messageTracker.users?.[userId] || null
    });
    delete paymentTracker.records[userId];
    changed = true;
  }

  if (changed) savePaymentTracker();
}

function ensurePaymentTrackerShape() {
  if (!paymentTracker || typeof paymentTracker !== 'object') {
    paymentTracker = clone(defaultPaymentTracker);
  }
  if (!paymentTracker.records || typeof paymentTracker.records !== 'object') {
    paymentTracker.records = {};
  }
  if (!Array.isArray(paymentTracker.history)) {
    paymentTracker.history = [];
  }
}

function syncPaymentRecordFromRow(row) {
  ensurePaymentTrackerShape();
  const userId = row.userId;
  const existing = paymentTracker.records[userId] || {};
  paymentTracker.records[userId] = {
    userId,
    username: row.username || existing.username || '',
    displayName: row.displayName || existing.displayName || row.username || 'Bilinmiyor',
    gameName: row.gameName || existing.gameName || '',
    avatarUrl: row.avatarUrl || existing.avatarUrl || '',
    roleTags: Array.isArray(row.roleTags) ? row.roleTags : (Array.isArray(existing.roleTags) ? existing.roleTags : []),
    settled: Boolean(existing.settled),
    paidEp: Number(existing.paidEp || 0),
    paidMp: Number(existing.paidMp || 0),
    settledAt: existing.settledAt || null,
    lastPaymentId: existing.lastPaymentId || null
  };
  return paymentTracker.records[userId];
}

async function buildPaymentPanelData(searchTerm = '') {
  ensurePaymentTrackerShape();
  const trackerData = await buildMessageTrackerData();
  const rows = trackerData.rows.map((row) => {
    const record = syncPaymentRecordFromRow(row);
    return {
      ...row,
      gameName: row.gameName || record.gameName || '',
      paidEp: Number(record.paidEp || 0),
      paidMp: Number(record.paidMp || 0),
      settled: Boolean(record.settled),
      settledAt: record.settledAt || null,
      lastPaymentId: record.lastPaymentId || null
    };
  });

  const pendingRows = rows
    .filter((row) => !row.settled)
    .sort((a, b) => b.monthlyCount - a.monthlyCount || b.weeklyCount - a.weeklyCount || a.displayName.localeCompare(b.displayName, 'tr'));

  const settledRows = rows
    .filter((row) => row.settled)
    .sort((a, b) => new Date(b.settledAt || 0).getTime() - new Date(a.settledAt || 0).getTime());

  const summaryMap = new Map();
  for (const item of paymentTracker.history || []) {
    const key = item.userId;
    const entry = summaryMap.get(key) || {
      userId: item.userId,
      displayName: item.displayName,
      username: item.username,
      gameName: item.gameName || getGameNameForUser(item.userId) || '',
      avatarUrl: item.avatarUrl,
      totalEp: 0,
      totalMp: 0,
      paymentCount: 0,
      lastPaymentAt: item.timestamp
    };
    entry.totalEp += Number(item.epAmount || 0);
    entry.totalMp += Number(item.mpAmount || 0);
    entry.paymentCount += 1;
    if (!entry.lastPaymentAt || new Date(item.timestamp).getTime() > new Date(entry.lastPaymentAt).getTime()) {
      entry.lastPaymentAt = item.timestamp;
    }
    summaryMap.set(key, entry);
  }

  const normalizedSearch = String(searchTerm || '').trim().toLocaleLowerCase('tr');
  const historySummary = Array.from(summaryMap.values())
    .filter((item) => {
      if (!normalizedSearch) return true;
      const haystack = [item.displayName, item.username, item.gameName, item.userId]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr');
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => new Date(b.lastPaymentAt || 0).getTime() - new Date(a.lastPaymentAt || 0).getTime())
    .map((item) => ({
      ...item,
      detailEntries: (paymentTracker.history || [])
        .filter((entry) => entry.userId === item.userId)
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        .map((entry) => ({
          id: entry.id,
          epAmount: Number(entry.epAmount || 0),
          mpAmount: Number(entry.mpAmount || 0),
          timestamp: entry.timestamp,
          counts: {
            todayCount: Number(entry.counts?.todayCount || 0),
            yesterdayCount: Number(entry.counts?.yesterdayCount || 0),
            weeklyCount: Number(entry.counts?.weeklyCount || 0),
            monthlyCount: Number(entry.counts?.monthlyCount || 0)
          }
        }))
    }));

  savePaymentTracker();

  return {
    pendingRows,
    settledRows,
    historySummary,
    summary: {
      pendingCount: pendingRows.length,
      settledCount: settledRows.length,
      totalEp: (paymentTracker.history || []).reduce((sum, item) => sum + Number(item.epAmount || 0), 0),
      totalMp: (paymentTracker.history || []).reduce((sum, item) => sum + Number(item.mpAmount || 0), 0)
    },
    filters: { q: searchTerm || '' }
  };
}

function upsertUser(member) {
  const id = member.user.id;
  if (!stats.users[id]) {
    stats.users[id] = {
      userId: id,
      username: member.user.username,
      displayName: member.displayName || member.user.username,
      gameName: getGameNameForUser(id),
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 }),
      dailyCount: 0,
      totalCount: 0,
      weeklyCount: 0,
      hourlyToday: createHourlyLogMap(),
      lastMessageAt: null,
      status: 'PASİF'
    };
  } else {
    stats.users[id].username = member.user.username;
    stats.users[id].displayName = member.displayName || member.user.username;
    stats.users[id].avatarUrl = member.displayAvatarURL({ extension: 'png', size: 128 });
    if (!stats.users[id].hourlyToday || typeof stats.users[id].hourlyToday !== 'object') {
      stats.users[id].hourlyToday = createHourlyLogMap();
    }
    if (typeof stats.users[id].weeklyCount !== 'number') {
      stats.users[id].weeklyCount = 0;
    }
  }
  return stats.users[id];
}

function isClientReady() {
  return Boolean(client && client.isReady());
}

function buildDiscordClient() {
  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  discordClient.once(Events.ClientReady, (readyClient) => {
    console.log(`Bot aktif: ${readyClient.user.tag}`);
    discordState.connected = true;
    discordState.userTag = readyClient.user.tag;
    discordState.lastError = '';
    ensureDailyReset();
    ensureMessageTrackerReset();
  });

  discordClient.on('error', (error) => {
    discordState.connected = false;
    discordState.lastError = error.message || 'Discord bağlantı hatası.';
    console.error('Discord client error:', error);
  });

  discordClient.on('shardDisconnect', () => {
    discordState.connected = false;
  });

  discordClient.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      if (!activeGuildId || newMember.guild.id !== activeGuildId) return;
      const trackedRoleIds = new Set(config.selectedRoleIds || []);
      if (!trackedRoleIds.size) return;
      const hadTrackedRole = oldMember.roles.cache.some((role) => trackedRoleIds.has(role.id));
      const hasTrackedRole = newMember.roles.cache.some((role) => trackedRoleIds.has(role.id));

      if (hadTrackedRole !== hasTrackedRole || normalizePresenceStatus(oldMember.presence?.status) !== normalizePresenceStatus(newMember.presence?.status)) {
        trackedMembersCacheAt = 0;
        await refreshTrackedMembers({ refreshGuild: false, force: true });
      }

      if (!hasTrackedRole && hadTrackedRole) {
        archiveStaffRecord({
          userId: newMember.id,
          username: newMember.user.username,
          displayName: newMember.displayName || newMember.user.username,
          avatarUrl: newMember.displayAvatarURL({ extension: 'png', size: 128 }),
          roleTags: [],
          presenceStatus: normalizePresenceStatus(newMember.presence?.status),
          source: 'role-removed',
          messageCounts: messageTracker.users?.[newMember.id] || null
        });
        if (paymentTracker.records?.[newMember.id]) {
          delete paymentTracker.records[newMember.id];
          savePaymentTracker();
        }
      }
    } catch (error) {
      console.error('GuildMemberUpdate işlenemedi:', error.message || error);
    }
  });

  discordClient.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.guild || message.author.bot) return;
      ensureDailyReset();
    ensureMessageTrackerReset();

      if (!activeGuildId || message.guild.id !== activeGuildId) return;
      if (!message.member) return;

      const hasTrackedRole = message.member.roles.cache.some((role) => config.selectedRoleIds.includes(role.id));
      if (!hasTrackedRole) return;

      if (config.usernameSourceChannelId && message.channel.id === config.usernameSourceChannelId) {
        const savedName = setGameNameForUser(message.author.id, message.content);
        if (savedName && messageTracker.users?.[message.author.id]) {
          messageTracker.users[message.author.id].gameName = savedName;
          saveMessageTracker();
        }
        return;
      }

      if (!config.selectedChannelIds.includes(message.channel.id)) return;

      const user = upsertUser(message.member);
      const trackedMessageUser = upsertMessageTrackerUser(message.member);
      const hourKey = getLocalHourKey();
      const weekdayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
      const weekDay = weekdayNames[nowDate().getDay()];

      user.dailyCount += 1;
      user.totalCount += 1;
      user.weeklyCount = Number(user.weeklyCount || 0) + 1;
      user.hourlyToday = user.hourlyToday || createHourlyLogMap();
      user.hourlyToday[hourKey] = Number(user.hourlyToday[hourKey] || 0) + 1;
      user.lastMessageAt = new Date().toISOString();
      user.status = 'AKTİF';

      trackedMessageUser.todayCount += 1;
      trackedMessageUser.weeklyCount += 1;
      trackedMessageUser.monthlyCount += 1;
      trackedMessageUser.updatedAt = new Date().toISOString();
      trackedMessageUser.presenceStatus = normalizePresenceStatus(message.member.presence?.status);

      stats.logs = stats.logs || { daily: {}, weekly: {} };
      stats.logs.daily = stats.logs.daily || createHourlyLogMap();
      stats.logs.weekly = stats.logs.weekly || {};
      stats.logs.daily[hourKey] = Number(stats.logs.daily[hourKey] || 0) + 1;
      stats.logs.weekly[weekDay] = Number(stats.logs.weekly[weekDay] || 0) + 1;
      stats.activities = Array.isArray(stats.activities) ? stats.activities : [];
      stats.activities.unshift({
        type: 'message',
        userId: user.userId,
        displayName: user.displayName,
        count: 1,
        channelName: message.channel?.name || 'bilinmeyen-kanal',
        timestamp: new Date().toISOString(),
        text: `${user.displayName} #${message.channel?.name || 'kanal'} kanalında mesaj gönderdi`
      });
      stats.activities = stats.activities.slice(0, 200);

      writeJson(STATS_PATH, stats);
      saveMessageTracker();
      trackedMembersCacheAt = 0;
    } catch (error) {
      console.error('Mesaj sayma hatası:', error);
    }
  });

  return discordClient;
}

async function destroyCurrentClient() {
  if (!client) return;
  try {
    client.removeAllListeners();
    await client.destroy();
  } catch (error) {
    console.error('Client kapatma hatası:', error.message || error);
  } finally {
    client = null;
    discordState.connected = false;
    discordState.userTag = '';
  }
}

async function connectDiscord(forceReconnect = false) {
  const token = secureRuntime.botToken;
  activeGuildId = secureRuntime.guildId;

  if (!token) {
    discordState.connected = false;
    discordState.userTag = '';
    discordState.lastError = '.env içinde BOT_TOKEN girilmedi.';
    return { ok: false, message: discordState.lastError };
  }

  if (!activeGuildId) {
    discordState.connected = false;
    discordState.userTag = '';
    discordState.lastError = '.env içinde GUILD_ID girilmedi.';
    return { ok: false, message: discordState.lastError };
  }

  try {
    if (forceReconnect || !client || currentToken !== token || !isClientReady()) {
      await destroyCurrentClient();
      client = buildDiscordClient();
      currentToken = token;
      await client.login(token);
    }

    discordState.connected = isClientReady();
    discordState.userTag = client?.user?.tag || '';
    discordState.lastError = '';
    return { ok: true, message: 'Discord bağlantısı başarılı.' };
  } catch (error) {
    discordState.connected = false;
    discordState.userTag = '';
    discordState.lastError = error.message || 'Discord bağlantısı kurulamadı.';
    return { ok: false, message: discordState.lastError };
  }
}

async function fetchGuildStrict({ refresh = false } = {}) {
  const guildId = secureRuntime.guildId;
  if (!guildId) {
    throw new Error('.env içinde GUILD_ID ayarlanmadı.');
  }

  const connection = await connectDiscord(false);
  if (!connection.ok) {
    throw new Error(connection.message);
  }

  let guild = client.guilds.cache.get(guildId) || null;
  if (!guild) {
    guild = await client.guilds.fetch(guildId);
  }
  if (!guild) {
    throw new Error('Sunucu bulunamadı. Botun bu sunucuda olduğundan emin ol.');
  }

  if (refresh) {
    await guild.channels.fetch();
    await guild.roles.fetch();
  }

  return guild;
}

function normalizeGuildResources(guild) {
  const channels = guild.channels.cache
    .filter((channel) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
    .map((channel) => ({ id: channel.id, name: channel.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const roles = guild.roles.cache
    .filter((role) => role.name !== '@everyone')
    .map((role) => ({ id: role.id, name: role.name, color: role.hexColor || '#dfe7f3' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return { channels, roles };
}

async function refreshTrackedMembers({ refreshGuild = false, force = false } = {}) {
  try {
    if (!config.selectedRoleIds.length) {
      config.cachedMembers = [];
      trackedMembersCacheAt = Date.now();
      saveConfig();
      return [];
    }

    const cachedMembers = Array.isArray(config.cachedMembers) ? config.cachedMembers : [];
    const cacheFresh = cachedMembers.length > 0 && (Date.now() - trackedMembersCacheAt) < MEMBER_CACHE_TTL_MS;

    if (!force && !refreshGuild && cacheFresh) {
      return cachedMembers;
    }

    if (trackedMembersRefreshPromise) {
      return await trackedMembersRefreshPromise;
    }

    trackedMembersRefreshPromise = (async () => {
      const guild = await fetchGuildStrict({ refresh: refreshGuild });

      if (refreshGuild || guild.members.cache.size === 0) {
        try {
          await guild.members.fetch();
        } catch (error) {
          console.error('Üyeler cache için çekilemedi:', error.message || error);
        }
      }

      const trackedRoleIds = new Set(config.selectedRoleIds);
      const statsUsers = stats.users || {};
      const members = guild.members.cache
        .filter((member) => !member.user.bot && member.roles.cache.some((role) => trackedRoleIds.has(role.id)))
        .map((member) => {
          const existing = statsUsers[member.id] || {};
          return {
            userId: member.id,
            username: member.user.username,
            displayName: member.displayName || member.user.username,
            avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 }),
            roleTags: member.roles.cache
              .filter((role) => trackedRoleIds.has(role.id))
              .map((role) => ({ id: role.id, name: role.name, color: role.hexColor || '#dfe7f3' }))
              .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
            dailyCount: Number(existing.dailyCount || 0),
            totalCount: Number(existing.totalCount || 0),
            weeklyCount: Number(existing.weeklyCount || 0),
            hourlyToday: existing.hourlyToday || createHourlyLogMap(),
            lastMessageAt: existing.lastMessageAt || null,
            presenceStatus: normalizePresenceStatus(member.presence?.status),
            presenceLabel: getPresenceLabel(member.presence?.status),
            active: isPresenceOnline(member.presence?.status),
            status: isPresenceOnline(member.presence?.status) ? 'AKTİF' : 'PASİF'
          };
        })
        .sort((a, b) => Number(b.active) - Number(a.active) || b.dailyCount - a.dailyCount || b.totalCount - a.totalCount || a.displayName.localeCompare(b.displayName, 'tr'));

      config.cachedMembers = members;
      trackedMembersCacheAt = Date.now();
      saveConfig();
      return members;
    })();

    return await trackedMembersRefreshPromise;
  } catch (error) {
    console.error('Yetkili üyeler çekilemedi:', error.message || error);
    return Array.isArray(config.cachedMembers) ? config.cachedMembers : [];
  } finally {
    trackedMembersRefreshPromise = null;
  }
}

async function buildPanelData() {
  ensureDailyReset();

  let trackedMembers = Array.isArray(config.cachedMembers) ? [...config.cachedMembers] : [];
  if (discordState.connected && config.selectedRoleIds.length && trackedMembers.length === 0) {
    trackedMembers = await refreshTrackedMembers({ refreshGuild: false, force: true });
  }

  const activeIds = (trackedMembers || []).map((member) => member.userId);
  pruneUntrackedUsersFromPanels(activeIds);

  const statsMap = stats.users || {};
  const trackedMap = new Map((trackedMembers || []).map((member) => [member.userId, member]));

  const hydrateUserRecord = (user) => {
      const existing = statsMap[user.userId] || {};
      const dailyCount = Number(existing.dailyCount ?? user.dailyCount ?? 0);
      const totalCount = Number(existing.totalCount ?? user.totalCount ?? 0);
      const weeklyCount = Number(existing.weeklyCount ?? user.weeklyCount ?? 0);
      const lastMessageAt = existing.lastMessageAt ?? user.lastMessageAt ?? null;
      const roleTags = Array.isArray(user.roleTags)
        ? user.roleTags
        : Array.isArray(user.roleNames)
          ? user.roleNames.map((name) => ({ name, color: '#dfe7f3' }))
          : [];
      const presenceStatus = normalizePresenceStatus(user.presenceStatus ?? existing.presenceStatus ?? 'offline');
      const active = isPresenceOnline(presenceStatus);
      const activeMinutesAgo = lastMessageAt ? Math.max(0, Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 60000)) : null;
      return {
        ...user,
        roleTags,
        roleNames: roleTags.map((role) => role.name),
        dailyCount,
        totalCount,
        weeklyCount,
        hourlyToday: existing.hourlyToday ?? user.hourlyToday ?? createHourlyLogMap(),
        lastMessageAt,
        presenceStatus,
        presenceLabel: getPresenceLabel(presenceStatus),
        active,
        activeMinutesAgo,
        status: active ? 'AKTİF' : 'PASİF'
      };
    };

  const userRows = Array.from(trackedMap.values())
    .map(hydrateUserRecord)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.dailyCount - a.dailyCount || b.totalCount - a.totalCount || a.displayName.localeCompare(b.displayName, 'tr'))
    .map((user, index) => ({ ...user, rank: index + 1 }));

  const memberDirectory = (trackedMembers || [])
    .map(hydrateUserRecord)
    .sort((a, b) => b.dailyCount - a.dailyCount || b.totalCount - a.totalCount || a.displayName.localeCompare(b.displayName, 'tr'));

  const totalStaff = userRows.length;
  const dailyMessages = userRows.reduce((sum, user) => sum + Number(user.dailyCount || 0), 0);
  const totalMessages = userRows.reduce((sum, user) => sum + Number(user.totalCount || 0), 0);
  const topActive = userRows[0]?.displayName || '-';
  const inactiveCount = userRows.filter((user) => !user.active).length;

  const dailyLogEntries = Object.entries(stats.logs?.daily || createHourlyLogMap())
    .map(([hour, count]) => ({ hour, count: Number(count || 0) }));

  const recentActivities = (Array.isArray(stats.activities) ? stats.activities : [])
    .slice(0, 30)
    .map((item) => ({
      ...item,
      timeLabel: new Date(item.timestamp).toLocaleString('tr-TR')
    }));

  const weeklyTop = [...userRows]
    .sort((a, b) => b.weeklyCount - a.weeklyCount || b.totalCount - a.totalCount)
    .slice(0, 5);

  const dailyTop = [...userRows]
    .sort((a, b) => b.dailyCount - a.dailyCount || b.weeklyCount - a.weeklyCount || a.displayName.localeCompare(b.displayName, 'tr'));

  const channels = Array.isArray(config.cachedChannels) ? config.cachedChannels : [];
  const roles = Array.isArray(config.cachedRoles) ? config.cachedRoles : [];
  const selectedChannels = channels.filter((channel) => config.selectedChannelIds.includes(channel.id));
  const selectedRoles = roles.filter((role) => config.selectedRoleIds.includes(role.id));

  return {
    config,
    channels,
    roles,
    selectedChannels,
    selectedRoles,
    userRows,
    memberDirectory,
    discordState,
    logs: {
      recent: recentActivities,
      weeklyTop,
      dailyTop,
      dailyTotal: dailyMessages
    },
    summary: {
      totalStaff,
      dailyMessages,
      totalMessages,
      topActive,
      trackedChannels: config.selectedChannelIds.length,
      trackedRoles: config.selectedRoleIds.length,
      inactiveCount
    }
  };
}


let backgroundRefreshHandle = null;

async function refreshTrackedMembersInBackground() {
  if (!secureRuntime.botToken || !secureRuntime.guildId || !config.selectedRoleIds.length) return;
  try {
    await connectDiscord(false);
    if (!discordState.connected) return;
    await refreshTrackedMembers({ refreshGuild: false, force: true });
  } catch (error) {
    console.error('Arka plan yetkili yenileme hatası:', error.message || error);
  }
}

function startBackgroundPresenceRefresh() {
  if (backgroundRefreshHandle) clearInterval(backgroundRefreshHandle);
  backgroundRefreshHandle = setInterval(() => {
    refreshTrackedMembersInBackground();
  }, BACKGROUND_MEMBER_REFRESH_MS);
}

async function syncGuildResources({ forceReconnect = false } = {}) {
  if (discordState.syncing) {
    return { ok: false, message: 'Zaten güncelleme yapılıyor. Lütfen birkaç saniye bekle.' };
  }

  discordState.syncing = true;
  try {
    if (forceReconnect) {
      const reconnect = await connectDiscord(true);
      if (!reconnect.ok) return reconnect;
    }

    const guild = await fetchGuildStrict({ refresh: true });
    const { channels, roles } = normalizeGuildResources(guild);

    config.cachedChannels = channels;
    config.cachedRoles = roles;

    const validRoleIds = new Set(roles.map((role) => role.id));
    const validChannelIds = new Set(channels.map((channel) => channel.id));

    config.selectedRoleIds = config.selectedRoleIds.filter((id) => validRoleIds.has(id));
    config.selectedChannelIds = config.selectedChannelIds.filter((id) => validChannelIds.has(id));
    if (config.usernameSourceChannelId && !validChannelIds.has(config.usernameSourceChannelId)) {
      config.usernameSourceChannelId = '';
    }
    discordState.lastSyncAt = new Date().toLocaleString('tr-TR');
    discordState.lastError = '';
    saveConfig();
    trackedMembersCacheAt = 0;
    await refreshTrackedMembers({ refreshGuild: false, force: true });

    return {
      ok: true,
      message: `${guild.name} sunucusundan ${roles.length} rol ve ${channels.length} kanal çekildi.`
    };
  } catch (error) {
    discordState.lastError = error.message || 'Discord verileri çekilemedi.';
    return { ok: false, message: discordState.lastError };
  } finally {
    discordState.syncing = false;
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value) return [value];
  return [];
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: secureRuntime.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

function authRequired(req, res, next) {
  if (req.session && req.session.isAuthenticated) return next();
  return res.redirect('/login');
}

async function renderWithLayout(res, view, extra = {}) {
  const data = extra.panelData || await buildPanelData();
  res.render(view, {
    badgeConfig,

    ...data,
    currentPath: extra.currentPath || '/',
    saved: extra.saved || false,
    message: extra.message || '',
    messageType: extra.messageType || '',
    hint: extra.hint || '',
    secureMeta: {
      tokenConfigured: Boolean(secureRuntime.botToken),
      guildConfigured: Boolean(secureRuntime.guildId)
    }
  });
}

app.get('/login', (req, res) => {
  res.render('login', { error: null, blocked: false });
});

app.post('/login', (req, res) => {
  const ip = getClientIp(req);
  if (isLoginBlocked(ip)) {
    return res.status(429).render('login', {
      error: 'Çok fazla hatalı giriş denemesi yapıldı. 15 dakika sonra tekrar deneyin.',
      blocked: true
    });
  }

  const password = req.body.password || '';
  if (password === secureRuntime.panelPassword) {
    clearLoginAttempts(ip);
    req.session.isAuthenticated = true;
    return res.redirect('/');
  }

  const remaining = registerFailedLogin(ip);
  const message = remaining > 0
    ? `Şifre hatalı. Kalan deneme: ${remaining}`
    : 'Çok fazla hatalı giriş denemesi yapıldı. 15 dakika sonra tekrar deneyin.';

  return res.status(401).render('login', { error: message, blocked: remaining <= 0 });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', authRequired, async (req, res) => {
  const panelData = await buildPanelData();
  await renderWithLayout(res, 'dashboard', {
    currentPath: '/',
    panelData,
    message: req.query.message || '',
    messageType: req.query.type || ''
  });
});


app.get('/message-stats', authRequired, async (req, res) => {
  const panelData = await buildPanelData();
  const trackerData = await buildMessageTrackerData();
  res.render('message-stats', {
    ...panelData,
    trackerData,
    currentPath: '/message-stats',
    message: req.query.message || '',
    messageType: req.query.type || '',
    secureMeta: {
      tokenConfigured: Boolean(secureRuntime.botToken),
      guildConfigured: Boolean(secureRuntime.guildId)
    }
  });
});

app.get('/payments', authRequired, async (req, res) => {
  const panelData = await buildPanelData();
  const paymentData = await buildPaymentPanelData(req.query.q || '');
  res.render('payments', {
    ...panelData,
    paymentData,
    currentPath: '/payments',
    message: req.query.message || '',
    messageType: req.query.type || '',
    secureMeta: {
      tokenConfigured: Boolean(secureRuntime.botToken),
      guildConfigured: Boolean(secureRuntime.guildId)
    }
  });
});

app.post('/payments/settle', authRequired, async (req, res) => {
  try {
    ensurePaymentTrackerShape();
    const trackerData = await buildMessageTrackerData();
    const row = trackerData.rows.find((item) => item.userId === req.body.userId);
    if (!row) {
      return res.redirect('/payments?type=error&message=' + encodeURIComponent('Ödeme yapılacak yetkili bulunamadı.'));
    }

    const epAmount = Math.max(0, Number(req.body.epAmount || 0));
    const mpAmount = Math.max(0, Number(req.body.mpAmount || 0));
    if (!epAmount && !mpAmount) {
      return res.redirect('/payments?type=error&message=' + encodeURIComponent('EP veya MP miktarı girmen gerekiyor.'));
    }

    const record = syncPaymentRecordFromRow(row);
    const paymentId = `${row.userId}-${Date.now()}`;
    record.paidEp = Number(record.paidEp || 0) + epAmount;
    record.paidMp = Number(record.paidMp || 0) + mpAmount;
    record.settled = true;
    record.settledAt = new Date().toISOString();
    record.lastPaymentId = paymentId;

    paymentTracker.history.unshift({
      id: paymentId,
      userId: row.userId,
      displayName: row.displayName,
      username: row.username,
      gameName: row.gameName || '',
      avatarUrl: row.avatarUrl,
      roleTags: Array.isArray(row.roleTags) ? row.roleTags : [],
      epAmount,
      mpAmount,
      timestamp: record.settledAt,
      counts: {
        todayCount: Number(row.todayCount || 0),
        yesterdayCount: Number(row.yesterdayCount || 0),
        weeklyCount: Number(row.weeklyCount || 0),
        monthlyCount: Number(row.monthlyCount || 0)
      }
    });
    paymentTracker.history = paymentTracker.history.slice(0, 200);
    savePaymentTracker();
    return res.redirect('/payments?type=success&message=' + encodeURIComponent(`${row.displayName} için ödeme kaydedildi.`));
  } catch (error) {
    return res.redirect('/payments?type=error&message=' + encodeURIComponent(error.message || 'Ödeme kaydedilemedi.'));
  }
});

app.post('/payments/reopen/:userId', authRequired, (req, res) => {
  ensurePaymentTrackerShape();
  const record = paymentTracker.records[req.params.userId];
  if (!record) {
    return res.redirect('/payments?type=error&message=' + encodeURIComponent('Kayıt bulunamadı.'));
  }
  record.settled = false;
  record.settledAt = null;
  record.lastPaymentId = null;
  savePaymentTracker();
  return res.redirect('/payments?type=success&message=' + encodeURIComponent(`${record.displayName || 'Yetkili'} tekrar bekleyenlere alındı.`));
});

app.get('/staff-management', authRequired, (req, res) => {
  return res.redirect('/settings');
});

app.post('/staff-management', authRequired, async (req, res) => {
  return res.redirect('/settings');
});

app.post('/staff-management/sync', authRequired, async (req, res) => {
  return res.redirect('/settings');
});


app.get('/member/:userId', authRequired, async (req, res) => {
  const panelData = await buildPanelData();
  const member = panelData.userRows.find((item) => item.userId === req.params.userId);

  if (!member) {
    return res.status(404).send('Kullanıcı bulunamadı.');
  }

  const memberActivities = (Array.isArray(stats.activities) ? stats.activities : [])
    .filter((item) => item.userId === member.userId)
    .slice(0, 12)
    .map((item) => ({
      ...item,
      timeLabel: new Date(item.timestamp).toLocaleString('tr-TR')
    }));

  res.render('member-detail', {
    ...panelData,
    currentPath: '/',
    member,
    memberActivities,
    secureMeta: {
      tokenConfigured: Boolean(secureRuntime.botToken),
      guildConfigured: Boolean(secureRuntime.guildId)
    }
  });
});


function buildDashboardData() {
  const followedRoleIds = Array.isArray(config.selectedRoleIds) ? config.selectedRoleIds : [];
  const followedChannelIds = Array.isArray(config.selectedChannelIds) ? config.selectedChannelIds : [];
  const membersRaw = stats && Array.isArray(stats.members) ? stats.members : [];
  const rows = membersRaw.map((member, index) => {
    const lastMessageAt = member.lastMessageAt || member.lastMessage || null;
    const activeMinutesAgo = lastMessageAt ? Math.floor((Date.now() - Number(lastMessageAt)) / 60000) : null;
    const active = activeMinutesAgo !== null ? activeMinutesAgo < 10 : false;
    const roleTags = Array.isArray(member.roleTags) ? member.roleTags : [];
    return {
      index: index + 1,
      userId: member.userId || member.id || '',
      username: member.username || member.displayName || 'Bilinmiyor',
      displayName: member.displayName || member.username || 'Bilinmiyor',
      avatarUrl: member.avatarUrl || '',
      roleTags,
      dailyCount: Number(member.dailyCount || member.daily || 0),
      totalCount: Number(member.totalCount || member.total || 0),
      weeklyCount: Number(member.weeklyCount || member.weekly || 0),
      active,
      activeMinutesAgo,
      lastMessageAt
    };
  });

  const summary = {
    totalStaff: rows.length,
    dailyMessages: rows.reduce((a, b) => a + Number(b.dailyCount || 0), 0),
    totalMessages: rows.reduce((a, b) => a + Number(b.totalCount || 0), 0),
    activeName: (rows.slice().sort((a,b) => b.dailyCount - a.dailyCount)[0] || {}).displayName || '-',
    selectedChannelCount: followedChannelIds.length,
    selectedRoleCount: followedRoleIds.length,
    discordStatus: discordState && discordState.connected ? ('Bağlı - ' + (discordState.userTag || '')) : 'Bağlı değil'
  };

  const memberDirectory = rows.map(r => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    roleTags: r.roleTags,
    active: r.active
  }));

  const logsObj = logs || { recent: [], weeklyTop: [] };

  return { summary, rows, memberDirectory, logs: logsObj };
}

app.get('/logs', authRequired, async (req, res) => {
  const panelData = await buildPanelData();
  await renderWithLayout(res, 'logs', {
    currentPath: '/logs',
    panelData,
    message: req.query.message || '',
    messageType: req.query.type || ''
  });
});

app.get('/settings', authRequired, async (req, res) => {
  const panelData = await buildPanelData();
  await renderWithLayout(res, 'settings', {
    currentPath: '/settings',
    saved: req.query.saved === '1',
    message: req.query.message || '',
    messageType: req.query.type || '',
    panelData
  });
});


app.post('/settings/badges', authRequired, (req, res) => {
  badgeConfig = {
    activeBadgeMin: Math.max(1, Number(req.body.activeBadgeMin || 50)),
    legendBadgeMin: Math.max(1, Number(req.body.legendBadgeMin || 200)),
    leaderBadgeMin: Math.max(1, Number(req.body.leaderBadgeMin || 500)),
  };
  writeJson(BADGES_PATH, badgeConfig);
  return res.redirect('/settings?saved=1&type=success&message=' + encodeURIComponent('Rozet ayarlari kaydedildi.'));
});

app.post('/settings', authRequired, async (req, res) => {
  config.panelTitle = (req.body.panelTitle || defaultConfig.panelTitle).trim() || defaultConfig.panelTitle;
  config.panelSubtitle = (req.body.panelSubtitle || defaultConfig.panelSubtitle).trim() || defaultConfig.panelSubtitle;
  config.managementSectionTitle = (req.body.managementSectionTitle || defaultConfig.managementSectionTitle).trim() || defaultConfig.managementSectionTitle;
  saveConfig();

  const action = req.body.action || 'save';

  if (action === 'sync') {
    const result = await syncGuildResources({ forceReconnect: false });
    return res.redirect(`/settings?saved=1&type=${result.ok ? 'success' : 'error'}&message=${encodeURIComponent(result.message)}`);
  }

  return res.redirect('/settings?saved=1&type=success&message=' + encodeURIComponent('Ayarlar kaydedildi.'));
});

app.post('/api/settings/tracking', authRequired, async (req, res) => {
  config.selectedChannelIds = toArray(req.body.selectedChannelIds);
  config.selectedRoleIds = toArray(req.body.selectedRoleIds);
  config.usernameSourceChannelId = typeof req.body.usernameSourceChannelId === 'string' ? req.body.usernameSourceChannelId : '';
  saveConfig();
  trackedMembersCacheAt = 0;
  await refreshTrackedMembers({ refreshGuild: false, force: true });
  return res.json({ ok: true, selectedChannelIds: config.selectedChannelIds, selectedRoleIds: config.selectedRoleIds, usernameSourceChannelId: config.usernameSourceChannelId });
});

app.post('/settings/tracking', authRequired, async (req, res) => {
  config.selectedChannelIds = toArray(req.body.selectedChannelIds);
  config.selectedRoleIds = toArray(req.body.selectedRoleIds);
  config.usernameSourceChannelId = typeof req.body.usernameSourceChannelId === 'string' ? req.body.usernameSourceChannelId : '';
  saveConfig();
  trackedMembersCacheAt = 0;
  await refreshTrackedMembers({ refreshGuild: true, force: true });
  return res.redirect('/settings?saved=1&type=success&message=' + encodeURIComponent('Sayım ayarları kaydedildi.'));
});

app.post('/settings/sync', authRequired, async (req, res) => {
  const result = await syncGuildResources({ forceReconnect: false });
  return res.redirect(`/settings?saved=1&type=${result.ok ? 'success' : 'error'}&message=${encodeURIComponent(result.message)}`);
});

app.post('/reset-daily', authRequired, (req, res) => {
  createJsonBackup('daily-reset');
  manualDailyReset();
  res.redirect('/?type=success&message=' + encodeURIComponent('Günlük aktivite verileri sıfırlandı.'));
});

app.post('/activity/reset', authRequired, (req, res) => {
  try {
    createJsonBackup('activity-reset');
    resetActivityTracker();
    return res.redirect('/?type=success&message=' + encodeURIComponent('Aktivite Takibi paneli sıfırlandı.'));
  } catch (err) {
    return res.redirect('/?type=error&message=' + encodeURIComponent('Aktivite Takibi sıfırlanamadı: ' + err.message));
  }
});

app.post('/message-stats/reset', authRequired, (req, res) => {
  try {
    createJsonBackup('message-stats-reset');
    resetMessageTrackerPanel();
    return res.redirect('/message-stats?type=success&message=' + encodeURIComponent('Mesaj Takip paneli sıfırlandı.'));
  } catch (err) {
    return res.redirect('/message-stats?type=error&message=' + encodeURIComponent('Mesaj Takip sıfırlanamadı: ' + err.message));
  }
});

app.post('/logs/reset', authRequired, (req, res) => {
  try {
    createJsonBackup('logs-reset');
    resetLogsPanel();
    return res.redirect('/logs?type=success&message=' + encodeURIComponent('Log paneli sıfırlandı.'));
  } catch (err) {
    return res.redirect('/logs?type=error&message=' + encodeURIComponent('Log paneli sıfırlanamadı: ' + err.message));
  }
});

app.post('/payments/reset', authRequired, (req, res) => {
  try {
    createJsonBackup('payments-reset');
    resetPaymentsPanel();
    return res.redirect('/payments?type=success&message=' + encodeURIComponent('Yatırılan Ödeme paneli sıfırlandı.'));
  } catch (err) {
    return res.redirect('/payments?type=error&message=' + encodeURIComponent('Yatırılan Ödeme sıfırlanamadı: ' + err.message));
  }
});

app.get('/api/stats', authRequired, async (req, res) => {
  res.json(await buildPanelData());
});


app.get('/api/message-stats', authRequired, async (req, res) => {
  res.json(await buildMessageTrackerData());
});

app.get('/api/live-dashboard', authRequired, async (req, res) => {
  try {
    const data = await buildPanelData();
    return res.json({
      ok: true,
      summary: data.summary,
      userRows: data.userRows || [],
      memberDirectory: data.memberDirectory || [],
      logs: data.logs || { recent: [], weeklyTop: [] },
      selectedChannels: data.selectedChannels || [],
      selectedRoles: data.selectedRoles || [],
      discordConnected: Boolean(data.discordState && data.discordState.connected),
      serverTime: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
    });
  } catch (err) {
    return res.json({ ok: false, message: err.message });
  }
});


app.post('/admin/create-backup', authRequired, (req, res) => {
  try {
    const backupFile = createJsonBackup('manual');
    return res.redirect('/settings?saved=1&type=success&message=' + encodeURIComponent('Yedek oluşturuldu: ' + path.basename(backupFile)));
  } catch (err) {
    return res.redirect('/settings?saved=1&type=error&message=' + encodeURIComponent('Yedek oluşturulamadı: ' + err.message));
  }
});

app.get('/admin/create-backup', authRequired, (req, res) => {
  try {
    const backupFile = createJsonBackup('manual-get');
    return res.redirect('/settings?saved=1&type=success&message=' + encodeURIComponent('Yedek oluşturuldu: ' + require('path').basename(backupFile)));
  } catch (err) {
    return res.redirect('/settings?saved=1&type=error&message=' + encodeURIComponent('Yedek oluşturulamadı: ' + err.message));
  }
});



app.get('/api/backup-status', authRequired, (req, res) => {
  try {
    const backupDir = path.join(DATA_DIR, 'backups');
    const files = fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir).filter(name => name.endsWith('.json')).sort().reverse()
      : [];
    return res.json({ ok: true, dataDir: DATA_DIR, backups: files.slice(0, 10) });
  } catch (err) {
    return res.json({ ok: false, message: err.message });
  }
});


app.use((req, res) => {
  res.status(404).send('Sayfa bulunamadı.');
});

app.listen(PORT, async () => {
  startAutomaticBackups();
  try { createJsonBackup('startup'); } catch (err) { console.error('Acilis yedegi alinamadi:', err.message); }
  ensureMessageTrackerReset();
  console.log(`Panel http://localhost:${PORT} adresinde çalışıyor.`);
  startBackgroundPresenceRefresh();
  if (secureRuntime.botToken && secureRuntime.guildId) {
    const result = await connectDiscord(false);
    if (!result.ok) {
      console.error('Discord bağlantısı kurulamadı:', result.message);
    } else if (config.selectedRoleIds.length) {
      refreshTrackedMembers({ refreshGuild: false, force: true }).catch(err => console.error('İlk üye yenileme hatası:', err.message || err));
    }
  } else {
    console.log('Bot güvenli modda başlatıldı. .env içine BOT_TOKEN ve GUILD_ID ekleyin.');
  }
});
