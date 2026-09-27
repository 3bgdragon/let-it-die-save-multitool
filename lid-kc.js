#!/usr/bin/env node
'use strict';
const { message: tr, configure: configureLanguage } = require('./language');
if (require.main === module) {
  try { process.argv = [...process.argv.slice(0, 2), ...configureLanguage(process.argv.slice(2), __dirname)]; }
  catch (error) { console.error(error.message); process.exit(1); }
}


const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const childProcess = require('child_process');
const readline = require('readline/promises');

const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split('.').map(Number);
if (NODE_MAJOR < 22 || (NODE_MAJOR === 22 && NODE_MINOR < 5)) {
  console.error(tr(0));
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');

let masterDatabaseOverridePath = null;

const FORMAT_MAGIC = Buffer.from([0x42, 0x52, 0x47, 0x00]); // BRG\0
const FORMAT_VERSION = 2;
const FORMAT_CODEC = Buffer.from('ZLIB', 'ascii');
const INT32_MAX = 2_147_483_647;
const BLOODNIUM_SHOP_AVAILABLE_FIELD = 'automaticshop_bloodnium_exchangeable_goods_ids';
const BLOODNIUM_SHOP_BOUGHT_FIELD = 'automaticshop_bloodnium_exchanged_goods_ids';
const COLLISION_MUSHROOM_EFFECT_IDS = [
  'MSREFC_ATK_UP_01', // 충돌버섯
  'MSREFC_ATK_UP_02', // 구운 충돌버섯
];
const COLLISION_MUSHROOM_DURATION_SECONDS = 30 * 60;
const COLLISION_MUSHROOM_DEFAULT_DURATIONS = {
  MSREFC_ATK_UP_01: 30, // 일반 충돌버섯 30초
  MSREFC_ATK_UP_02: 40, // 구운 충돌버섯 40초
};
const ULTIMATE_FIGHTER_RETURN_ID = 'SKL_FIGHTER_STUP_02_P';
const ULTIMATE_FIGHTER_RETURN_BASE_PERCENT = 20;
const ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT =
  ULTIMATE_FIGHTER_RETURN_BASE_PERCENT * 5;
const QUEEN_OF_SPADES_ID = 'SKL_SYLVIA_NMH_02_P';
const QUEEN_OF_SPADES_BASE_ATTACK_PERCENT = 30;
const QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT = 1_000; // Backward-compatible quick preset.
const QUEEN_OF_SPADES_MAX_PERCENT = 2_147_483_647; // Positive signed 32-bit effect parameter, not a safe damage bound.
const WOLF_RAGE_DECAL_IDS = ['SKL_RGSPDUP_02', 'SKL_RGSPDUP_02_P', 'SKL_RGSPUP_RDURDOWN_01_P'];
const WOLF_RAGE_DEFAULT_VALUES = {
  SKL_RGSPDUP_02: 80,
  SKL_RGSPDUP_02_P: 80,
  SKL_RGSPUP_RDURDOWN_01_P: 120,
};
const WOLF_RAGE_TARGET_PERCENT = 1_000; // 레이지 축적 속도 +1,000% (오버플로/단타 즉사 시에도 1타당 게이지 즉시 충전)
const RICH_FAMILY_DECAL_ID = 'SKL_RESUP_DECDOWN_P';
const RICH_FAMILY_DEFAULT_RESOURCE = 20;
const RICH_FAMILY_DEFAULT_DURABILITY = 20;
const RICH_FAMILY_RECOMMENDED_RESOURCE = 500;
const RICH_FAMILY_INFINITE_DURABILITY = 100;
const NAOMI_DETOX_DECAL_ID = 'SKL_RESUP_DECDOWN_01_P';
const NAOMI_DETOX_DEFAULT_RESOURCE = 50;
const NAOMI_DETOX_DEFAULT_DURABILITY = 0;
const NAOMI_DETOX_RECOMMENDED_RESOURCE = 500;
const NAOMI_DETOX_INFINITE_DURABILITY = 100;
const KAMAS_RE_FINAL_PART_ID = 'PT_ARM_WP031_0B5';
const EQUIPMENT_MATERIAL_COLUMNS = [
  'buy_mate1_num', 'buy_mate2_num', 'buy_mate3_num', 'buy_mate4_num', 'buy_mate5_num',
  'craft_mate1_num', 'craft_mate2_num', 'craft_mate3_num', 'craft_mate4_num', 'craft_mate5_num',
  'lvup_mate1_num', 'lvup_mate2_num', 'lvup_mate3_num', 'lvup_mate4_num', 'lvup_mate5_num',
  'lvup_mate1_add_num', 'lvup_mate2_add_num', 'lvup_mate3_add_num',
  'lvup_mate4_add_num', 'lvup_mate5_add_num',
];
const EQUIPMENT_MATERIAL_BACKUP_PREFIX = 'masters.db.equipment-materials.';
// Older builds wrote this exact set to the end of the gacha history. Keep the
// list only so those erroneous history entries can still be removed safely.
const LEGACY_FIVE_STAR_DECAL_IDS = [
  'SKL_ATKUP_03_P',
  'SKL_RGSPUP_RDURDOWN_01_P',
  'SKL_WARRIORS_01_P',
  'SKL_DEFUP_03_P',
  'SKL_CRIUP_03_P',
  'SKL_ADVENTURE_01_P',
  'SKL_HPUP_03_P',
  'SKL_SPDUP_03_P',
  'SKL_WWEP_ATKUP_EX_01_P',
  'SKL_DEATH_PROOF_03_P',
  'SKL_DEFUP_NODMG_RND_01_P',
  'SKL_STRENGTHEN_BODY_01_P',
  'SKL_DODGEUP_03_P',
  'SKL_ARRNG_STATUP_ALL_P',
  'SKL_ST_AILMENT_DIS_01_P',
  'SKL_GUNMAN_01_P',
  'SKL_CRIUP_ATKUP_01_P',
  'SKL_EXPLODE_DRAIN_P',
  'SKL_NTHEAL_ATDFUPHPMAX_P',
  'SKL_STUP_FEAT_HPCUREUP_P',
  'SKL_FEMALE_GUNMAN_P',
  'SKL_ATKUP_CRIUP_DEFDWN_P',
  'SKL_SAMANTHA_K7_02_P',
  'SKL_CRIUP_DECDOWN_02_P',
  'SKL_ATKUP_SANDS_P',
  'SKL_POISONGENERAL_P',
  'SKL_DISALL_ATKUP_HPDWN_P',
  'SKL_ATK_CRIATK_MONEYUP_P',
  'SKL_FIREANGEL_P',
  'SKL_DIY_UP_02_P',
  'SKL_MIL_UP_02_P',
  'SKL_ELECTROBEAST_P',
  'SKL_FAN_UP_02_P',
  'SKL_SYLVIA_NMH_02_P',
  'SKL_SPO_UP_02_P',
  'SKL_SEASONING_M_P',
  'SKL_E_BURST_P',
  'SKL_STRENGTHEN_BODY_B_P',
  'SKL_WHITEFEATHER_P',
  'SKL_QOH_P',
  'SKL_TOHEAVEN_P',
];
const STEAM_DECAL_DEFINITION_COUNT = 329;
const GOLDEN_BEAST_IDS = [
  'BST_GFROG',
  'BST_GSCORPION',
  'BST_GRAT',
  'BST_GBASS',
  'BST_GSNAIL',
  'BST_GCRAB',
  'BST_GPILLBUG',
  'BST_GLIZARD',
  'BST_GHONEYCOMB',
  'BST_GTURTLE',
  'BST_GCASSOWARY',
];
const COIN_LOCKER_BEAST_TYPE = 2;
// Steam-compatible blueprints that were distributed through time-limited
// events, collaborations, DLC campaigns, or seasonal event rewards. Console-
// only definitions (platform=1) and Iron Hammer EXRG, which has no R&D recipe,
// are intentionally excluded.
const LIMITED_RECIPE_IDS = [
  'PT_ARM_WP001_0N1', // Beam Katana
  'PT_ARM_WP011_0B1', // Iron Hammer RG
  'PT_ARM_WP001_0B1', // Jungle Machete E RG
  'PT_MIL_HEAD_0G1', // Assault Force Head G
  'PT_MIL_TOPS_0G1', // Assault Force Body G
  'PT_MIL_BTM_0G1', // Assault Force Pants G
  'PT_SPE_HEAD_015', // Travis' Sunglasses
  'PT_SPE_TOPS_015', // Travis' Jacket
  'PT_SPE_BTM_015', // Travis' Pants
  'PT_SPE_HEAD_021', // Meijin Head
  'PT_SPE_HEAD_025', // Uncle-D2 Head
  'PT_SPE_HEAD_027', // Momoko Yamada Head
  'PT_SPE_HEAD_013', // Space Funglasses
  'PT_SPE_HEAD_017', // Ultra 3D Glasses
  'PT_SPE_HEAD_019', // Ultra 3D Glasses W
  'PT_SPE_HEAD_018', // X-Rated Glasses
  'PT_SPE_HEAD_023', // DAIMON Glasses
  'PT_SPE_HEAD_024', // Happy Yuppie Glasses
  'PT_ARM_WP050_0R1', // Grim Reaper's Scythe R1
  'PT_ARM_WP041_0A1', // Executioner's Ride ZX
  'PT_FAN_HEAD_0A1', // Knight's Helm ZX
  'PT_FAN_TOPS_0A1', // Knight's Armor ZX
  'PT_FAN_BTM_0A1', // Knight's Leggings ZX
  'PT_ARM_WP002_0Y1', // Yes Knife
  'PT_ARM_WP002_0N1', // No Knife
];
const LIMITED_RECIPE_DEFINITION_COUNT = 25;
const ALL_RECIPE_DEFINITION_COUNT = 356;

// Levels 1-50 from the original table. Offline version 5.0.1.0 adds levels
// 51-99; those values are handled by getFacilityCapacity below.
const BANK_CAPACITY = [
  0,
  50_000, 60_000, 70_000, 80_000, 90_000,
  100_000, 110_000, 120_000, 140_000, 160_000,
  192_000, 224_000, 256_000, 288_000, 320_000,
  352_000, 384_000, 416_000, 448_000, 480_000,
  528_000, 576_000, 624_000, 672_000, 720_000,
  768_000, 816_000, 864_000, 912_000, 960_000,
  984_000, 1_008_000, 1_032_000, 1_056_000, 1_080_000,
  1_104_000, 1_128_000, 1_152_000, 1_176_000, 1_200_000,
  1_208_000, 1_216_000, 1_224_000, 1_232_000, 1_240_000,
  1_248_000, 1_256_000, 1_264_000, 1_272_000, 1_280_000,
];

const RESOURCES = {
  killcoins: {
    label: tr(1),
    field: 'free_money',
    levelField: 'safe_level',
  },
  splithium: {
    label: tr(2),
    field: 'spirit',
    levelField: 'spirit_tank_level',
  },
  bloodnium: {
    label: tr(3),
    field: 'bloodnium_point',
    fixedCapacity: 999_999,
  },
};

const RESOURCE_ALIASES = {
  kc: 'killcoins',
  killcoin: 'killcoins',
  killcoins: 'killcoins',
  money: 'killcoins',
  sp: 'splithium',
  splithium: 'splithium',
  spirit: 'splithium',
  blood: 'bloodnium',
  bloodnium: 'bloodnium',
};

function fail(message) {
  const error = new Error(message);
  error.userFacing = true;
  throw error;
}

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(value);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getResourceKey(value) {
  const key = RESOURCE_ALIASES[String(value ?? '').toLowerCase()];
  if (!key) fail(tr(4));
  return key;
}

function getResourceAmount(save, resourceKey) {
  const resource = RESOURCES[resourceKey];
  if (!resource) fail(tr(5, resourceKey));
  return save.data?.soul?.[resource.field] ?? 0;
}

function getFacilityCapacity(level) {
  if (!Number.isInteger(level) || level < 1) return undefined;
  if (BANK_CAPACITY[level]) return BANK_CAPACITY[level];

  // Verified against BrgGame/Content/masters.db tables master_safe_level and
  // master_spirit_tank_level from offline version 5.0.1.0.
  if (level >= 51 && level <= 98) {
    return 1_280_000 + ((level - 50) * 26_000);
  }
  if (level === 99) return 2_560_000;
  return undefined;
}

function getKnownCapacity(save, resourceKey) {
  const resource = RESOURCES[resourceKey];
  if (resource.fixedCapacity) return resource.fixedCapacity;
  const level = save.data.soul[resource.levelField];
  return getFacilityCapacity(level);
}

function readSave(savePath) {
  const packed = fs.readFileSync(savePath);
  if (packed.length < 24 || !packed.subarray(0, 4).equals(FORMAT_MAGIC)) {
    fail(tr(6));
  }

  const version = packed.readUInt32LE(4);
  if (version !== FORMAT_VERSION) {
    fail(tr(7, version, FORMAT_VERSION));
  }
  if (!packed.subarray(12, 16).equals(FORMAT_CODEC)) {
    fail(tr(8));
  }

  const declaredSize = packed.readUInt32LE(8);
  const parts = [];
  let offset = 16;
  let decodedSize = 0;

  while (decodedSize < declaredSize) {
    if (offset + 8 > packed.length) {
      fail(tr(9));
    }
    const unpackedSize = packed.readUInt32LE(offset);
    const compressedSize = packed.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + compressedSize;
    if (compressedSize === 0 || end > packed.length) {
      fail(tr(10));
    }

    let part;
    try {
      part = zlib.inflateSync(packed.subarray(start, end));
    } catch (error) {
      fail(tr(11, error.message));
    }
    if (part.length !== unpackedSize) {
      fail(tr(12));
    }
    parts.push(part);
    decodedSize += part.length;
    offset = end;
  }

  if (decodedSize !== declaredSize) {
    fail(tr(13));
  }

  const trailer = packed.subarray(offset);
  if (trailer.length !== 4 || !trailer.equals(Buffer.alloc(4))) {
    fail(tr(14));
  }

  const jsonBuffer = Buffer.concat(parts);
  const jsonText = jsonBuffer.toString('utf8');
  if (!Buffer.from(jsonText, 'utf8').equals(jsonBuffer)) {
    fail(tr(15));
  }

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (error) {
    fail(tr(16, error.message));
  }
  if (!data.soul) {
    fail(tr(17));
  }
  for (const resource of Object.values(RESOURCES)) {
    if (!Number.isSafeInteger(data.soul[resource.field])) {
      fail(tr(18, resource.label, resource.field));
    }
  }

  return {
    packed,
    jsonText,
    data,
    blockCount: parts.length,
    trailer,
  };
}

function skipWhitespace(text, offset) {
  while (offset < text.length && /\s/.test(text[offset])) offset += 1;
  return offset;
}

function readJsonStringEnd(text, start) {
  if (text[start] !== '"') fail(tr(19));
  let escaped = false;
  for (let offset = start + 1; offset < text.length; offset += 1) {
    const character = text[offset];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      return offset + 1;
    }
  }
  fail(tr(20));
}

function findJsonValueEnd(text, start) {
  start = skipWhitespace(text, start);
  if (text[start] === '"') return readJsonStringEnd(text, start);
  if (text[start] !== '{' && text[start] !== '[') {
    let end = start;
    while (end < text.length && ![',', '}', ']'].includes(text[end])) end += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    return end;
  }

  const stack = [text[start]];
  for (let offset = start + 1; offset < text.length; offset += 1) {
    const character = text[offset];
    if (character === '"') {
      offset = readJsonStringEnd(text, offset) - 1;
    } else if (character === '{' || character === '[') {
      stack.push(character);
    } else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack.pop() !== expected) fail(tr(21));
      if (stack.length === 0) return offset + 1;
    }
  }
  fail(tr(22));
}

function findObjectProperty(text, objectStart, propertyName) {
  let offset = skipWhitespace(text, objectStart);
  if (text[offset] !== '{') fail(tr(23));
  offset += 1;

  while (offset < text.length) {
    offset = skipWhitespace(text, offset);
    if (text[offset] === '}') break;
    const keyStart = offset;
    const keyEnd = readJsonStringEnd(text, keyStart);
    let key;
    try {
      key = JSON.parse(text.slice(keyStart, keyEnd));
    } catch {
      fail(tr(24));
    }
    offset = skipWhitespace(text, keyEnd);
    if (text[offset] !== ':') fail(tr(25));
    const valueStart = skipWhitespace(text, offset + 1);
    const valueEnd = findJsonValueEnd(text, valueStart);
    if (key === propertyName) return { valueStart, valueEnd };
    offset = skipWhitespace(text, valueEnd);
    if (text[offset] === ',') {
      offset += 1;
    } else if (text[offset] !== '}') {
      fail(tr(26));
    }
  }
  fail(tr(27, propertyName));
}

function replaceResource(save, resourceKey, amount) {
  const resource = RESOURCES[resourceKey];
  const soul = findObjectProperty(save.jsonText, 0, 'soul');
  const field = findObjectProperty(save.jsonText, soul.valueStart, resource.field);
  const rawValue = save.jsonText.slice(field.valueStart, field.valueEnd);
  if (!/^-?\d+$/.test(rawValue)) {
    fail(tr(28, resource.label));
  }
  const current = Number(rawValue);
  if (current !== save.data.soul[resource.field]) {
    fail(tr(29, resource.label));
  }

  const changedText = save.jsonText.slice(0, field.valueStart) +
    String(amount) + save.jsonText.slice(field.valueEnd);

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(30, error.message));
  }
  if (changedData.soul[resource.field] !== amount) {
    fail(tr(31, resource.label));
  }

  // The output is constructed from the original text plus one numeric token.
  // This guarantees no other JSON field is serialized or normalized.
  return changedText;
}

function parseGoodsIds(value, fieldName) {
  if (typeof value !== 'string') {
    fail(tr(32, fieldName));
  }
  if (value === '') return [];
  const ids = value.split(',');
  if (ids.some((id) => !/^\d+$/.test(id))) {
    fail(tr(33, fieldName));
  }
  return ids;
}

function getBloodniumShopState(save) {
  if (!save.data.user || typeof save.data.user !== 'object') {
    fail(tr(34));
  }
  const available = parseGoodsIds(
    save.data.user[BLOODNIUM_SHOP_AVAILABLE_FIELD],
    BLOODNIUM_SHOP_AVAILABLE_FIELD,
  );
  const bought = parseGoodsIds(
    save.data.user[BLOODNIUM_SHOP_BOUGHT_FIELD],
    BLOODNIUM_SHOP_BOUGHT_FIELD,
  );
  // Repeated purchase-history entries are not an item quantity. Reading must
  // not rewrite the save or prevent unrelated tool features from opening.
  const uniqueAvailable = [...new Set(available)];
  const uniqueBought = [...new Set(bought)];
  const duplicateCount = available.length + bought.length - new Set([...available, ...bought]).size;
  return { available: uniqueAvailable, bought: uniqueBought, duplicateCount,
    needsReset: bought.length > 0 || duplicateCount > 0 };
}

function replaceObjectStringProperty(jsonText, objectName, propertyName, expectedValue, newValue) {
  const object = findObjectProperty(jsonText, 0, objectName);
  const field = findObjectProperty(jsonText, object.valueStart, propertyName);
  const rawValue = jsonText.slice(field.valueStart, field.valueEnd);
  let currentValue;
  try {
    currentValue = JSON.parse(rawValue);
  } catch {
    fail(tr(35, propertyName));
  }
  if (currentValue !== expectedValue) {
    fail(tr(36, propertyName));
  }
  return jsonText.slice(0, field.valueStart) +
    JSON.stringify(newValue) + jsonText.slice(field.valueEnd);
}

function replaceBloodniumShopHistory(save) {
  const state = getBloodniumShopState(save);
  const restored = [...new Set([...state.available, ...state.bought])];
  let changedText = replaceObjectStringProperty(
    save.jsonText,
    'user',
    BLOODNIUM_SHOP_AVAILABLE_FIELD,
    save.data.user[BLOODNIUM_SHOP_AVAILABLE_FIELD],
    restored.join(','),
  );
  changedText = replaceObjectStringProperty(
    changedText,
    'user',
    BLOODNIUM_SHOP_BOUGHT_FIELD,
    save.data.user[BLOODNIUM_SHOP_BOUGHT_FIELD],
    '',
  );

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(30, error.message));
  }
  if (changedData.user[BLOODNIUM_SHOP_AVAILABLE_FIELD] !== restored.join(',') ||
      changedData.user[BLOODNIUM_SHOP_BOUGHT_FIELD] !== '') {
    fail(tr(37));
  }
  return { changedText, previous: state, restored };
}

function findJsonPath(text, propertyNames) {
  let objectStart = 0;
  let field;
  for (let index = 0; index < propertyNames.length; index += 1) {
    field = findObjectProperty(text, objectStart, propertyNames[index]);
    if (index < propertyNames.length - 1) objectStart = field.valueStart;
  }
  return field;
}

function getGachaHistory(save) {
  const history = save.data?.soul?.skl?.gacha?.normal?.sklids;
  if (history && !Array.isArray(history) && typeof history === 'object' && Object.keys(history).length === 0) {
    return [];
  }
  if (!Array.isArray(history) || history.some((id) => typeof id !== 'string')) {
    fail(tr(38));
  }
  return history;
}

function getDecalStock(save) {
  const stock = save.data?.soul?.skl?.psskl;
  if (!Array.isArray(stock)) fail(tr(39));
  const ids = new Set();
  for (const entry of stock) {
    if (!entry || typeof entry !== 'object' || typeof entry.sklid !== 'string' ||
        !Number.isSafeInteger(entry.cnt) || entry.cnt < 0 ||
        !Number.isSafeInteger(entry.updated) || ![0, 1].includes(entry.is_checked)) {
      fail(tr(40));
    }
    if (ids.has(entry.sklid)) fail(tr(41, entry.sklid));
    ids.add(entry.sklid);
  }
  return stock;
}

function arrayEndsWith(array, suffix) {
  if (array.length < suffix.length) return false;
  const offset = array.length - suffix.length;
  return suffix.every((value, index) => array[offset + index] === value);
}

function replaceAllDecals(save, decalIds) {
  if (!Array.isArray(decalIds) || decalIds.length !== STEAM_DECAL_DEFINITION_COUNT ||
      new Set(decalIds).size !== STEAM_DECAL_DEFINITION_COUNT ||
      decalIds.some((id) => typeof id !== 'string' || !id)) {
    fail(tr(42));
  }
  if (LEGACY_FIVE_STAR_DECAL_IDS.length !== 41 ||
      new Set(LEGACY_FIVE_STAR_DECAL_IDS).size !== 41) {
    fail(tr(43));
  }
  const history = getGachaHistory(save);
  const stock = getDecalStock(save);
  let changedText = save.jsonText;

  // Earlier tool builds incorrectly appended grants to the draw history.
  // Remove only exact trailing 41-item sets written by those builds.
  const cleanedHistory = [...history];
  let removedHistoryCount = 0;
  while (arrayEndsWith(cleanedHistory, LEGACY_FIVE_STAR_DECAL_IDS)) {
    cleanedHistory.splice(-LEGACY_FIVE_STAR_DECAL_IDS.length);
    removedHistoryCount += LEGACY_FIVE_STAR_DECAL_IDS.length;
  }
  if (removedHistoryCount > 0) {
    const historyField = findJsonPath(changedText, ['soul', 'skl', 'gacha', 'normal', 'sklids']);
    changedText = changedText.slice(0, historyField.valueStart) +
      JSON.stringify(cleanedHistory) + changedText.slice(historyField.valueEnd);
  }

  const stockField = findJsonPath(changedText, ['soul', 'skl', 'psskl']);
  const rawValue = changedText.slice(stockField.valueStart, stockField.valueEnd);
  let rawStock;
  try {
    rawStock = JSON.parse(rawValue);
  } catch {
    fail(tr(44));
  }
  if (JSON.stringify(rawStock) !== JSON.stringify(stock)) {
    fail(tr(45));
  }

  const now = Math.floor(Date.now() / 1000);
  const changedStock = stock.map((entry) => ({ ...entry }));
  const stockIndex = new Map(changedStock.map((entry, index) => [entry.sklid, index]));
  let newTypes = 0;
  let incrementedTypes = 0;
  for (const id of decalIds) {
    const index = stockIndex.get(id);
    if (index === undefined) {
      changedStock.push({ sklid: id, cnt: 1, updated: now, is_checked: 0 });
      stockIndex.set(id, changedStock.length - 1);
      newTypes += 1;
    } else {
      changedStock[index] = {
        ...changedStock[index],
        cnt: changedStock[index].cnt + 1,
        updated: now,
        is_checked: 0,
      };
      incrementedTypes += 1;
    }
  }
  changedText = changedText.slice(0, stockField.valueStart) +
    JSON.stringify(changedStock) + changedText.slice(stockField.valueEnd);

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(30, error.message));
  }
  const verifiedHistory = changedData?.soul?.skl?.gacha?.normal?.sklids;
  const verifiedStock = changedData?.soul?.skl?.psskl;
  const historyMatches = Array.isArray(verifiedHistory)
    ? verifiedHistory.length === cleanedHistory.length
    : (typeof verifiedHistory === 'object' && Object.keys(verifiedHistory).length === 0 && cleanedHistory.length === 0);
  if (!historyMatches ||
      !Array.isArray(verifiedStock) || verifiedStock.length !== changedStock.length) {
    fail(tr(46));
  }
  const previousCounts = new Map(stock.map((entry) => [entry.sklid, entry.cnt]));
  const verifiedCounts = new Map(verifiedStock.map((entry) => [entry.sklid, entry.cnt]));
  for (const id of decalIds) {
    if (verifiedCounts.get(id) !== (previousCounts.get(id) ?? 0) + 1) {
      fail(tr(47, id));
    }
  }
  return {
    changedText,
    changedStock,
    previousStockCount: stock.length,
    newTypes,
    incrementedTypes,
    removedHistoryCount,
  };
}

function getBeastStock(save) {
  const stock = save.data?.beast?.bsts;
  if (stock && !Array.isArray(stock) && typeof stock === 'object' && Object.keys(stock).length === 0) {
    return [];
  }
  if (!Array.isArray(stock)) fail(tr(48));
  for (const entry of stock) {
    if (!entry || typeof entry !== 'object' || typeof entry.eid !== 'string' || !entry.eid ||
        typeof entry.owner !== 'string' || typeof entry.bstid !== 'string' ||
        typeof entry.rwdemsrid !== 'string') {
      fail(tr(49));
    }
  }
  return stock;
}

function getMushroomStock(save) {
  const stock = save.data?.mushroom?.msrs;
  if (!Array.isArray(stock)) fail(tr(50));
  for (const entry of stock) {
    if (!entry || typeof entry !== 'object' || typeof entry.eid !== 'string' || !entry.eid ||
        typeof entry.owner !== 'string' || typeof entry.msrid !== 'string') {
      fail(tr(51));
    }
  }
  return stock;
}

function getCoinLockerSlots(save) {
  const slots = save.data?.soul?.cl;
  if (!Array.isArray(slots)) fail(tr(52));
  const slotNumbers = new Set();
  for (const entry of slots) {
    if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.slot) || entry.slot < 0 ||
        !Number.isSafeInteger(entry.type) || typeof entry.eid !== 'string') {
      fail(tr(53));
    }
    if (slotNumbers.has(entry.slot)) fail(tr(54, entry.slot));
    slotNumbers.add(entry.slot);
  }
  return slots;
}

function getGoldenBeastSummary(save) {
  const goldenIds = new Set(GOLDEN_BEAST_IDS);
  const stored = getBeastStock(save).filter(
    (entry) => entry.owner === 'COIN_LOCKER' && goldenIds.has(entry.bstid),
  );
  return {
    count: stored.length,
    typeCount: new Set(stored.map((entry) => entry.bstid)).size,
  };
}

function getRecipeUnlockState(save, recipeIds, label) {
  if (!Array.isArray(recipeIds) || recipeIds.length === 0 ||
      new Set(recipeIds).size !== recipeIds.length ||
      recipeIds.some((id) => typeof id !== 'string' || !id)) {
    fail(tr(55, label));
  }
  const research = save.data?.soul?.partresearch?.user;
  if (!Array.isArray(research)) {
    fail(tr(56));
  }

  const targetIds = new Set(recipeIds);
  const levelsById = new Map(recipeIds.map((id) => [id, new Set()]));
  for (const entry of research) {
    if (!targetIds.has(entry?.ptid)) continue;
    // Existing saves use additional state flag values depending on how and
    // when a recipe was obtained. Ownership only depends on ptid + lvl, and
    // every existing object is preserved byte-for-byte by the mutation.
    if (!Number.isSafeInteger(entry.lvl) || entry.lvl < 1) {
      fail(tr(57, label, entry.ptid));
    }
    const levels = levelsById.get(entry.ptid);
    if (levels.has(entry.lvl)) {
      fail(tr(58, label, entry.ptid, entry.lvl));
    }
    levels.add(entry.lvl);
  }

  const ownedIds = [];
  const missingIds = [];
  for (const id of recipeIds) {
    const levels = levelsById.get(id);
    if (levels.size > 0) {
      ownedIds.push(id);
    } else {
      missingIds.push(id);
    }
  }
  return { research, ownedIds, missingIds };
}

function getLimitedRecipeState(save) {
  if (LIMITED_RECIPE_IDS.length !== LIMITED_RECIPE_DEFINITION_COUNT) {
    fail(tr(59));
  }
  return getRecipeUnlockState(save, LIMITED_RECIPE_IDS, tr(60));
}

function replaceRecipeUnlocks(save, definitions, label) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    fail(tr(61, label));
  }
  const definitionIds = definitions.map((entry) => entry.id);
  if (new Set(definitionIds).size !== definitionIds.length ||
      definitionIds.some((id) => typeof id !== 'string' || !id)) {
    fail(tr(62, label));
  }

  const state = getRecipeUnlockState(save, definitionIds, label);
  if (state.missingIds.length === 0) {
    return { changedText: save.jsonText, state, addedIds: [], changedResearch: state.research };
  }

  const researchField = findJsonPath(save.jsonText, ['soul', 'partresearch', 'user']);
  let rawResearch;
  try {
    rawResearch = JSON.parse(save.jsonText.slice(researchField.valueStart, researchField.valueEnd));
  } catch {
    fail(tr(63));
  }
  if (JSON.stringify(rawResearch) !== JSON.stringify(state.research)) {
    fail(tr(64));
  }

  const changedResearch = [...state.research, ...state.missingIds.map((id) => ({
    ptid: id,
    lvl: 1,
    research_type: 'MAP',
    receive_type: 'UNKNOWN',
    is_announced: 0,
    is_checked: 1,
    before_ptid: '',
    before_lvl: 0,
  }))];
  const changedText = save.jsonText.slice(0, researchField.valueStart) +
    JSON.stringify(changedResearch) + save.jsonText.slice(researchField.valueEnd);

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(65, label, error.message));
  }
  const verifiedState = getRecipeUnlockState({ data: changedData }, definitionIds, label);
  if (verifiedState.missingIds.length !== 0 ||
      verifiedState.research.length !== state.research.length + state.missingIds.length ||
      JSON.stringify(verifiedState.research.slice(0, state.research.length)) !==
        JSON.stringify(state.research)) {
    fail(tr(66, label));
  }
  for (let index = 0; index < state.missingIds.length; index += 1) {
    const entry = verifiedState.research[state.research.length + index];
    if (entry.ptid !== state.missingIds[index] || entry.lvl !== 1 ||
        entry.research_type !== 'MAP' || entry.receive_type !== 'UNKNOWN' ||
        entry.is_announced !== 0 || entry.is_checked !== 1 ||
        entry.before_ptid !== '' || entry.before_lvl !== 0) {
      fail(tr(67, label, state.missingIds[index]));
    }
  }

  return {
    changedText,
    state,
    addedIds: state.missingIds,
    changedResearch,
    verifiedState,
  };
}

function replaceLimitedRecipes(save, definitions) {
  if (!Array.isArray(definitions) ||
      definitions.length !== LIMITED_RECIPE_DEFINITION_COUNT ||
      JSON.stringify(definitions.map((entry) => entry.id)) !== JSON.stringify(LIMITED_RECIPE_IDS)) {
    fail(tr(68));
  }
  return replaceRecipeUnlocks(save, definitions, tr(60));
}

function replaceAllRecipes(save, definitions) {
  if (!Array.isArray(definitions) || definitions.length !== ALL_RECIPE_DEFINITION_COUNT) {
    fail(tr(69));
  }
  return replaceRecipeUnlocks(save, definitions, tr(70));
}

function replaceGoldenBeasts(save, definitions, countPerBeast = 1) {
  const count = Number(countPerBeast);
  if (!Number.isInteger(count) || count < 1) {
    fail(tr(71));
  }
  if (GOLDEN_BEAST_IDS.length !== 11 || new Set(GOLDEN_BEAST_IDS).size !== 11) {
    fail(tr(72));
  }
  if (!Array.isArray(definitions) || definitions.length !== GOLDEN_BEAST_IDS.length) {
    fail(tr(73));
  }

  const definitionById = new Map(definitions.map((entry) => [entry.id, entry]));
  for (const id of GOLDEN_BEAST_IDS) {
    const definition = definitionById.get(id);
    if (!definition || typeof definition.rwdmsrid !== 'string' || !definition.rwdmsrid) {
      fail(tr(74, id));
    }
  }

  const beasts = getBeastStock(save);
  const mushrooms = getMushroomStock(save);
  const slots = getCoinLockerSlots(save);
  const emptySlots = slots.filter((entry) => entry.type === -1 && entry.eid === '');
  const totalRequired = GOLDEN_BEAST_IDS.length * count;
  if (emptySlots.length < totalRequired) {
    fail(tr(75, emptySlots.length, count, totalRequired, totalRequired));
  }

  const usedEntityIds = new Set([
    ...beasts.map((entry) => entry.eid),
    ...mushrooms.map((entry) => entry.eid),
  ]);
  function newEntityId() {
    let id;
    do id = crypto.randomUUID(); while (usedEntityIds.has(id));
    usedEntityIds.add(id);
    return id;
  }

  const now = Math.floor(Date.now() / 1000);
  const grants = [];
  let slotIdx = 0;
  for (let r = 0; r < count; r += 1) {
    for (const beastId of GOLDEN_BEAST_IDS) {
      const beastEntityId = newEntityId();
      const rewardEntityId = newEntityId();
      const rewardMushroomId = definitionById.get(beastId).rwdmsrid;
      grants.push({
        slot: emptySlots[slotIdx].slot,
        beastId,
        beastEntityId,
        rewardEntityId,
        rewardMushroomId,
      });
      slotIdx += 1;
    }
  }

  const changedBeasts = [...beasts, ...grants.map((grant) => ({
    eid: grant.beastEntityId,
    gettime: now,
    owner: 'COIN_LOCKER',
    bstid: grant.beastId,
    rwdemsrid: grant.rewardEntityId,
    state: 0,
    lvl: 1,
    posonce: 0,
  }))];
  const changedMushrooms = [...mushrooms, ...grants.map((grant) => ({
    eid: grant.rewardEntityId,
    gettime: now,
    owner: 'BEAST',
    msrid: grant.rewardMushroomId,
    eefcid: '',
    tefcid: '',
    posonce: 0,
    state: 0,
  }))];
  const slotAssignments = new Map(grants.map((grant) => [grant.slot, grant.beastEntityId]));
  const changedSlots = slots.map((entry) => slotAssignments.has(entry.slot)
    ? { ...entry, type: COIN_LOCKER_BEAST_TYPE, eid: slotAssignments.get(entry.slot) }
    : { ...entry });

  let changedText = save.jsonText;
  for (const [jsonPath, value] of [
    [['beast', 'bsts'], changedBeasts],
    [['mushroom', 'msrs'], changedMushrooms],
    [['soul', 'cl'], changedSlots],
  ]) {
    const field = findJsonPath(changedText, jsonPath);
    changedText = changedText.slice(0, field.valueStart) +
      JSON.stringify(value) + changedText.slice(field.valueEnd);
  }

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(30, error.message));
  }
  const changedSave = { data: changedData };
  const verifiedBeasts = new Map(getBeastStock(changedSave).map((entry) => [entry.eid, entry]));
  const verifiedMushrooms = new Map(getMushroomStock(changedSave).map((entry) => [entry.eid, entry]));
  const verifiedSlots = new Map(getCoinLockerSlots(changedSave).map((entry) => [entry.slot, entry]));
  for (const grant of grants) {
    const beast = verifiedBeasts.get(grant.beastEntityId);
    const mushroom = verifiedMushrooms.get(grant.rewardEntityId);
    const slot = verifiedSlots.get(grant.slot);
    if (!beast || beast.owner !== 'COIN_LOCKER' || beast.bstid !== grant.beastId ||
        beast.rwdemsrid !== grant.rewardEntityId || !mushroom || mushroom.owner !== 'BEAST' ||
        mushroom.msrid !== grant.rewardMushroomId || !slot ||
        slot.type !== COIN_LOCKER_BEAST_TYPE || slot.eid !== grant.beastEntityId) {
      fail(tr(76, grant.beastId));
    }
  }

  return {
    changedText,
    grants,
    countPerBeast: count,
    previousBeastCount: beasts.length,
    currentBeastCount: changedBeasts.length,
    previousEmptySlots: emptySlots.length,
    currentEmptySlots: emptySlots.length - grants.length,
  };
}

function getKamasResearchState(save, maximumInternalLevel, limitBreakStart) {
  const research = save.data?.soul?.partresearch?.user;
  if (!Array.isArray(research)) {
    fail(tr(56));
  }
  const entries = research.filter((entry) => entry?.ptid === KAMAS_RE_FINAL_PART_ID);
  if (entries.length === 0) {
    fail(tr(77));
  }

  const byLevel = new Map();
  for (const entry of entries) {
    if (!Number.isInteger(entry.lvl) || entry.lvl < 1 || entry.lvl > maximumInternalLevel ||
        typeof entry.research_type !== 'string' || typeof entry.receive_type !== 'string' ||
        ![0, 1].includes(entry.is_announced) || ![0, 1].includes(entry.is_checked) ||
        typeof entry.before_ptid !== 'string' || !Number.isInteger(entry.before_lvl)) {
      fail(tr(78));
    }
    if (byLevel.has(entry.lvl)) {
      fail(tr(79, entry.lvl));
    }
    byLevel.set(entry.lvl, entry);
  }

  const currentInternalLevel = Math.max(...byLevel.keys());
  for (let level = 1; level <= currentInternalLevel; level += 1) {
    if (!byLevel.has(level)) fail(tr(80, level));
  }
  const completedInternalLevel = Math.max(
    0,
    ...entries.filter((entry) => entry.research_type === 'FINISHED').map((entry) => entry.lvl),
  );
  const displayOffset = limitBreakStart - 1;
  const isMaxed = entries.length === maximumInternalLevel &&
    completedInternalLevel === maximumInternalLevel &&
    entries.every((entry) =>
      entry.research_type === 'FINISHED' &&
      entry.receive_type === (entry.lvl === maximumInternalLevel ? 'CHARGE' : 'FINISHED'));

  return {
    research,
    entries,
    currentInternalLevel,
    currentDisplayLevel: currentInternalLevel + displayOffset,
    completedInternalLevel,
    completedDisplayLevel: completedInternalLevel + displayOffset,
    maximumInternalLevel,
    maximumDisplayLevel: maximumInternalLevel + displayOffset,
    isMaxed,
  };
}

function replaceKamasResearchMaximum(save, maximumInternalLevel, limitBreakStart) {
  const state = getKamasResearchState(save, maximumInternalLevel, limitBreakStart);
  if (state.isMaxed) return { changedText: save.jsonText, state, addedLevels: 0 };

  const researchField = findJsonPath(save.jsonText, ['soul', 'partresearch', 'user']);
  const rawResearch = JSON.parse(save.jsonText.slice(researchField.valueStart, researchField.valueEnd));
  if (JSON.stringify(rawResearch) !== JSON.stringify(state.research)) {
    fail(tr(81));
  }

  const changedResearch = state.research.map((entry) => ({ ...entry }));
  for (const entry of changedResearch) {
    if (entry.ptid !== KAMAS_RE_FINAL_PART_ID) continue;
    entry.research_type = 'FINISHED';
    entry.receive_type = entry.lvl === maximumInternalLevel ? 'CHARGE' : 'FINISHED';
    entry.is_announced = 1;
    entry.is_checked = 1;
  }

  let addedLevels = 0;
  for (let level = state.currentInternalLevel + 1; level <= maximumInternalLevel; level += 1) {
    changedResearch.push({
      ptid: KAMAS_RE_FINAL_PART_ID,
      lvl: level,
      research_type: 'FINISHED',
      receive_type: level === maximumInternalLevel ? 'CHARGE' : 'FINISHED',
      is_announced: 1,
      is_checked: 1,
      before_ptid: KAMAS_RE_FINAL_PART_ID,
      before_lvl: level - 1,
    });
    addedLevels += 1;
  }

  const changedText = save.jsonText.slice(0, researchField.valueStart) +
    JSON.stringify(changedResearch) + save.jsonText.slice(researchField.valueEnd);
  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(82, error.message));
  }
  const verified = getKamasResearchState(
    { data: changedData },
    maximumInternalLevel,
    limitBreakStart,
  );
  if (!verified.isMaxed) fail(tr(83));

  return { changedText, state, verified, addedLevels };
}

function getFacilityState(save) {
  const soul = save.data?.soul;
  if (!soul || typeof soul !== 'object') {
    fail(tr(84));
  }
  const safeLevel = soul.safe_level;
  const tankLevel = soul.spirit_tank_level;
  if (!Number.isInteger(safeLevel) || safeLevel < 1 ||
      !Number.isInteger(tankLevel) || tankLevel < 1) {
    fail(tr(85));
  }
  const isMaxed = safeLevel >= 99 && tankLevel >= 99;
  return { safeLevel, tankLevel, isMaxed };
}

function replaceFacilityUpgradesMaximum(save) {
  const state = getFacilityState(save);
  if (state.isMaxed) {
    return { changedText: save.jsonText, state, changed: false };
  }

  const soul = findObjectProperty(save.jsonText, 0, 'soul');
  const safeField = findObjectProperty(save.jsonText, soul.valueStart, 'safe_level');
  let changedText = save.jsonText.slice(0, safeField.valueStart) + '99' + save.jsonText.slice(safeField.valueEnd);

  // Recalculate offsets after modifying safe_level
  const updatedSoul = findObjectProperty(changedText, 0, 'soul');
  const tankField = findObjectProperty(changedText, updatedSoul.valueStart, 'spirit_tank_level');
  changedText = changedText.slice(0, tankField.valueStart) + '99' + changedText.slice(tankField.valueEnd);

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(86, error.message));
  }
  if (changedData.soul.safe_level !== 99 || changedData.soul.spirit_tank_level !== 99) {
    fail(tr(87));
  }

  return { changedText, state, changed: true };
}

function writeFacilityUpgradesMaximum(savePath, save) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const mutation = replaceFacilityUpgradesMaximum(save);
  if (!mutation.changed) {
    return {
      changed: false,
      previousSafeLevel: mutation.state.safeLevel,
      previousTankLevel: mutation.state.tankLevel,
      currentSafeLevel: 99,
      currentTankLevel: 99,
      backupPath: undefined,
    };
  }

  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.facility-edit.tmp`;
  const rollbackPath = `${savePath}.facility-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(90));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getFacilityState(check);
    if (!checkState.isMaxed) {
      fail(tr(91));
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    changed: true,
    backupPath,
    previousSafeLevel: mutation.state.safeLevel,
    previousTankLevel: mutation.state.tankLevel,
    currentSafeLevel: 99,
    currentTankLevel: 99,
    packedHash: sha256(packed),
  };
}

function getWeaponMasteryDefinitions(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(
      `SELECT ptarmtp, MAX(lvl) AS max_lvl, abp
       FROM master_expert_lvl_reward
       GROUP BY ptarmtp
       HAVING lvl = MAX(lvl)
       ORDER BY ptarmtp`,
    ).all();
    if (rows.length === 0) {
      fail(tr(94));
    }
    const maxMap = new Map();
    for (const row of rows) {
      maxMap.set(row.ptarmtp, { maxLevel: row.max_lvl, maxAbp: row.abp });
    }
    return { databasePath, maxMap };
  } finally {
    if (database) database.close();
  }
}

function getWeaponMasteryState(save) {
  const expert = save.data?.soul?.expert;
  if (!Array.isArray(expert)) {
    fail(tr(95));
  }
  for (const entry of expert) {
    if (!entry || typeof entry !== 'object' || typeof entry.ptarmtp !== 'string' ||
        !Number.isInteger(entry.lvl) || !Number.isInteger(entry.abp)) {
      fail(tr(96));
    }
  }
  const maxLevelCount = expert.filter((entry) => entry.lvl >= 20).length;
  const isMaxed = maxLevelCount === expert.length;
  return { expert, totalCount: expert.length, maxLevelCount, isMaxed };
}

function replaceWeaponMasteriesMaximum(save, savePath) {
  const state = getWeaponMasteryState(save);
  const { maxMap } = getWeaponMasteryDefinitions(savePath);

  const changedExpert = state.expert.map((entry) => {
    const def = maxMap.get(entry.ptarmtp);
    const targetLevel = def ? def.maxLevel : 20;
    const targetAbp = def ? def.maxAbp : 47000;
    return {
      ...entry,
      lvl: Math.max(entry.lvl, targetLevel),
      abp: Math.max(entry.abp, targetAbp),
      is_checked: 1,
    };
  });

  const expertField = findJsonPath(save.jsonText, ['soul', 'expert']);
  const changedText = save.jsonText.slice(0, expertField.valueStart) +
    JSON.stringify(changedExpert) + save.jsonText.slice(expertField.valueEnd);

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(97, error.message));
  }
  const verified = getWeaponMasteryState({ data: changedData });
  if (!verified.isMaxed) {
    fail(tr(98));
  }

  const upgradedCount = state.expert.filter((entry, i) => entry.lvl < changedExpert[i].lvl).length;
  return { changedText, state, verified, upgradedCount };
}

function writeWeaponMasteriesMaximum(savePath, save) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const mutation = replaceWeaponMasteriesMaximum(save, savePath);
  if (mutation.upgradedCount === 0) {
    return {
      changed: false,
      totalCount: mutation.state.totalCount,
      upgradedCount: 0,
      backupPath: undefined,
    };
  }

  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.mastery-edit.tmp`;
  const rollbackPath = `${savePath}.mastery-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(99));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getWeaponMasteryState(check);
    if (!checkState.isMaxed) {
      fail(tr(100));
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    changed: true,
    backupPath,
    totalCount: mutation.state.totalCount,
    upgradedCount: mutation.upgradedCount,
    packedHash: sha256(packed),
  };
}

function getAllEquipmentResearchDefinitions(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });

    const roots = database.prepare(`
      SELECT part.id, part.name, part.type, part.sort_no
      FROM master_part AS part
      INNER JOIN master_part_research AS research ON research.ptid = part.id
      LEFT JOIN master_part AS parent ON parent.platform = part.platform AND parent.nextptid = part.id
      WHERE part.platform = 0 AND research.is_open = 1 AND parent.id IS NULL
      ORDER BY part.sort_no, part.id
    `).all();

    const partRows = database.prepare(
      'SELECT id, name, nextptid, reflvllmt, is_limitbreak FROM master_part WHERE platform = 0',
    ).all();
    const partMap = new Map(partRows.map((r) => [r.id, r]));

    const chains = [];
    const allReachableParts = new Map();

    for (const root of roots) {
      const chain = [];
      let curr = root.id;
      while (curr && partMap.has(curr)) {
        const part = partMap.get(curr);
        chain.push(part);
        allReachableParts.set(part.id, part);
        curr = part.nextptid;
      }
      chains.push({ root, chain });
    }

    return {
      databasePath,
      roots,
      chains,
      allReachableParts,
      totalPartCount: allReachableParts.size,
    };
  } finally {
    if (database) database.close();
  }
}

function getEquipmentResearchState(save, savePath) {
  const user = save.data?.soul?.partresearch?.user;
  if (!Array.isArray(user)) {
    fail(tr(101));
  }

  const { allReachableParts } = getAllEquipmentResearchDefinitions(savePath);
  const existingMap = new Map();
  for (const entry of user) {
    if (entry && typeof entry === 'object' && typeof entry.ptid === 'string' && Number.isInteger(entry.lvl)) {
      existingMap.set(`${entry.ptid}:${entry.lvl}`, entry);
    }
  }

  let totalRequiredLevels = 0;
  let maxedLevels = 0;

  for (const part of allReachableParts.values()) {
    const maxLevel = part.reflvllmt;
    totalRequiredLevels += maxLevel;
    for (let lvl = 1; lvl <= maxLevel; lvl += 1) {
      const entry = existingMap.get(`${part.id}:${lvl}`);
      if (entry && entry.research_type === 'FINISHED') {
        const expectedReceive = (lvl === maxLevel ? 'CHARGE' : 'FINISHED');
        if (entry.receive_type === expectedReceive) {
          maxedLevels += 1;
        }
      }
    }
  }

  const isMaxed = maxedLevels === totalRequiredLevels;
  return {
    user,
    existingCount: user.length,
    totalPartCount: allReachableParts.size,
    totalRequiredLevels,
    maxedLevels,
    isMaxed,
  };
}

function replaceEquipmentResearchMaximum(save, savePath) {
  const definitions = getAllEquipmentResearchDefinitions(savePath);
  const state = getEquipmentResearchState(save, savePath);

  const existingMap = new Map();
  for (const entry of state.user) {
    existingMap.set(`${entry.ptid}:${entry.lvl}`, entry);
  }

  const generatedResearch = [];

  for (const { chain } of definitions.chains) {
    for (let cIdx = 0; cIdx < chain.length; cIdx += 1) {
      const part = chain[cIdx];
      const prevPart = cIdx > 0 ? chain[cIdx - 1] : null;
      for (let lvl = 1; lvl <= part.reflvllmt; lvl += 1) {
        const isMaxLvl = lvl === part.reflvllmt;
        const key = `${part.id}:${lvl}`;
        const existing = existingMap.get(key);

        const defaultBeforePtid = lvl === 1 ? (prevPart ? prevPart.id : '') : part.id;
        const defaultBeforeLvl = lvl === 1 ? (prevPart ? prevPart.reflvllmt : 0) : lvl - 1;

        generatedResearch.push({
          ptid: part.id,
          lvl,
          research_type: 'FINISHED',
          receive_type: isMaxLvl ? 'CHARGE' : 'FINISHED',
          is_announced: 1,
          is_checked: 1,
          before_ptid: existing?.before_ptid !== undefined ? existing.before_ptid : defaultBeforePtid,
          before_lvl: existing?.before_lvl !== undefined ? existing.before_lvl : defaultBeforeLvl,
        });
      }
    }
  }

  const chainKeys = new Set(generatedResearch.map((r) => `${r.ptid}:${r.lvl}`));
  for (const entry of state.user) {
    if (!chainKeys.has(`${entry.ptid}:${entry.lvl}`)) {
      generatedResearch.push({
        ...entry,
        research_type: 'FINISHED',
        receive_type: 'FINISHED',
        is_announced: 1,
        is_checked: 1,
      });
    }
  }

  const researchField = findJsonPath(save.jsonText, ['soul', 'partresearch', 'user']);
  const changedText = save.jsonText.slice(0, researchField.valueStart) +
    JSON.stringify(generatedResearch) + save.jsonText.slice(researchField.valueEnd);

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(102, error.message));
  }

  const verifiedState = getEquipmentResearchState({ data: changedData, jsonText: changedText }, savePath);
  if (!verifiedState.isMaxed) {
    fail(tr(103));
  }

  const addedCount = generatedResearch.length - state.existingCount;
  return {
    changedText,
    state,
    verifiedState,
    totalPartCount: definitions.totalPartCount,
    totalEntries: generatedResearch.length,
    addedCount,
  };
}

function writeEquipmentResearchMaximum(savePath, save) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const mutation = replaceEquipmentResearchMaximum(save, savePath);

  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.equipment-max-edit.tmp`;
  const rollbackPath = `${savePath}.equipment-max-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(104));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getEquipmentResearchState(check, savePath);
    if (!checkState.isMaxed) {
      fail(tr(105));
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    changed: true,
    backupPath,
    totalPartCount: mutation.totalPartCount,
    totalEntries: mutation.totalEntries,
    previousCount: mutation.state.existingCount,
    addedCount: mutation.addedCount,
    packedHash: sha256(packed),
  };
}

const FIGHTER_TYPES = {
  BAL: tr(106),
  BRE: tr(107),
  DEF: tr(108),
  TEC: tr(109),
  SHT: tr(110),
  COL: tr(111),
  SKI: tr(112),
  LUK: tr(113),
};

const FIGHTER_STAT_KEYS = ['hp', 'str', 'dex', 'vit', 'stm', 'luk'];
const FIGHTER_EXTRA_KEYS = ['skill', 'bag', 'rage'];
const FIGHTER_BONUS_KEYS = ['hp_bonus', 'str_bonus', 'dex_bonus', 'vit_bonus', 'stm_bonus', 'luk_bonus'];
const FIGHTER_PARAM_LEGIT_MAX = 45;

function calculateFighterTotalLevel(stats) {
  const hp = Number.isInteger(stats.hp) ? stats.hp : 1;
  const str = Number.isInteger(stats.str) ? stats.str : 1;
  const dex = Number.isInteger(stats.dex) ? stats.dex : 1;
  const vit = Number.isInteger(stats.vit) ? stats.vit : 1;
  const stm = Number.isInteger(stats.stm) ? stats.stm : 1;
  const luk = Number.isInteger(stats.luk) ? stats.luk : 1;
  const skill = Number.isInteger(stats.skill) ? stats.skill : 0;
  const bag = Number.isInteger(stats.bag) ? stats.bag : 0;
  const rage = Number.isInteger(stats.rage) ? stats.rage : 0;
  return (hp + str + dex + vit + stm + luk - 5) + skill + bag + rage;
}

function getBaseSkillSlots(grade, type) {
  const g = Number.isInteger(grade) ? grade : 1;
  const t = typeof type === 'string' ? type.toUpperCase() : '';
  if (t === 'SKI') {
    if (g === 1) return 2;
    if (g === 2) return 3;
    if (g === 3) return 4;
    if (g === 4) return 6;
    return 9; // Grade 5, 6
  }
  if (t === 'OLD') return 8;
  if (g === 1) return 1;
  if (g === 2) return 2;
  if (g === 3) return 3;
  if (g === 4) return 4;
  return 5; // Grade 5, 6
}

function getMaxAddableSkillSlots(grade, type) {
  const base = getBaseSkillSlots(grade, type);
  // 언캡 순정 한도는 최대 +4이며, 인게임 3x3 UI 최대치는 9칸
  return Math.max(0, Math.min(4, 9 - base));
}

function getTotalSkillSlots(grade, type, skill) {
  const base = getBaseSkillSlots(grade, type);
  const s = Number.isInteger(skill) ? skill : 0;
  return Math.min(9, base + s);
}

function getFighterOverLimitWarnings(updates, savePath, fighter = null) {
  if (!fighter || !savePath) return [];
  require('./fighter-db-limits').validateFighterStatUpdates(getMasterDatabasePath(savePath), fighter, updates);
  return [];
}

async function promptFighterWarningIfNeeded(rl, updates, savePath, forceYes = false, targetFighter = null) {
  const notices = getFighterOverLimitWarnings(updates, savePath, targetFighter);
  if (notices.length === 0) return true;

  console.log('\n' + '='.repeat(78));
  console.log(tr(114));
  console.log('-'.repeat(78));
  console.log(tr(115));
  notices.forEach((w, idx) => console.log(`  ${idx + 1}. ${w}`));
  console.log('='.repeat(78));

  if (forceYes) {
    console.log(tr(116));
    return true;
  }
  if (!rl) return false;
  const proceed = await confirm(rl, tr(117));
  return proceed;
}

function getConsoleVisualWidth(str) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x1100 && (
      (code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    )) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padEndVisual(str, targetWidth) {
  const currentWidth = getConsoleVisualWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
}

function printFighterChangeSummary(result, modeDesc) {
  const p = result.previousStats;
  const u = result.updatedStats;
  const f = result.targetFighter;
  const baseSlots = getBaseSkillSlots(f.grade, f.type);

  const statItems = [
    { label: tr(118), key: 'hp' },
    { label: tr(119), key: 'str' },
    { label: tr(120), key: 'dex' },
    { label: tr(121), key: 'vit' },
    { label: tr(122), key: 'stm' },
    { label: tr(123), key: 'luk' },
    { label: tr(124), key: 'skill', fmt: (v) => tr(125, v, Math.min(9, baseSlots + v), baseSlots) },
    { label: tr(126), key: 'bag', fmt: (v) => tr(127, v) },
    { label: tr(128), key: 'rage', fmt: (v) => `${v}/5` },
    { label: tr(129), key: 'hp_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: tr(130), key: 'str_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: tr(131), key: 'dex_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: tr(132), key: 'vit_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: tr(133), key: 'stm_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: tr(134), key: 'luk_bonus', fmt: (v) => `+${v ?? 0}` },
  ];

  const changedItems = [];
  for (const item of statItems) {
    const bVal = p[item.key];
    const aVal = u[item.key];
    if (bVal !== aVal) {
      const bStr = item.fmt ? item.fmt(bVal) : String(bVal);
      const aStr = item.fmt ? item.fmt(aVal) : String(aVal);
      const diff = typeof aVal === 'number' && typeof bVal === 'number'
        ? `(${aVal >= bVal ? '+' : ''}${aVal - bVal})`
        : '';
      changedItems.push({ label: item.label, bStr, aStr, diff });
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log(tr(135, f.name, f.typeName));
  console.log('-'.repeat(78));
  console.log(tr(136, modeDesc));
  console.log(tr(137, p.lvl, u.lvl, u.lvl >= p.lvl ? '+' : '', u.lvl - p.lvl));

  if (changedItems.length > 0) {
    console.log(tr(138, changedItems.length));
    changedItems.forEach((ci) => {
      console.log(`    ▶ ${ci.label}: ${ci.bStr} → ${ci.aStr} ${ci.diff}`);
    });
  } else {
    console.log(tr(139));
  }

  console.log('------------------------------------------------------------------------------');
  console.log(tr(140, padEndVisual(tr(141), 20), padEndVisual(tr(142), 16), padEndVisual(tr(143), 16)));
  console.log('------------------------------------------------------------------------------');

  for (const item of statItems) {
    const bVal = p[item.key];
    const aVal = u[item.key];
    const bStr = item.fmt ? item.fmt(bVal) : String(bVal);
    const aStr = item.fmt ? item.fmt(aVal) : String(aVal);
    const isChanged = bVal !== aVal;
    const diff = typeof aVal === 'number' && typeof bVal === 'number'
      ? `(${aVal >= bVal ? '+' : ''}${aVal - bVal})`
      : '';
    const statusText = isChanged ? tr(144, diff) : tr(145);
    console.log(`  ${padEndVisual(item.label, 18)} : ${padEndVisual(bStr, 14)} →  ${padEndVisual(aStr, 14)} [${statusText}]`);
  }
  console.log('------------------------------------------------------------------------------');
  const finalTotalSlots = Math.min(9, baseSlots + (u.skill ?? 0));
  if (finalTotalSlots < 9) {
    console.log(tr(146, f.grade, f.typeName, baseSlots, u.skill ?? 0, finalTotalSlots));
    console.log(tr(147, 9 - finalTotalSlots));
    console.log('------------------------------------------------------------------------------');
  }
  console.log(tr(148, result.backupPath));
  console.log('==============================================================================\n');
}

function getFighterList(save) {
  const uid = String(save.data?.soul?.uid ?? Object.keys(save.data?.bodyuser || {})[0]);
  let chrs = save.data?.soul?.chr?.chrs;
  if (chrs && !Array.isArray(chrs) && typeof chrs === 'object') {
    chrs = chrs[uid] || Object.values(chrs)[0];
  }
  if (!Array.isArray(chrs) || chrs.length === 0) {
    fail(tr(149));
  }

  let bodyusers = save.data?.bodyuser;
  if (bodyusers && !Array.isArray(bodyusers) && typeof bodyusers === 'object') {
    bodyusers = bodyusers[uid] || Object.values(bodyusers)[0];
  }
  if (!Array.isArray(bodyusers) || bodyusers.length === 0) {
    fail(tr(150, uid));
  }

  const bodyMap = new Map();
  bodyusers.forEach((item, index) => {
    if (item && typeof item === 'object' && item.cid) {
      bodyMap.set(item.cid, { data: item, bodyIndex: index });
    }
  });

  return chrs.map((chr, chrIndex) => {
    const entry = bodyMap.get(chr.cid);
    if (!entry) {
      fail(tr(151, chr.name || chr.cid));
    }
    return {
      chrIndex,
      bodyIndex: entry.bodyIndex,
      uid,
      cid: chr.cid,
      name: chr.name || tr(152, chrIndex + 1),
      type: chr.type || 'UNKNOWN',
      typeName: FIGHTER_TYPES[chr.type] || chr.type || tr(153),
      grade: chr.grade ?? 1,
      limitBreak: chr.limit_break ?? 0,
      state: chr.state === 'USE' ? tr(154) : (chr.state === 'GUARD' ? tr(155) : (chr.state || tr(156))),
      rawState: chr.state,
      stats: { ...entry.data },
    };
  });
}

function replaceFighterStats(save, fighterIndex, statUpdates) {
  const fighters = getFighterList(save);
  if (!Number.isInteger(fighterIndex) || fighterIndex < 0 || fighterIndex >= fighters.length) {
    fail(tr(157, fighterIndex + 1, fighters.length));
  }
  const target = fighters[fighterIndex];
  const uid = target.uid;
  const currentBodyArray = save.data.bodyuser[uid];

  const updatedBodyArray = currentBodyArray.map((item, idx) => {
    if (idx !== target.bodyIndex) return { ...item };
    const updated = { ...item };
    for (const [key, value] of Object.entries(statUpdates)) {
      if (value !== undefined && value !== null) {
        updated[key] = value;
      }
    }
    updated.lvl = calculateFighterTotalLevel(updated);
    return updated;
  });

  const bodyField = findJsonPath(save.jsonText, ['bodyuser', uid]);
  const changedText = save.jsonText.slice(0, bodyField.valueStart) +
    JSON.stringify(updatedBodyArray) + save.jsonText.slice(bodyField.valueEnd);

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(tr(158, error.message));
  }

  const updatedTarget = changedData.bodyuser[uid][target.bodyIndex];
  for (const [key, value] of Object.entries(statUpdates)) {
    if (value !== undefined && value !== null && updatedTarget[key] !== value) {
      fail(tr(159, key));
    }
  }
  if (updatedTarget.lvl !== calculateFighterTotalLevel(updatedTarget)) {
    fail(tr(160));
  }

  return {
    changedText,
    targetFighter: target,
    previousStats: target.stats,
    updatedStats: updatedTarget,
  };
}

function writeFighterStats(savePath, save, fighterIndex, statUpdates) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const target = getFighterList(save)[fighterIndex];
  if (!target) fail(tr(161));
  require('./fighter-db-limits').validateFighterStatUpdates(getMasterDatabasePath(savePath), target, statUpdates);
  const mutation = replaceFighterStats(save, fighterIndex, statUpdates);
  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.fighter-edit.tmp`;
  const rollbackPath = `${savePath}.fighter-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(162));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkFighters = getFighterList(check);
    const checkTarget = checkFighters[fighterIndex];
    for (const [key, value] of Object.entries(statUpdates)) {
      if (value !== undefined && value !== null && checkTarget.stats[key] !== value) {
        fail(tr(163, key));
      }
    }
    if (checkTarget.stats.lvl !== mutation.updatedStats.lvl) {
      fail(tr(164));
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    backupPath,
    targetFighter: mutation.targetFighter,
    previousStats: mutation.previousStats,
    updatedStats: mutation.updatedStats,
    packedHash: sha256(packed),
  };
}

function packSave(jsonText, blockCount, trailer) {
  const jsonBuffer = Buffer.from(jsonText, 'utf8');
  const header = Buffer.alloc(16);
  FORMAT_MAGIC.copy(header, 0);
  header.writeUInt32LE(FORMAT_VERSION, 4);
  header.writeUInt32LE(jsonBuffer.length, 8);
  FORMAT_CODEC.copy(header, 12);

  const output = [header];
  const baseSize = Math.floor(jsonBuffer.length / blockCount);
  const remainder = jsonBuffer.length % blockCount;
  let offset = 0;

  for (let index = 0; index < blockCount; index += 1) {
    const partSize = baseSize + (index === blockCount - 1 ? remainder : 0);
    const part = jsonBuffer.subarray(offset, offset + partSize);
    const compressed = zlib.deflateSync(part, { level: 6 });
    const blockHeader = Buffer.alloc(8);
    blockHeader.writeUInt32LE(part.length, 0);
    blockHeader.writeUInt32LE(compressed.length, 4);
    output.push(blockHeader, compressed);
    offset += part.length;
  }
  output.push(trailer);
  return Buffer.concat(output);
}

function readWindowsRegistryValue(key, valueName) {
  if (process.platform !== 'win32') return null;
  try {
    const output = childProcess.execFileSync(
      'reg.exe',
      ['query', key, '/v', valueName],
      {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const line = output.split(/\r?\n/).find((entry) =>
      new RegExp(`^\\s*${valueName}\\s+REG_\\w+\\s+`, 'i').test(entry));
    return line?.replace(new RegExp(`^\\s*${valueName}\\s+REG_\\w+\\s+`, 'i'), '').trim() || null;
  } catch {
    return null;
  }
}

function uniquePaths(paths) {
  const unique = new Map();
  for (const candidate of paths) {
    const normalized = path.normalize(candidate);
    const identity = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (!unique.has(identity)) unique.set(identity, normalized);
  }
  return [...unique.values()];
}

function findSteamRoots() {
  const roots = [];
  const registrySteamExecutable = readWindowsRegistryValue(
    'HKCU\\Software\\Valve\\Steam',
    'SteamExe',
  );
  const candidates = [
    readWindowsRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    registrySteamExecutable ? path.dirname(registrySteamExecutable) : null,
    readWindowsRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    readWindowsRegistryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ].filter(Boolean);

  if (process.platform === 'win32') {
    for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (!fs.existsSync(drive)) continue;
      candidates.push(
        path.join(drive, 'Steam'),
        path.join(drive, 'SteamLibrary'),
        path.join(drive, 'Games', 'Steam'),
        path.join(drive, 'Program Files (x86)', 'Steam'),
        path.join(drive, 'Program Files', 'Steam'),
      );
    }
  }

  for (const steamRoot of candidates) {
    if (!fs.existsSync(steamRoot)) continue;
    roots.push(steamRoot);
    const libraryFile = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraryFile)) continue;
    const vdf = fs.readFileSync(libraryFile, 'utf8');
    for (const match of vdf.matchAll(/\"path\"\s+\"([^\"]+)\"/g)) {
      roots.push(match[1].replace(/\\\\/g, '\\'));
    }
  }
  return uniquePaths(roots);
}

function isSupportedSaveName(name) {
  return /^(?:\d+|brggame)\.sav$/i.test(name);
}

function listNumericSaveFiles(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const saves = entries.filter(entry => entry.isFile() && isSupportedSaveName(entry.name))
    .map(entry => path.join(directory, entry.name));
  // Only inspect Steam-ID child folders, never recursively scan unrelated data.
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const accountDirectory = path.join(directory, entry.name);
    for (const child of fs.readdirSync(accountDirectory, { withFileTypes: true })) {
      if (child.isFile() && /^brggame\.sav$/i.test(child.name)) saves.push(path.join(accountDirectory, child.name));
    }
  }
  return saves;
}

function stripPathInputQuotes(input) {
  let enteredPath = String(input ?? '').trim();
  if ((enteredPath.startsWith('"') && enteredPath.endsWith('"')) ||
      (enteredPath.startsWith("'") && enteredPath.endsWith("'"))) {
    enteredPath = enteredPath.slice(1, -1).trim();
  }
  return enteredPath;
}

function resolveManualSaveInput(input) {
  const enteredPath = stripPathInputQuotes(input);
  if (!enteredPath) return [];

  const resolved = path.resolve(enteredPath);
  if (!fs.existsSync(resolved)) return [];
  if (fs.statSync(resolved).isFile()) {
    return isSupportedSaveName(path.basename(resolved)) ? [resolved] : [];
  }

  const directories = [
    resolved,
    path.join(resolved, 'Savedata'),
    path.join(resolved, 'LET IT DIE', 'Savedata'),
    path.join(resolved, 'common', 'LET IT DIE', 'Savedata'),
    path.join(resolved, 'steamapps', 'common', 'LET IT DIE', 'Savedata'),
  ];
  return uniquePaths(directories.flatMap(listNumericSaveFiles));
}

function findGameInstallDirectories() {
  return uniquePaths(findSteamRoots()
    .map((root) => path.join(root, 'steamapps', 'common', 'LET IT DIE'))
    .filter((installDirectory) => fs.existsSync(
      path.join(installDirectory, 'Binaries', 'Win64', 'BrgGame-Steam.exe'),
    )));
}

function resolveMasterDatabaseInput(input) {
  const enteredPath = stripPathInputQuotes(input);
  if (!enteredPath) return [];
  const resolved = path.resolve(enteredPath);

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return [resolved];
  }

  const candidates = [
    path.join(resolved, 'masters.db'),
    path.join(resolved, 'Content', 'masters.db'),
    path.join(resolved, 'BrgGame', 'Content', 'masters.db'),
    path.join(resolved, 'LET IT DIE', 'BrgGame', 'Content', 'masters.db'),
    path.join(resolved, 'common', 'LET IT DIE', 'BrgGame', 'Content', 'masters.db'),
    path.join(resolved, 'steamapps', 'common', 'LET IT DIE', 'BrgGame', 'Content', 'masters.db'),
  ];
  return uniquePaths(candidates.filter((candidate) =>
    fs.existsSync(candidate) && fs.statSync(candidate).isFile()));
}

function setMasterDatabaseOverride(input) {
  const matches = resolveMasterDatabaseInput(input);
  if (matches.length === 0) {
    fail(tr(165));
  }
  masterDatabaseOverridePath = matches[0];
  return masterDatabaseOverridePath;
}

function discoverSaves() {
  const saves = [];
  for (const installDirectory of findGameInstallDirectories()) {
    const saveDirectory = path.join(installDirectory, 'Savedata');
    saves.push(...listNumericSaveFiles(saveDirectory));
  }
  return uniquePaths(saves);
}

function isGameRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const output = childProcess.execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /BrgGame-Steam\.exe/i.test(output);
  } catch {
    return false;
  }
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const padMilliseconds = (value) => String(value).padStart(3, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-` +
    padMilliseconds(date.getMilliseconds());
}

function backupDirectory() {
  return path.join(__dirname, 'backups');
}

function logDirectory() {
  return path.join(__dirname, 'logs');
}

function writeErrorLog(error, context = {}) {
  try {
    const directory = logDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const logFileName = `error-${timestamp()}.log`;
    const destination = path.join(directory, logFileName);

    const lines = [
      '================================================================================',
      tr(166),
      '================================================================================',
      tr(167, new Date().toISOString(), new Date().toLocaleString('ko-KR')),
      `Node.js: ${process.version}`,
      tr(168, process.platform, process.arch),
      tr(169, process.argv.join(' ')),
    ];

    if (context.mode) {
      lines.push(tr(170, context.mode));
    }
    if (context.command) {
      lines.push(tr(171, context.command));
    }
    if (context.choice !== undefined) {
      lines.push(tr(172, context.choice));
    }
    if (context.savePath) {
      lines.push(tr(173, context.savePath));
    }
    try {
      const dbPath = masterDatabaseOverridePath || (context.savePath ? findMasterDatabasePath(context.savePath) : null);
      if (dbPath) lines.push(tr(174, dbPath));
    } catch {
      // ignore
    }

    lines.push('--------------------------------------------------------------------------------');
    lines.push(tr(175, error?.message || String(error)));
    lines.push('--------------------------------------------------------------------------------');
    lines.push(tr(176));
    lines.push(error?.stack || tr(177));
    if (error?.cause) {
      lines.push('--------------------------------------------------------------------------------');
      lines.push(tr(178, error.cause?.stack || error.cause?.message || String(error.cause)));
    }
    lines.push('================================================================================\n');

    fs.writeFileSync(destination, lines.join('\n'), 'utf8');
    return destination;
  } catch (logError) {
    console.error(tr(179, logError.message));
    return null;
  }
}

function saveBackupKey(savePath) {
  const name = path.basename(savePath);
  const account = path.basename(path.dirname(savePath));
  return /^brggame\.sav$/i.test(name) && /^\d+$/.test(account) ? `${account}.${name}` : name;
}

function createBackup(savePath, packed) {
  const directory = backupDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const name = `${saveBackupKey(savePath)}.${timestamp()}.${sha256(packed).slice(0, 12)}.bak`;
  const destination = path.join(directory, name);
  fs.writeFileSync(destination, packed, { flag: 'wx' });
  return destination;
}

function findMasterDatabasePath(savePath) {
  if (masterDatabaseOverridePath) return masterDatabaseOverridePath;
  let adjacentInstallDirectory = typeof savePath === 'string' && savePath ? path.dirname(path.dirname(savePath)) : null;
  if (adjacentInstallDirectory && /^brggame\.sav$/i.test(path.basename(savePath)) &&
      /^\d+$/.test(path.basename(path.dirname(savePath))) && path.basename(adjacentInstallDirectory).toLowerCase() === 'savedata') {
    adjacentInstallDirectory = path.dirname(adjacentInstallDirectory);
  }
  const candidates = uniquePaths([
    ...(adjacentInstallDirectory ? [path.join(adjacentInstallDirectory, 'BrgGame', 'Content', 'masters.db')] : []),
    ...findGameInstallDirectories().map((installDirectory) =>
      path.join(installDirectory, 'BrgGame', 'Content', 'masters.db')),
  ]);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getMasterDatabasePath(savePath) {
  const databasePath = findMasterDatabasePath(savePath);
  if (databasePath) return databasePath;
  fail(tr(180));
}

function getAllDecalDefinitions(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(
      `SELECT id, no, no_steam, premium, rarity, is_display, is_display_list, platform
       FROM master_skill
       WHERE platform = 0
       ORDER BY no_steam`,
    ).all();
    if (rows.length !== STEAM_DECAL_DEFINITION_COUNT ||
        new Set(rows.map((row) => row.id)).size !== STEAM_DECAL_DEFINITION_COUNT) {
      fail(tr(181, STEAM_DECAL_DEFINITION_COUNT));
    }
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (typeof row.id !== 'string' || !row.id || row.no_steam !== index + 1 ||
          ![0, 1].includes(row.premium) || !Number.isSafeInteger(row.rarity) ||
          row.rarity < 1 || row.rarity > 5 || row.is_display !== 1 ||
          row.is_display_list !== 1 || row.platform !== 0) {
        fail(tr(182, index + 1));
      }
    }
    return { databasePath, rows, ids: rows.map((row) => row.id) };
  } finally {
    if (database) database.close();
  }
}

function getGoldenBeastDefinitions(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const placeholders = GOLDEN_BEAST_IDS.map(() => '?').join(',');
    const rows = database.prepare(
      `SELECT beast.id, beast.idx, beast.rwdmsrid, reward.id AS reward_definition_id
       FROM master_beast AS beast
       LEFT JOIN master_mushroom AS reward ON reward.id = beast.rwdmsrid
       WHERE beast.id IN (${placeholders})
       ORDER BY beast.idx`,
    ).all(...GOLDEN_BEAST_IDS);
    if (rows.length !== GOLDEN_BEAST_IDS.length) {
      fail(tr(183));
    }
    for (let index = 0; index < GOLDEN_BEAST_IDS.length; index += 1) {
      const row = rows[index];
      if (row.id !== GOLDEN_BEAST_IDS[index] || row.idx !== index + 12 ||
          typeof row.rwdmsrid !== 'string' || !row.rwdmsrid ||
          row.reward_definition_id !== row.rwdmsrid) {
        fail(tr(184, GOLDEN_BEAST_IDS[index]));
      }
    }
    return { databasePath, rows };
  } finally {
    if (database) database.close();
  }
}

function getLimitedRecipeDefinitions(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const placeholders = LIMITED_RECIPE_IDS.map(() => '?').join(',');
    const rows = database.prepare(
      `SELECT part.id, part.name, part.type, part.platform,
              research.is_initial, research.is_open, text.txt AS display_name
       FROM master_part AS part
       INNER JOIN master_part_research AS research ON research.ptid = part.id
       LEFT JOIN master_text AS text
         ON text.sct = substr(part.name, 1, instr(part.name, '.') - 1)
        AND text.id = substr(part.name, instr(part.name, '.') + 1)
        AND text.lang = 'int' AND text.snd = ''
       WHERE part.id IN (${placeholders})`,
    ).all(...LIMITED_RECIPE_IDS);
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (rows.length !== LIMITED_RECIPE_DEFINITION_COUNT ||
        byId.size !== LIMITED_RECIPE_DEFINITION_COUNT) {
      fail(tr(185, LIMITED_RECIPE_DEFINITION_COUNT));
    }
    const orderedRows = LIMITED_RECIPE_IDS.map((id) => byId.get(id));
    for (const row of orderedRows) {
      if (!row || typeof row.name !== 'string' || !row.name.includes('.') ||
          !['PTTP_ARM', 'PTTP_HEAD', 'PTTP_BODY', 'PTTP_LEGS'].includes(row.type) ||
          row.platform !== 0 || row.is_initial !== 0 || row.is_open !== 1 ||
          typeof row.display_name !== 'string' || !row.display_name) {
        fail(tr(186, row?.id ?? tr(187)));
      }
    }
    return { databasePath, rows: orderedRows, ids: [...LIMITED_RECIPE_IDS] };
  } finally {
    if (database) database.close();
  }
}

function getAllRecipeDefinitions(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(
      `SELECT part.id, part.name, part.type, part.platform, part.sort_no,
              research.is_initial, research.is_open, text.txt AS display_name
       FROM master_part AS part
       INNER JOIN master_part_research AS research ON research.ptid = part.id
       LEFT JOIN master_part AS parent
         ON parent.platform = part.platform AND parent.nextptid = part.id
       LEFT JOIN master_text AS text
         ON text.sct = substr(part.name, 1, instr(part.name, '.') - 1)
        AND text.id = substr(part.name, instr(part.name, '.') + 1)
        AND text.lang = 'int' AND text.snd = ''
       WHERE part.platform = 0 AND research.is_open = 1 AND parent.id IS NULL
       ORDER BY part.sort_no, part.id`,
    ).all();
    if (rows.length !== ALL_RECIPE_DEFINITION_COUNT ||
        new Set(rows.map((row) => row.id)).size !== ALL_RECIPE_DEFINITION_COUNT) {
      fail(tr(188, ALL_RECIPE_DEFINITION_COUNT));
    }
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id ||
          typeof row.name !== 'string' || !row.name.includes('.') ||
          !['PTTP_ARM', 'PTTP_HEAD', 'PTTP_BODY', 'PTTP_LEGS'].includes(row.type) ||
          row.platform !== 0 || ![0, 1].includes(row.is_initial) || row.is_open !== 1 ||
          !Number.isSafeInteger(row.sort_no) ||
          typeof row.display_name !== 'string' || !row.display_name) {
        fail(tr(189, row?.id ?? tr(187)));
      }
    }
    return { databasePath, rows, ids: rows.map((row) => row.id) };
  } finally {
    if (database) database.close();
  }
}

function getKamasResearchDefinition(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare(
      `SELECT id, name, nextptid, is_limitbreak, reflvllmt, atk, atk_c, dur, dur_c
       FROM master_part WHERE id = ?`,
    ).get(KAMAS_RE_FINAL_PART_ID);
    if (!row || row.name !== 'PT_ARM.TXT_PT_ARM_WP031_0B4' || row.nextptid !== '' ||
        row.is_limitbreak !== 5 || row.reflvllmt !== 20) {
      fail(tr(190));
    }
    return {
      databasePath,
      maximumInternalLevel: row.reflvllmt,
      limitBreakStart: row.is_limitbreak,
      maximumDisplayLevel: row.reflvllmt + row.is_limitbreak - 1,
      row,
    };
  } finally {
    if (database) database.close();
  }
}

function getCollisionMushroomStatus(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const placeholders = COLLISION_MUSHROOM_EFFECT_IDS.map(() => '?').join(',');
    const rows = database.prepare(
      `SELECT id, val0, tmmin, tmmax FROM master_mushroom_efc WHERE id IN (${placeholders}) ORDER BY id`,
    ).all(...COLLISION_MUSHROOM_EFFECT_IDS);
    if (rows.length !== COLLISION_MUSHROOM_EFFECT_IDS.length) {
      fail(tr(191));
    }
    return { databasePath, rows };
  } finally {
    if (database) database.close();
  }
}

function createMasterDatabaseBackup(original, prefix = 'masters.db') {
  if (!/^[a-z0-9.-]+$/i.test(prefix)) fail(tr(192));
  const directory = backupDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const name = `${prefix}.${timestamp()}.${sha256(original).slice(0, 12)}.bak`;
  const destination = path.join(directory, name);
  fs.writeFileSync(destination, original, { flag: 'wx' });
  return destination;
}

function assertEquipmentMaterialSchema(database) {
  const columns = new Set(
    database.prepare('PRAGMA table_info(master_part_research)').all().map((row) => row.name),
  );
  const required = ['ptid', ...EQUIPMENT_MATERIAL_COLUMNS];
  const missing = required.filter((name) => !columns.has(name));
  if (missing.length > 0) {
    fail(tr(193, missing.join(', ')));
  }
}

function readEquipmentMaterialRows(databasePath) {
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    assertEquipmentMaterialSchema(database);
    const columns = EQUIPMENT_MATERIAL_COLUMNS.map((name) => `"${name}"`).join(', ');
    return database.prepare(
      `SELECT ptid, ${columns} FROM master_part_research ORDER BY ptid`,
    ).all();
  } finally {
    if (database) database.close();
  }
}

function summarizeEquipmentMaterialRows(rows) {
  let nonZeroRows = 0;
  let nonZeroCells = 0;
  for (const row of rows) {
    let rowHasMaterial = false;
    for (const column of EQUIPMENT_MATERIAL_COLUMNS) {
      const value = row[column];
      if (value !== null && Number(value) !== 0) {
        rowHasMaterial = true;
        nonZeroCells += 1;
      }
    }
    if (rowHasMaterial) nonZeroRows += 1;
  }
  return { rowCount: rows.length, nonZeroRows, nonZeroCells };
}

function equipmentMaterialRowsDigest(rows) {
  return sha256(Buffer.from(JSON.stringify(rows), 'utf8'));
}

function getEquipmentMaterialStatus(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  const rows = readEquipmentMaterialRows(databasePath);
  return { databasePath, rows, ...summarizeEquipmentMaterialRows(rows) };
}

function listEquipmentMaterialBackups() {
  const directory = backupDirectory();
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() &&
      entry.name.startsWith(EQUIPMENT_MATERIAL_BACKUP_PREFIX) && entry.name.endsWith('.bak'))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
}

function setEquipmentMaterialsFree(savePath) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const status = getEquipmentMaterialStatus(savePath);
  if (status.rowCount === 0) fail(tr(194));
  if (status.nonZeroCells === 0) {
    return { ...status, changed: false, backupPath: undefined };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original, 'masters.db.equipment-materials');
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    assertEquipmentMaterialSchema(database);
    database.exec('BEGIN IMMEDIATE');
    const assignments = EQUIPMENT_MATERIAL_COLUMNS
      .map((name) => `"${name}" = CASE WHEN "${name}" IS NULL THEN NULL ELSE 0 END`)
      .join(', ');
    const conditions = EQUIPMENT_MATERIAL_COLUMNS
      .map((name) => `COALESCE(ABS("${name}"), 0) > 0`)
      .join(' OR ');
    const result = database.prepare(
      `UPDATE master_part_research SET ${assignments} WHERE ${conditions}`,
    ).run();
    if (Number(result.changes) !== status.nonZeroRows) {
      fail(tr(196, result.changes, status.nonZeroRows));
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getEquipmentMaterialStatus(savePath);
  if (verified.rowCount !== status.rowCount || verified.nonZeroCells !== 0) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail(tr(198));
  }
  return { ...verified, changed: true, backupPath };
}

function restoreEquipmentMaterials(savePath, requestedBackupPath) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const backups = listEquipmentMaterialBackups();
  const sourcePath = requestedBackupPath ? path.resolve(requestedBackupPath) : backups[0];
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    fail(tr(199));
  }
  const sourceRows = readEquipmentMaterialRows(sourcePath);
  if (sourceRows.length === 0) fail(tr(200));

  const databasePath = getMasterDatabasePath(savePath);
  const currentRows = readEquipmentMaterialRows(databasePath);
  if (currentRows.length !== sourceRows.length ||
      currentRows.some((row, index) => row.ptid !== sourceRows[index].ptid)) {
    fail(tr(201));
  }

  const original = fs.readFileSync(databasePath);
  const originalHash = sha256(original);
  const safetyBackup = createMasterDatabaseBackup(original, 'masters.db.before-equipment-materials-restore');
  let database;
  try {
    if (sha256(fs.readFileSync(databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(databasePath);
    assertEquipmentMaterialSchema(database);
    database.exec('BEGIN IMMEDIATE');
    const assignments = EQUIPMENT_MATERIAL_COLUMNS.map((name) => `"${name}" = ?`).join(', ');
    const update = database.prepare(
      `UPDATE master_part_research SET ${assignments} WHERE ptid = ?`,
    );
    for (const row of sourceRows) {
      const values = EQUIPMENT_MATERIAL_COLUMNS.map((name) => row[name]);
      const result = update.run(...values, row.ptid);
      if (Number(result.changes) !== 1) {
        fail(tr(202, row.ptid));
      }
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const restoredRows = readEquipmentMaterialRows(databasePath);
  if (equipmentMaterialRowsDigest(restoredRows) !== equipmentMaterialRowsDigest(sourceRows)) {
    fs.copyFileSync(safetyBackup, databasePath);
    fail(tr(203));
  }
  return {
    databasePath,
    sourcePath,
    safetyBackup,
    ...summarizeEquipmentMaterialRows(restoredRows),
  };
}

function listEquipmentSpiritBackups() {
  const directory = backupDirectory();
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory,{withFileTypes:true})
    .filter(entry=>entry.isFile() && entry.name.startsWith('masters.db.equipment-spirit.') && entry.name.endsWith('.bak'))
    .map(entry=>path.join(directory,entry.name))
    .sort((a,b)=>path.basename(b).localeCompare(path.basename(a)));
}

function setEquipmentSpiritFree(savePath) {
  return require('./equipment-spirit').setFree(getMasterDatabasePath(savePath), {
    isGameRunning,backup:bytes=>createMasterDatabaseBackup(bytes,'masters.db.equipment-spirit'),
  });
}

function restoreEquipmentSpirit(savePath, sourcePath) {
  const source = sourcePath || listEquipmentSpiritBackups()[0];
  if (!source) fail(tr(204));
  return require('./equipment-spirit').restore(getMasterDatabasePath(savePath),source,{
    isGameRunning,backup:bytes=>createMasterDatabaseBackup(bytes,'masters.db.before-equipment-spirit-restore'),
  });
}

async function manageEquipmentSpirit(rl,savePath,restore=false,yes=false,requestedBackup) {
  const status = require('./equipment-spirit').status(getMasterDatabasePath(savePath));
  console.log(tr(205, status.databasePath));
  console.log(tr(206, formatNumber(status.nonZeroRows), formatNumber(status.rowCount)));
  console.log(tr(207));
  const source = restore ? (requestedBackup || listEquipmentSpiritBackups()[0]) : null;
  if (restore && !source) fail(tr(204));
  if (source) console.log(tr(208, source));
  if (!yes && !await confirm(rl,restore ? tr(209) : tr(210))) return;
  const result = restore ? restoreEquipmentSpirit(savePath,source) : setEquipmentSpiritFree(savePath);
  console.log(result.changed ? tr(211, restore ? tr(212) : tr(213), result.backupPath) : tr(214));
}

async function manageJackalOption(rl,savePath,feature,restore=false,yes=false,requestedValue) {
  const jackal = require('./jackal-options');
  const file = getMasterDatabasePath(savePath);
  const current = jackal.status(file,feature);
  console.log(tr(215, file, feature==='spawn'?tr(216):tr(217), current.applied?tr(218):tr(219)));
  if (feature==='spawn') {
    console.log(tr(220));
    console.log(tr(221));
    for (const row of current.rows.filter(row=>row.id.endsWith('_TIME_1'))) console.log(tr(222, row.id, row.value));
  } else {
    console.log(tr(223));
    console.log(tr(224));
    for (const row of current.rows) console.log(tr(225, row.type, (row.drop_rmap_weapon_rate+row.drop_rmap_armor_rate)/10));
  }
  if (restore && !current.applied) { console.log(tr(226)); return; }
  let value = null;
  if (!restore) {
    const fallback = feature==='spawn'?10:80;
    const input = requestedValue ?? (yes ? String(fallback) : (await rl.question(feature==='spawn'?tr(227):tr(228))).trim() || String(fallback));
    if (!/^\d+$/.test(String(input))) fail(tr(229));
    value = Number(input);
    if (feature==='spawn' ? value<1 || value>300 : ![50,80,100].includes(value)) fail(tr(230));
  }
  if (!yes && !await confirm(rl,restore?tr(231):tr(232, feature==='spawn'?value+tr(233):value+tr(234)))) return;
  const result = jackal.change(file,feature,value,{isGameRunning,backup:bytes=>createMasterDatabaseBackup(bytes,`masters.db.jackal-${feature}`)});
  console.log(result.changed ? tr(235, restore?tr(212):tr(236), result.backupPath) : tr(237));
  console.log(tr(238));
}

async function manageM2gKnife(rl,savePath,restore=false,yes=false) {
  const m2g=require('./m2g-knife'),file=getMasterDatabasePath(savePath),current=m2g.status(file);
  console.log(tr(239, file, current.applied?tr(218):tr(219)));
  for(const row of current.rows) console.log(tr(240, row.id.includes('_FF_')?'FireFly':tr(241), row.scale));
  console.log(tr(242));
  console.log(tr(243));
  console.log(tr(244));
  if(restore&&!current.applied){console.log(tr(245));return;}
  if(!yes&&!await confirm(rl,restore?tr(246):tr(247)))return;
  const result=m2g.change(file,restore,{isGameRunning,backup:bytes=>createMasterDatabaseBackup(bytes,'masters.db.m2g-knife')});
  console.log(result.changed?tr(248, restore?tr(212):tr(249), result.backupPath):tr(250));
  console.log(tr(251));
}

function setCollisionMushroomThirtyMinutes(savePath) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const status = getCollisionMushroomStatus(savePath);
  const alreadyChanged = status.rows.every((row) =>
    row.tmmin === COLLISION_MUSHROOM_DURATION_SECONDS &&
    row.tmmax === COLLISION_MUSHROOM_DURATION_SECONDS);
  if (alreadyChanged) {
    return { ...status, changed: false, backupPath: undefined };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    const update = database.prepare(
      'UPDATE master_mushroom_efc SET tmmin = ?, tmmax = ? WHERE id = ?',
    );
    for (const id of COLLISION_MUSHROOM_EFFECT_IDS) {
      const result = update.run(
        COLLISION_MUSHROOM_DURATION_SECONDS,
        COLLISION_MUSHROOM_DURATION_SECONDS,
        id,
      );
      if (Number(result.changes) !== 1) {
        fail(tr(252, id));
      }
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getCollisionMushroomStatus(savePath);
  if (!verified.rows.every((row) =>
    row.tmmin === COLLISION_MUSHROOM_DURATION_SECONDS &&
    row.tmmax === COLLISION_MUSHROOM_DURATION_SECONDS)) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail(tr(198));
  }

  return { ...verified, changed: true, backupPath };
}

function restoreCollisionMushroomDefault(savePath) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const status = getCollisionMushroomStatus(savePath);
  const alreadyDefault = status.rows.every((row) => {
    const defaultSec = COLLISION_MUSHROOM_DEFAULT_DURATIONS[row.id];
    return row.tmmin === defaultSec && row.tmmax === defaultSec;
  });
  if (alreadyDefault) {
    return { ...status, changed: false, backupPath: undefined };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    const update = database.prepare(
      'UPDATE master_mushroom_efc SET tmmin = ?, tmmax = ? WHERE id = ?',
    );
    for (const [id, defaultSec] of Object.entries(COLLISION_MUSHROOM_DEFAULT_DURATIONS)) {
      const result = update.run(defaultSec, defaultSec, id);
      if (Number(result.changes) !== 1) {
        fail(tr(253, id));
      }
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getCollisionMushroomStatus(savePath);
  if (!verified.rows.every((row) => {
    const defaultSec = COLLISION_MUSHROOM_DEFAULT_DURATIONS[row.id];
    return row.tmmin === defaultSec && row.tmmax === defaultSec;
  })) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail(tr(254));
  }

  return { ...verified, changed: true, backupPath };
}

function getUltimateFighterReturnStatus(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare(
      `SELECT id, name, type, val0, val1, val2, val3, val4, val5, premium, rarity
       FROM master_skill WHERE id = ?`,
    ).get(ULTIMATE_FIGHTER_RETURN_ID);
    if (!row || row.type !== 'SKLTP_FIGHTER_STATUP' || row.premium !== 1 || row.rarity !== 5) {
      fail(tr(255));
    }
    if ([row.val1, row.val2, row.val3, row.val4, row.val5].some((value) => value !== 0)) {
      fail(tr(256));
    }
    return { databasePath, row };
  } finally {
    if (database) database.close();
  }
}

function setUltimateFighterReturnPercent(savePath, targetPercent) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const percent = Number(targetPercent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 1_000_000) {
    fail(tr(257));
  }

  const status = getUltimateFighterReturnStatus(savePath);
  if (status.row.val0 === percent) {
    return { ...status, changed: false, backupPath: undefined, targetPercent: percent };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    const result = database.prepare(
      'UPDATE master_skill SET val0 = ? WHERE id = ?',
    ).run(
      percent,
      ULTIMATE_FIGHTER_RETURN_ID,
    );
    if (Number(result.changes) !== 1) {
      fail(tr(258));
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getUltimateFighterReturnStatus(savePath);
  if (verified.row.val0 !== percent) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail(tr(198));
  }

  return { ...verified, changed: true, backupPath, targetPercent: percent };
}

function setUltimateFighterReturnFiveTimes(savePath) {
  return setUltimateFighterReturnPercent(savePath, ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT);
}

function restoreUltimateFighterReturn(savePath) {
  return setUltimateFighterReturnPercent(savePath, ULTIMATE_FIGHTER_RETURN_BASE_PERCENT);
}

function getQueenOfSpadesStatus(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare(
      `SELECT id, name, type, val0, val1, val2, val3, val4, val5, premium, rarity
       FROM master_skill WHERE id = ?`,
    ).get(QUEEN_OF_SPADES_ID);
    if (!row || row.name !== 'SKILL_NAME.TXT_SKL_SYLVIA_NMH_02' ||
        row.type !== 'SKLTP_SUPER_DEFUP_NMH' || row.premium !== 1 || row.rarity !== 5 ||
        row.val1 !== 20 || row.val2 !== 10 ||
        [row.val3, row.val4, row.val5].some((value) => value !== 0)) {
      fail(tr(259));
    }
    return { databasePath, row };
  } finally {
    if (database) database.close();
  }
}

function parseQueenOfSpadesValue(input, multiplier = false) {
  const value = Number(input);
  const percent = multiplier ? Math.round(QUEEN_OF_SPADES_BASE_ATTACK_PERCENT * value) : value;
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(percent) || percent < 1 || percent > QUEEN_OF_SPADES_MAX_PERCENT) {
    fail(tr(260));
  }
  return percent;
}

function setQueenOfSpadesPercent(savePath, targetPercent) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const percent = parseQueenOfSpadesValue(targetPercent);

  const status = getQueenOfSpadesStatus(savePath);
  if (status.row.val0 === percent) {
    return { ...status, changed: false, backupPath: undefined, targetPercent: percent };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    const result = database.prepare(
      'UPDATE master_skill SET val0 = ? WHERE id = ?',
    ).run(
      percent,
      QUEEN_OF_SPADES_ID,
    );
    if (Number(result.changes) !== 1) {
      fail(tr(261));
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getQueenOfSpadesStatus(savePath);
  if (verified.row.val0 !== percent) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail(tr(198));
  }

  return { ...verified, changed: true, backupPath, targetPercent: percent };
}

function setQueenOfSpadesExtremeDamage(savePath) {
  return setQueenOfSpadesPercent(savePath, QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT);
}

function restoreQueenOfSpades(savePath) {
  return setQueenOfSpadesPercent(savePath, QUEEN_OF_SPADES_BASE_ATTACK_PERCENT);
}

function getWolfRageStatus(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const normalSuperWolf = database.prepare('SELECT * FROM master_skill WHERE id = ?').get('SKL_RGSPDUP_02');
    const superWolf = database.prepare('SELECT * FROM master_skill WHERE id = ?').get('SKL_RGSPDUP_02_P');
    const madWolf = database.prepare('SELECT * FROM master_skill WHERE id = ?').get('SKL_RGSPUP_RDURDOWN_01_P');
    if (!superWolf || !madWolf) {
      fail(tr(262));
    }
    return {
      databasePath,
      normalSuperWolf,
      superWolf,
      madWolf,
      isBoosted: superWolf.val0 >= WOLF_RAGE_TARGET_PERCENT && madWolf.val0 >= WOLF_RAGE_TARGET_PERCENT && (!normalSuperWolf || normalSuperWolf.val0 >= WOLF_RAGE_TARGET_PERCENT),
    };
  } finally {
    if (database) database.close();
  }
}

function setWolfRagePercent(savePath, targetPercent = WOLF_RAGE_TARGET_PERCENT) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const percent = Number(targetPercent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 50_000) {
    fail(tr(263));
  }

  const status = getWolfRageStatus(savePath);
  if (status.superWolf.val0 === percent && status.madWolf.val0 === percent &&
      (!status.normalSuperWolf || status.normalSuperWolf.val0 === percent)) {
    return { ...status, changed: false, backupPath: undefined, targetPercent: percent };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    if (status.normalSuperWolf) {
      database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(percent, 'SKL_RGSPDUP_02');
    }
    const result1 = database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(percent, 'SKL_RGSPDUP_02_P');
    const result2 = database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(percent, 'SKL_RGSPUP_RDURDOWN_01_P');
    if (Number(result1.changes) !== 1 || Number(result2.changes) !== 1) {
      fail(tr(264));
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getWolfRageStatus(savePath);
  if (verified.superWolf.val0 !== percent || verified.madWolf.val0 !== percent ||
      (verified.normalSuperWolf && verified.normalSuperWolf.val0 !== percent)) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail(tr(198));
  }

  return { ...verified, changed: true, backupPath, targetPercent: percent };
}

function restoreWolfRageDefault(savePath) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const status = getWolfRageStatus(savePath);
  if (status.superWolf.val0 === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P &&
      status.madWolf.val0 === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P &&
      (!status.normalSuperWolf || status.normalSuperWolf.val0 === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02)) {
    return { ...status, changed: false, backupPath: undefined };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    if (status.normalSuperWolf) {
      database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02, 'SKL_RGSPDUP_02');
    }
    database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P, 'SKL_RGSPDUP_02_P');
    database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P, 'SKL_RGSPUP_RDURDOWN_01_P');
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getWolfRageStatus(savePath);
  return { ...verified, changed: true, backupPath };
}

function getRichFamilyStatus(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare(
      `SELECT id, name, type, val0, val1, val2, val3, val4, val5, premium, rarity
       FROM master_skill WHERE id = ?`,
    ).get(RICH_FAMILY_DECAL_ID);
    if (!row || row.type !== 'SKLTP_RESOURCEUP_DECDURDOWN' || row.premium !== 1 || row.rarity !== 5) {
      fail(tr(265));
    }
    const resourcePercent = row.val0;
    const durabilityPercent = row.val3;
    const isDefault = resourcePercent === RICH_FAMILY_DEFAULT_RESOURCE && durabilityPercent === RICH_FAMILY_DEFAULT_DURABILITY;
    const isInfiniteDurability = durabilityPercent >= RICH_FAMILY_INFINITE_DURABILITY;
    return {
      databasePath,
      row,
      resourcePercent,
      durabilityPercent,
      isDefault,
      isInfiniteDurability,
    };
  } finally {
    if (database) database.close();
  }
}

function setRichFamilyValues(savePath, targetResourcePercent, targetDurabilityPercent) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const resource = Number(targetResourcePercent);
  const durability = Number(targetDurabilityPercent);
  if (!Number.isInteger(resource) || resource < 0 || resource > 50_000) {
    fail(tr(266));
  }
  if (!Number.isInteger(durability) || durability < 0 || durability > 100) {
    fail(tr(267));
  }

  const status = getRichFamilyStatus(savePath);
  if (status.resourcePercent === resource && status.durabilityPercent === durability) {
    return { ...status, changed: false, backupPath: undefined, targetResource: resource, targetDurability: durability };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    const result = database.prepare(
      'UPDATE master_skill SET val0 = ?, val1 = ?, val2 = ?, val3 = ?, val4 = ?, val5 = ? WHERE id = ?',
    ).run(
      resource, resource, resource,
      durability, durability, durability,
      RICH_FAMILY_DECAL_ID,
    );
    if (Number(result.changes) !== 1) {
      fail(tr(268));
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getRichFamilyStatus(savePath);
  if (verified.resourcePercent !== resource || verified.durabilityPercent !== durability) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail(tr(198));
  }

  return { ...verified, changed: true, backupPath, targetResource: resource, targetDurability: durability };
}

function restoreRichFamilyDefault(savePath) {
  return setRichFamilyValues(savePath, RICH_FAMILY_DEFAULT_RESOURCE, RICH_FAMILY_DEFAULT_DURABILITY);
}

function getNaomiDetoxStatus(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare(
      `SELECT id, name, type, val0, val1, val2, val3, val4, val5, premium, rarity
       FROM master_skill WHERE id = ?`,
    ).get(NAOMI_DETOX_DECAL_ID);
    if (!row || row.type !== 'SKLTP_RESOURCEUP_DECDURDOWN' || row.premium !== 1 || row.rarity !== 5) {
      fail(tr(269));
    }
    const resourcePercent = row.val1;
    const durabilityPercent = row.val3;
    const isDefault = resourcePercent === NAOMI_DETOX_DEFAULT_RESOURCE && durabilityPercent === NAOMI_DETOX_DEFAULT_DURABILITY && row.val0 === 0 && row.val2 === 0;
    const isInfiniteDurability = durabilityPercent >= NAOMI_DETOX_INFINITE_DURABILITY;
    return {
      databasePath,
      row,
      resourcePercent,
      durabilityPercent,
      isDefault,
      isInfiniteDurability,
    };
  } finally {
    if (database) database.close();
  }
}

function setNaomiDetoxValues(savePath, targetResourcePercent, targetDurabilityPercent = 0) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const resource = Number(targetResourcePercent);
  const durability = Number(targetDurabilityPercent);
  if (!Number.isInteger(resource) || resource < 0 || resource > 50_000) {
    fail(tr(270));
  }
  if (!Number.isInteger(durability) || durability < 0 || durability > 100) {
    fail(tr(267));
  }

  const status = getNaomiDetoxStatus(savePath);
  if (status.resourcePercent === resource && status.durabilityPercent === durability) {
    return { ...status, changed: false, backupPath: undefined, targetResource: resource, targetDurability: durability };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    const result = database.prepare(
      'UPDATE master_skill SET val0 = 0, val1 = ?, val2 = 0, val3 = ?, val4 = ?, val5 = ? WHERE id = ?',
    ).run(
      resource,
      durability, durability, resource,
      NAOMI_DETOX_DECAL_ID,
    );
    if (Number(result.changes) !== 1) {
      fail(tr(271));
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const verified = getNaomiDetoxStatus(savePath);
  if (verified.resourcePercent !== resource || verified.durabilityPercent !== durability) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail(tr(198));
  }

  return { ...verified, changed: true, backupPath, targetResource: resource, targetDurability: durability };
}

function restoreNaomiDetoxDefault(savePath) {
  return setNaomiDetoxValues(savePath, NAOMI_DETOX_DEFAULT_RESOURCE, NAOMI_DETOX_DEFAULT_DURABILITY);
}

const FIGHTER_LIMIT_BACKUP_PREFIX = 'masters.db.fighter-limits.';
const PLAYABLE_6STAR_TYPES = ['BAL', 'BRE', 'COL', 'DEF', 'LUK', 'SHT', 'SKI', 'TEC'];

function listFighterLimitBackups() {
  const directory = backupDirectory();
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() &&
      entry.name.startsWith(FIGHTER_LIMIT_BACKUP_PREFIX) && entry.name.endsWith('.bak'))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
}

function getFighterLimitStatus(savePath) {
  const databasePath = getMasterDatabasePath(savePath);
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const statMaxRow = database.prepare(
      "SELECT MAX(lvl) as maxLvl FROM master_bodylvl_status_value WHERE type = 'BAL' AND grade = 6",
    ).get();
    const expMaxRow = database.prepare(
      "SELECT MAX(lvl) as maxExpLvl FROM master_bodylvl_exp WHERE grade = 6",
    ).get();
    const bodyDetailRow = database.prepare(
      "SELECT param_lv_max, skill_slots FROM master_body_detail WHERE type = 'BAL' AND grade = 6 AND limit_break = 4",
    ).get();
    return {
      databasePath,
      statMaxLevel: statMaxRow?.maxLvl ?? 45,
      expMaxLevel: expMaxRow?.maxExpLvl ?? 280,
      bodyDetailParamMax: bodyDetailRow?.param_lv_max ?? 45,
      skillSlotsCount: bodyDetailRow?.skill_slots ? bodyDetailRow.skill_slots.split(',').length : 9,
    };
  } finally {
    if (database) database.close();
  }
}

function setFighterBagExpansion(savePath, type, enabled) {
  return require('./fighter-bag').setExpansion(getMasterDatabasePath(savePath), type, enabled, {
    isGameRunning,
    backup: bytes => createMasterDatabaseBackup(bytes, 'masters.db.fighter-bag'),
  });
}

async function manageFighterBag(rl, savePath, fighter) {
  if (fighter.grade !== 6) fail(tr(272));
  const status = require('./fighter-bag').getStatus(getMasterDatabasePath(savePath),fighter.type);
  console.log(tr(273, fighter.typeName || fighter.type, status.applied ? tr(274) : tr(275), status.maximum));
  console.log(tr(276));
  console.log(tr(277));
  if (status.applied) console.log(tr(278, status.originalMaximum));
  if (!await confirm(rl,status.applied ? tr(279) : tr(280, status.maximum, status.maximum+50))) return;
  const result = setFighterBagExpansion(savePath,fighter.type,!status.applied);
  console.log(tr(281, result.applied ? tr(282) : tr(212), result.maximum, result.backupPath));
  console.log(tr(283));
}

function expandFighterLimits(savePath, targetStatMax = 50, targetExpMax = 500) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const databasePath = getMasterDatabasePath(savePath);
  const status = getFighterLimitStatus(savePath);
  if (status.statMaxLevel >= targetStatMax && status.expMaxLevel >= targetExpMax && status.bodyDetailParamMax >= targetStatMax && status.skillSlotsCount === 9) {
    return { ...status, changed: false, backupPath: undefined };
  }

  const original = fs.readFileSync(databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original, 'masters.db.fighter-limits');
  let database;
  let addedStatusRows = 0;
  let addedExpRows = 0;

  try {
    if (sha256(fs.readFileSync(databasePath)) !== originalHash) {
      fail(tr(195));
    }
    database = new DatabaseSync(databasePath);
    database.exec('BEGIN IMMEDIATE');

    // 1. master_bodylvl_status_value 테이블 확장
    const insertStatusStmt = database.prepare(
      `INSERT OR REPLACE INTO master_bodylvl_status_value
       (lvl, type, grade, limit_break, hp, str, dex, vit, stm, stmrecov, luk, skill, bag, rage)
       VALUES (?, ?, 6, 4, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`
    );

    for (const type of PLAYABLE_6STAR_TYPES) {
      const r41 = database.prepare('SELECT * FROM master_bodylvl_status_value WHERE type = ? AND grade = 6 AND lvl = 41').get(type);
      const r45 = database.prepare('SELECT * FROM master_bodylvl_status_value WHERE type = ? AND grade = 6 AND lvl = 45').get(type);
      if (!r41 || !r45) {
        fail(tr(284, type));
      }
      const deltaHp = Math.round((r45.hp - r41.hp) / 4);
      const deltaStr = Math.round((r45.str - r41.str) / 4);
      const deltaDex = Math.round((r45.dex - r41.dex) / 4);
      const deltaVit = Math.round((r45.vit - r41.vit) / 4);
      const deltaStm = Math.round((r45.stm - r41.stm) / 4);
      const deltaLuk = Math.round((r45.luk - r41.luk) / 4);

      for (let lvl = 46; lvl <= targetStatMax; lvl++) {
        const step = lvl - 45;
        const curHp = r45.hp + (deltaHp * step);
        const curStr = r45.str + (deltaStr * step);
        const curDex = r45.dex + (deltaDex * step);
        const curVit = r45.vit + (deltaVit * step);
        const curStm = r45.stm + (deltaStm * step);
        const curLuk = r45.luk + (deltaLuk * step);
        insertStatusStmt.run(lvl, type, curHp, curStr, curDex, curVit, curStm, r45.stmrecov, curLuk);
        addedStatusRows += 1;
      }
    }

    // 2. master_bodylvl_exp 테이블 확장
    const r276 = database.prepare('SELECT * FROM master_bodylvl_exp WHERE grade = 6 AND lvl = 276').get();
    const r280 = database.prepare('SELECT * FROM master_bodylvl_exp WHERE grade = 6 AND lvl = 280').get();
    if (r276 && r280) {
      const deltaExp = Math.round((r280.exp - r276.exp) / 4);
      const deltaBloodnium = Math.round((r280.bloodnium - r276.bloodnium) / 4);
      const insertExpStmt = database.prepare(
        'INSERT OR REPLACE INTO master_bodylvl_exp (grade, lvl, exp, zmbexp, bloodnium) VALUES (6, ?, ?, ?, ?)'
      );
      for (let lvl = 281; lvl <= targetExpMax; lvl++) {
        const step = lvl - 280;
        const curExp = r280.exp + (deltaExp * step);
        const curBloodnium = r280.bloodnium + (deltaBloodnium * step);
        insertExpStmt.run(lvl, curExp, r280.zmbexp, curBloodnium);
        addedExpRows += 1;
      }
    }

    // 3. master_body_detail 테이블 param_lv_max 및 skill_slots 확장
    // The decal UI and stock final limit-break tier support exactly 9 slots.
    // Expanding this list beyond 9 changes the skill-level conversion ranges.
    const slotsString = Array.from({ length: 9 }, (_, i) => i + 1).join(',');
    database.prepare(`
      UPDATE master_body_detail 
      SET param_lv_max = ?, skill_slots = ?
      WHERE grade = 6 AND limit_break = 4
    `).run(targetStatMax, slotsString);

    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(tr(197));
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database) {
      try { database.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    if (database) database.close();
  }

  const updatedStatus = getFighterLimitStatus(savePath);
  return {
    ...updatedStatus,
    changed: true,
    backupPath,
    addedStatusRows,
    addedExpRows,
  };
}

function restoreFighterLimits(savePath, sourceBackupPath) {
  if (isGameRunning()) {
    fail(tr(88));
  }

  const databasePath = getMasterDatabasePath(savePath);
  const backups = listFighterLimitBackups();
  const backupToUse = sourceBackupPath || (backups.length > 0 ? backups[0] : null);
  if (!backupToUse || !fs.existsSync(backupToUse)) {
    fail(tr(285));
  }

  const currentOriginal = fs.readFileSync(databasePath);
  const safetyBackup = createMasterDatabaseBackup(currentOriginal, 'masters.db.before-fighter-limits-restore');

  try {
    fs.copyFileSync(backupToUse, databasePath);
    let database;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      const integrity = database.prepare('PRAGMA integrity_check').get();
      if (!integrity || integrity.integrity_check !== 'ok') {
        throw new Error(tr(286));
      }
    } finally {
      if (database) database.close();
    }
  } catch (error) {
    fs.copyFileSync(safetyBackup, databasePath);
    throw error;
  }

  const restoredStatus = getFighterLimitStatus(savePath);
  return {
    ...restoredStatus,
    changed: true,
    safetyBackup,
    sourceBackup: backupToUse,
  };
}

function validateAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > INT32_MAX) {
    fail(tr(287, formatNumber(INT32_MAX)));
  }
}

function parseAmount(value) {
  const text = String(value ?? '').replaceAll(',', '').trim();
  if (!/^\d+$/.test(text)) {
    fail(tr(288));
  }
  const amount = Number(text);
  validateAmount(amount);
  return amount;
}

function writeChangedSave(savePath, save, resourceKey, amount) {
  const resource = RESOURCES[resourceKey];
  validateAmount(amount);
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const changedText = replaceResource(save, resourceKey, amount);
  const packed = packSave(changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.kc-edit.tmp`;
  const rollbackPath = `${savePath}.kc-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(289));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    if (check.data.soul[resource.field] !== amount) {
      fail(tr(290, resource.label));
    }
    const expectedText = replaceResource(save, resourceKey, amount);
    if (check.jsonText !== expectedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return { backupPath, packedHash: sha256(packed) };
}

function writeBloodniumShopReset(savePath, save) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const mutation = replaceBloodniumShopHistory(save);
  if (!mutation.previous.needsReset) {
    fail(tr(291));
  }
  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.shop-edit.tmp`;
  const rollbackPath = `${savePath}.shop-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(292));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getBloodniumShopState(check);
    if (checkState.bought.length !== 0 ||
        checkState.available.join(',') !== mutation.restored.join(',')) {
      fail(tr(293));
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    backupPath,
    restoredCount: mutation.previous.bought.length,
    availableCount: mutation.restored.length,
    packedHash: sha256(packed),
  };
}

function writeAllDecals(savePath, save) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const definition = getAllDecalDefinitions(savePath);
  const mutation = replaceAllDecals(save, definition.ids);
  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.decal-edit.tmp`;
  const rollbackPath = `${savePath}.decal-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(294));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkStock = getDecalStock(check);
    if (checkStock.length !== mutation.changedStock.length) {
      fail(tr(295));
    }
    const checkCounts = new Map(checkStock.map((entry) => [entry.sklid, entry.cnt]));
    const expectedCounts = new Map(mutation.changedStock.map((entry) => [entry.sklid, entry.cnt]));
    for (const id of definition.ids) {
      if (checkCounts.get(id) !== expectedCounts.get(id)) {
        fail(tr(296, id));
      }
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    backupPath,
    databasePath: definition.databasePath,
    addedCount: definition.ids.length,
    previousStockCount: mutation.previousStockCount,
    currentStockCount: mutation.changedStock.length,
    newTypes: mutation.newTypes,
    incrementedTypes: mutation.incrementedTypes,
    removedHistoryCount: mutation.removedHistoryCount,
    packedHash: sha256(packed),
  };
}

function writeGoldenBeasts(savePath, save, countPerBeast = 1) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const definition = getGoldenBeastDefinitions(savePath);
  const mutation = replaceGoldenBeasts(save, definition.rows, countPerBeast);
  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.golden-beast-edit.tmp`;
  const rollbackPath = `${savePath}.golden-beast-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(297));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkBeasts = new Map(getBeastStock(check).map((entry) => [entry.eid, entry]));
    const checkMushrooms = new Map(getMushroomStock(check).map((entry) => [entry.eid, entry]));
    const checkSlots = new Map(getCoinLockerSlots(check).map((entry) => [entry.slot, entry]));
    for (const grant of mutation.grants) {
      const beast = checkBeasts.get(grant.beastEntityId);
      const mushroom = checkMushrooms.get(grant.rewardEntityId);
      const slot = checkSlots.get(grant.slot);
      if (!beast || beast.owner !== 'COIN_LOCKER' || beast.bstid !== grant.beastId ||
          beast.rwdemsrid !== grant.rewardEntityId || !mushroom || mushroom.owner !== 'BEAST' ||
          mushroom.msrid !== grant.rewardMushroomId || !slot ||
          slot.type !== COIN_LOCKER_BEAST_TYPE || slot.eid !== grant.beastEntityId) {
        fail(tr(298, grant.beastId));
      }
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    backupPath,
    databasePath: definition.databasePath,
    countPerBeast: mutation.countPerBeast,
    addedCount: mutation.grants.length,
    previousBeastCount: mutation.previousBeastCount,
    currentBeastCount: mutation.currentBeastCount,
    previousEmptySlots: mutation.previousEmptySlots,
    currentEmptySlots: mutation.currentEmptySlots,
    packedHash: sha256(packed),
  };
}

function writeLimitedRecipes(savePath, save) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const definition = getLimitedRecipeDefinitions(savePath);
  const mutation = replaceLimitedRecipes(save, definition.rows);
  if (mutation.addedIds.length === 0) {
    return {
      changed: false,
      databasePath: definition.databasePath,
      addedCount: 0,
      previousOwnedCount: mutation.state.ownedIds.length,
      currentOwnedCount: mutation.state.ownedIds.length,
      backupPath: undefined,
    };
  }

  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.limited-recipe-edit.tmp`;
  const rollbackPath = `${savePath}.limited-recipe-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(299));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getLimitedRecipeState(check);
    if (checkState.missingIds.length !== 0 ||
        checkState.research.length !== mutation.changedResearch.length ||
        JSON.stringify(checkState.research) !== JSON.stringify(mutation.changedResearch)) {
      fail(tr(300));
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    changed: true,
    backupPath,
    databasePath: definition.databasePath,
    addedCount: mutation.addedIds.length,
    previousOwnedCount: mutation.state.ownedIds.length,
    currentOwnedCount: LIMITED_RECIPE_DEFINITION_COUNT,
    names: definition.rows
      .filter((row) => mutation.addedIds.includes(row.id))
      .map((row) => row.display_name),
    packedHash: sha256(packed),
  };
}

function writeAllRecipes(savePath, save) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const definition = getAllRecipeDefinitions(savePath);
  const mutation = replaceAllRecipes(save, definition.rows);
  if (mutation.addedIds.length === 0) {
    return {
      changed: false,
      databasePath: definition.databasePath,
      addedCount: 0,
      previousOwnedCount: mutation.state.ownedIds.length,
      currentOwnedCount: mutation.state.ownedIds.length,
      backupPath: undefined,
    };
  }

  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.all-recipe-edit.tmp`;
  const rollbackPath = `${savePath}.all-recipe-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(301));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getRecipeUnlockState(check, definition.ids, tr(70));
    if (checkState.missingIds.length !== 0 ||
        checkState.research.length !== mutation.changedResearch.length ||
        JSON.stringify(checkState.research) !== JSON.stringify(mutation.changedResearch)) {
      fail(tr(302));
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    changed: true,
    backupPath,
    databasePath: definition.databasePath,
    addedCount: mutation.addedIds.length,
    previousOwnedCount: mutation.state.ownedIds.length,
    currentOwnedCount: ALL_RECIPE_DEFINITION_COUNT,
    packedHash: sha256(packed),
  };
}
function writeKamasResearchMaximum(savePath, save) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail(tr(89));
  }

  const definition = getKamasResearchDefinition(savePath);
  const mutation = replaceKamasResearchMaximum(
    save,
    definition.maximumInternalLevel,
    definition.limitBreakStart,
  );
  if (mutation.state.isMaxed) {
    return { changed: false, definition, state: mutation.state, backupPath: undefined };
  }

  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.kamas-edit.tmp`;
  const rollbackPath = `${savePath}.kamas-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(303));
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getKamasResearchState(
      check,
      definition.maximumInternalLevel,
      definition.limitBreakStart,
    );
    if (!checkState.isMaxed || checkState.maximumDisplayLevel !== definition.maximumDisplayLevel) {
      fail(tr(304));
    }
    if (check.jsonText !== mutation.changedText) {
      fail(tr(92));
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail(tr(93));
    }

    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  return {
    changed: true,
    backupPath,
    definition,
    previousCompletedDisplayLevel: mutation.state.completedDisplayLevel,
    previousCurrentDisplayLevel: mutation.state.currentDisplayLevel,
    maximumDisplayLevel: definition.maximumDisplayLevel,
    addedLevels: mutation.addedLevels,
    packedHash: sha256(packed),
  };
}

function listBackups(savePath) {
  const directory = backupDirectory();
  if (!fs.existsSync(directory)) return [];
  const prefix = `${saveBackupKey(savePath)}.`;
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
    .map((name) => path.join(directory, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function restoreBackup(savePath, backupPath) {
  if (isGameRunning()) {
    fail(tr(88));
  }
  const backupSave = readSave(backupPath);
  const current = readSave(savePath);
  const safetyBackup = createBackup(savePath, current.packed);
  const tempPath = `${savePath}.kc-restore.tmp`;
  const rollbackPath = `${savePath}.kc-restore.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail(tr(305));
  }
  fs.writeFileSync(tempPath, backupSave.packed, { flag: 'wx' });
  try {
    readSave(tempPath);
    if (!fs.readFileSync(savePath).equals(current.packed)) {
      fail(tr(306));
    }
    fs.renameSync(savePath, rollbackPath);
    try {
      fs.renameSync(tempPath, savePath);
    } catch (error) {
      fs.renameSync(rollbackPath, savePath);
      throw error;
    }
    fs.unlinkSync(rollbackPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }
  const restoredResources = {};
  for (const [resourceKey, resource] of Object.entries(RESOURCES)) {
    restoredResources[resourceKey] = backupSave.data.soul[resource.field];
  }
  return { restoredResources, safetyBackup };
}

function parseArguments(argv) {
  const args = [...argv];
  let savePath = null;
  let masterPath = null;
  let yes = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === '--save') {
      if (!args[index + 1]) fail(tr(307));
      savePath = path.resolve(stripPathInputQuotes(args[index + 1]));
      args.splice(index, 2);
    } else if (args[index] === '--game' || args[index] === '--master') {
      const option = args[index];
      if (!args[index + 1]) fail(tr(308, option));
      masterPath = args[index + 1];
      args.splice(index, 2);
    } else if (args[index] === '--yes') {
      yes = true;
      args.splice(index, 1);
    } else {
      index += 1;
    }
  }
  // Explorer passes a dropped file/folder as a bare positional argument.
  const dropped = stripPathInputQuotes(args[0] || '');
  const looksLikePath = /[\\/]/.test(dropped) || /\.sav$/i.test(dropped) ||
    (args.length === 1 && fs.existsSync(dropped) && fs.statSync(dropped).isDirectory());
  if (looksLikePath) {
    if (savePath || args.length !== 1) fail(tr(309));
    savePath = path.resolve(dropped);
    args.shift();
  }
  return { args, masterPath, savePath, yes };
}

const MASTER_DATABASE_COMMANDS = new Set([
  'collision-30m',
  'collision-restore',
  'ultimate-fighter',
  'ultimate-fighter-5x',
  'ultimate-fighter-restore',
  'kamas-re-max',
  'queen-spades',
  'queen-spades-extreme',
  'queen-spades-restore',
  'wolf-rage',
  'wolf-rage-restore',
  'rich-family',
  'rich-family-restore',
  'naomi-detox',
  'naomi-detox-restore',
  'detox',
  'detox-restore',
  'equipment-materials-free',
  'equipment-materials-restore',
  'equipment-spirit-free',
  'equipment-spirit-restore',
  'jackal-spawn-fast',
  'jackal-spawn-restore',
  'jackal-blueprints',
  'jackal-blueprints-restore',
  'm2g-knife-compensate',
  'm2g-knife-restore',
  'expand-fighter-limits',
  'restore-fighter-limits',
]);

async function configureMasterDatabase(rl, savePath, explicitPath, required) {
  if (explicitPath) {
    setMasterDatabaseOverride(explicitPath);
    return;
  }
  if (!required || findMasterDatabasePath(savePath)) return;
  if (!rl) {
    fail(tr(310));
  }
  console.log(tr(311));
  console.log(tr(312));
  const manualInput = await rl.question(tr(313));
  if (!manualInput.trim()) fail(tr(314));
  const databasePath = setMasterDatabaseOverride(manualInput);
  console.log(tr(174, databasePath));
}

async function chooseSave(rl, explicitPath) {
  let saves;
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) fail(tr(315, explicitPath));
    if (fs.statSync(explicitPath).isFile()) {
      if (!/\.sav$/i.test(explicitPath)) fail(tr(316));
      return explicitPath;
    }
    saves = resolveManualSaveInput(explicitPath);
    if (!saves.length) fail(tr(317));
    if (saves.length > 1 && !rl) fail(tr(318));
  } else {
    saves = discoverSaves();
  }
  if (saves.length === 0) {
    if (!rl) {
      fail(tr(319));
    }
    console.log(tr(320));
    console.log(tr(321));
    const manualInput = await rl.question(tr(322));
    if (!manualInput.trim()) fail(tr(323));
    saves = resolveManualSaveInput(manualInput);
    if (saves.length === 0) {
      fail(tr(324));
    }
  }
  if (saves.length === 1 || !rl) return saves[0];
  console.log(tr(325));
  saves.forEach((savePath, index) => console.log(`  ${index + 1}. ${savePath}`));
  const answer = Number(await rl.question(tr(326)));
  if (!Number.isInteger(answer) || answer < 1 || answer > saves.length) {
    fail(tr(327));
  }
  return saves[answer - 1];
}

function printStatus(savePath, save) {
  console.log(tr(328, savePath));
  for (const [resourceKey, resource] of Object.entries(RESOURCES)) {
    const value = save.data.soul[resource.field];
    const capacity = getKnownCapacity(save, resourceKey);
    const level = resource.levelField ? save.data.soul[resource.levelField] : undefined;
    const levelText = Number.isInteger(level) ? tr(329, level) : '';
    const capacityText = capacity ? tr(330, formatNumber(capacity)) : '';
    console.log(`${resource.label}: ${formatNumber(value)}${levelText}${capacityText}`);
  }
  const shop = getBloodniumShopState(save);
  console.log(tr(331, formatNumber(shop.available.length), formatNumber(shop.bought.length)));
  if (shop.duplicateCount) console.log(tr(332, formatNumber(shop.duplicateCount)));
  const decalStock = getDecalStock(save);
  console.log(tr(333, formatNumber(decalStock.length), formatNumber(STEAM_DECAL_DEFINITION_COUNT)));
  const goldenBeasts = getGoldenBeastSummary(save);
  console.log(tr(334, formatNumber(goldenBeasts.count), formatNumber(goldenBeasts.typeCount), formatNumber(GOLDEN_BEAST_IDS.length)));
  const limitedRecipes = getLimitedRecipeState(save);
  console.log(tr(335, formatNumber(limitedRecipes.ownedIds.length), formatNumber(LIMITED_RECIPE_DEFINITION_COUNT)));
  console.log(tr(336, sha256(save.packed)));
}

function printResourceValues(save, prefix = '') {
  for (const resource of Object.values(RESOURCES)) {
    console.log(`${prefix}${resource.label}: ${formatNumber(save.data.soul[resource.field])}`);
  }
}

async function confirm(rl, prompt) {
  const answer = (await rl.question(`${prompt} (y/N): `)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

async function pause(rl) {
  if (!rl) return;
  await rl.question(tr(337));
}

async function interactive(rl, savePath) {
  while (true) {
    const save = readSave(savePath);
    printStatus(savePath, save);

    console.log(tr(338));
    console.log(tr(339));
    console.log(tr(340));
    console.log(tr(341));
    console.log(tr(342));
    console.log(tr(343));
    console.log(tr(344));
    console.log(tr(345));
    console.log(tr(346));
    console.log(tr(347));
    console.log(tr(348));
    console.log(tr(349));
    console.log(tr(350));
    console.log(tr(351));
    console.log(tr(352, formatNumber(LIMITED_RECIPE_DEFINITION_COUNT)));
    console.log(tr(353, formatNumber(ALL_RECIPE_DEFINITION_COUNT)));
    console.log(tr(354));
    console.log(tr(355, formatNumber(STEAM_DECAL_DEFINITION_COUNT)));
    console.log(tr(356));
    console.log(tr(357));
    console.log(tr(358));
    console.log(tr(359));
    console.log(tr(360));
    console.log(tr(361));
    console.log(tr(362));
    console.log(tr(363));
    console.log(tr(364));
    console.log(tr(365));
    console.log(tr(366));
    console.log(tr(367));
    console.log(tr(368));
    console.log(tr(369));
    console.log(tr(370));
    console.log(tr(371));
    console.log(tr(372));
    console.log(tr(373));
    console.log(tr(374));
    console.log(tr(375));
    console.log(tr(376));
    console.log(tr(377));
    console.log(tr(378));

    const choice = (await rl.question(tr(379))).trim();

    if (choice === '0') return;

    try {
      if (choice === '1') {
        const fighters = getFighterList(save);
        console.log(tr(380));
        fighters.forEach((f, idx) => {
          const s = f.stats;
          console.log(tr(381, idx + 1, f.name, f.grade, f.typeName, s.lvl, f.state));
        });
        console.log(tr(382));
        console.log('==================================================================================');

        const fIdxStr = (await rl.question(tr(383))).trim();
        if (fIdxStr === '0' || !fIdxStr) continue;
        const fIdx = Number(fIdxStr) - 1;
        if (!Number.isInteger(fIdx) || fIdx < 0 || fIdx >= fighters.length) {
          console.log(tr(384));
          continue;
        }

        const selected = fighters[fIdx];
        const selection = await require('./fighter-menu').chooseFighterUpdate({
          rl, fighter: selected, databasePath: getMasterDatabasePath(savePath), confirm,
          manageBag: fighter => manageFighterBag(rl,savePath,fighter),
        });
        if (!selection) continue;
        const result = writeFighterStats(savePath, save, fIdx, selection.updates);
        console.log(tr(385, selected.name, selection.modeDesc));
        console.log(tr(386, result.backupPath));
        console.log(tr(387));
      } else if (choice === '2') {
        const status = getFighterLimitStatus(savePath);
        console.log(tr(388));
        console.log(tr(174, status.databasePath));
        console.log(tr(389, status.statMaxLevel, status.expMaxLevel));
        if (status.statMaxLevel >= 50 && status.expMaxLevel >= 500 && status.skillSlotsCount === 9) {
          console.log(tr(390));
          await pause(rl);
          continue;
        }
        console.log('\n' + '='.repeat(72));
        console.log(tr(391));
        console.log('-'.repeat(72));
        console.log(tr(392));
        console.log(tr(393));
        console.log(tr(394));
        console.log(tr(395));
        console.log(tr(396));
        console.log('='.repeat(72));
        if (!await confirm(rl, tr(397))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = expandFighterLimits(savePath, 50, 500);
        console.log(tr(399));
        console.log(tr(400, status.statMaxLevel, result.statMaxLevel, result.addedStatusRows));
        console.log(tr(401, status.expMaxLevel, result.expMaxLevel, result.addedExpRows));
        console.log(tr(402, result.backupPath));
      } else if (choice === '3') {
        const backups = listFighterLimitBackups();
        console.log(tr(403));
        if (backups.length === 0) {
          console.log(tr(404));
          await pause(rl);
          continue;
        }
        const sourcePath = backups[0];
        console.log(tr(405, sourcePath));
        if (!await confirm(rl, tr(406))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = restoreFighterLimits(savePath, sourcePath);
        console.log(tr(407));
        console.log(tr(408, result.statMaxLevel, result.expMaxLevel));
        console.log(tr(409, result.safetyBackup));
      } else if (['4', '5', '6'].includes(choice)) {
        const resourceKey = ['killcoins', 'splithium', 'bloodnium'][Number(choice) - 4];
        const resource = RESOURCES[resourceKey];
        const capacity = getKnownCapacity(save, resourceKey);
        console.log(tr(410, resource.label));
        if (!capacity) {
          console.log(tr(411, resource.label));
          await pause(rl);
          continue;
        }
        console.log(tr(412, formatNumber(getResourceAmount(save, resourceKey)), formatNumber(capacity)));
        if (!await confirm(rl, tr(413, resource.label, formatNumber(capacity)))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeChangedSave(savePath, save, resourceKey, capacity);
        console.log(tr(414, resource.label));
        console.log(tr(415, formatNumber(capacity)));
        console.log(tr(416, result.backupPath));
      } else if (choice === '7') {
        console.log(tr(417));
        console.log(tr(418));
        console.log(tr(419));
        console.log(tr(420));
        console.log(tr(421));
        const resourceChoice = (await rl.question(tr(422))).trim();
        if (resourceChoice === '0' || !resourceChoice) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        if (!['1', '2', '3'].includes(resourceChoice)) {
          console.log(tr(423));
          await pause(rl);
          continue;
        }
        const resourceKey = ['killcoins', 'splithium', 'bloodnium'][Number(resourceChoice) - 1];
        const resource = RESOURCES[resourceKey];
        const capacity = getKnownCapacity(save, resourceKey);
        const currentAmount = getResourceAmount(save, resourceKey);
        console.log(tr(424, resource.label, formatNumber(currentAmount), capacity ? formatNumber(capacity) : tr(425)));
        const amount = parseAmount(await rl.question(tr(426, resource.label)));
        if (capacity && amount > capacity) {
          console.log(tr(427, formatNumber(capacity)));
        }
        if (!await confirm(rl, tr(428, resource.label, formatNumber(amount)))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeChangedSave(savePath, save, resourceKey, amount);
        console.log(tr(429, resource.label));
        console.log(tr(415, formatNumber(amount)));
        console.log(tr(416, result.backupPath));
      } else if (choice === '8') {
        const facilityState = getFacilityState(save);
        console.log(tr(430));
        console.log(tr(431, facilityState.safeLevel, facilityState.tankLevel));
        if (facilityState.isMaxed) {
          console.log(tr(432));
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, tr(433))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeFacilityUpgradesMaximum(savePath, save);
        console.log(tr(434));
        console.log(tr(435, result.previousSafeLevel, result.currentSafeLevel, result.previousTankLevel, result.currentTankLevel));
        console.log(tr(416, result.backupPath));
      } else if (choice === '9') {
        const researchState = getEquipmentResearchState(save, savePath);
        console.log(tr(436));
        console.log(tr(437, formatNumber(researchState.existingCount)));
        if (researchState.isMaxed) {
          console.log(tr(438));
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, tr(439))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeEquipmentResearchMaximum(savePath, save);
        console.log(tr(440));
        console.log(tr(441, formatNumber(result.totalPartCount)));
        console.log(tr(442, formatNumber(result.totalEntries), formatNumber(result.addedCount)));
        console.log(tr(443));
        console.log(tr(416, result.backupPath));
      } else if (choice === '10') {
        const definition = getKamasResearchDefinition(savePath);
        const state = getKamasResearchState(
          save,
          definition.maximumInternalLevel,
          definition.limitBreakStart,
        );
        console.log(tr(444));
        console.log(tr(445, state.completedDisplayLevel));
        if (state.currentDisplayLevel > state.completedDisplayLevel) {
          console.log(tr(446, state.currentDisplayLevel));
        }
        console.log(tr(447, definition.maximumDisplayLevel));
        if (state.completedDisplayLevel >= definition.maximumDisplayLevel) {
          console.log(tr(448, definition.maximumDisplayLevel));
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, tr(449, definition.maximumDisplayLevel))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeKamasResearchMaximum(savePath, save);
        if (!result.changed) {
          console.log(tr(448, definition.maximumDisplayLevel));
        } else {
          console.log(tr(450));
          console.log(tr(451, result.maximumDisplayLevel));
          console.log(tr(416, result.backupPath));
        }
      } else if (choice === '11') {
        const masteryState = getWeaponMasteryState(save);
        console.log(tr(452));
        console.log(tr(453, formatNumber(masteryState.maxLevelCount), formatNumber(masteryState.totalCount)));
        if (masteryState.isMaxed) {
          console.log(tr(454));
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, tr(455, formatNumber(masteryState.totalCount)))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeWeaponMasteriesMaximum(savePath, save);
        console.log(tr(456));
        console.log(tr(457, formatNumber(result.upgradedCount)));
        console.log(tr(416, result.backupPath));
      } else if (choice === '12') {
        const state = getLimitedRecipeState(save);
        console.log(tr(458));
        console.log(tr(459, formatNumber(state.ownedIds.length), formatNumber(LIMITED_RECIPE_DEFINITION_COUNT), formatNumber(state.missingIds.length)));
        console.log('----------------------------------------------------------------------------------');
        if (state.missingIds.length === 0) {
          console.log(tr(460));
          await pause(rl);
          continue;
        }
        console.log(tr(461, formatNumber(state.missingIds.length)));
        if (!await confirm(rl, tr(462, formatNumber(state.missingIds.length)))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeLimitedRecipes(savePath, save);
        console.log(tr(463));
        console.log(tr(464, formatNumber(result.addedCount)));
        console.log(tr(465, formatNumber(result.previousOwnedCount), formatNumber(result.currentOwnedCount), formatNumber(LIMITED_RECIPE_DEFINITION_COUNT)));
        console.log(tr(416, result.backupPath));
      } else if (choice === '13') {
        const definition = getAllRecipeDefinitions(savePath);
        const state = getRecipeUnlockState(save, definition.ids, tr(70));
        console.log(tr(466));
        console.log(tr(459, formatNumber(state.ownedIds.length), formatNumber(ALL_RECIPE_DEFINITION_COUNT), formatNumber(state.missingIds.length)));
        console.log('----------------------------------------------------------------------------------');
        if (state.missingIds.length === 0) {
          console.log(tr(467));
          await pause(rl);
          continue;
        }
        console.log(tr(468, formatNumber(state.missingIds.length)));
        if (!await confirm(rl, tr(462, formatNumber(state.missingIds.length)))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeAllRecipes(savePath, save);
        console.log(tr(469));
        console.log(tr(464, formatNumber(result.addedCount)));
        console.log(tr(465, formatNumber(result.previousOwnedCount), formatNumber(result.currentOwnedCount), formatNumber(ALL_RECIPE_DEFINITION_COUNT)));
        console.log(tr(416, result.backupPath));
      } else if (choice === '14') {
        const definition = getAllDecalDefinitions(savePath);
        const currentStock = getDecalStock(save);
        console.log(tr(470));
        console.log(tr(471, formatNumber(currentStock.length), formatNumber(STEAM_DECAL_DEFINITION_COUNT)));
        if (!await confirm(rl, tr(472, formatNumber(STEAM_DECAL_DEFINITION_COUNT)))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeAllDecals(savePath, save);
        console.log(tr(473));
        console.log(tr(474, formatNumber(result.addedCount), formatNumber(result.newTypes), formatNumber(result.incrementedTypes)));
        console.log(tr(475, formatNumber(result.previousStockCount), formatNumber(result.currentStockCount)));
        if (result.removedHistoryCount > 0) console.log(tr(476, formatNumber(result.removedHistoryCount)));
        console.log(tr(416, result.backupPath));
      } else if (choice === '15') {
        const slots = getCoinLockerSlots(save);
        const emptySlots = slots.filter((entry) => entry.type === -1 && entry.eid === '');
        const maxPerBeast = Math.floor(emptySlots.length / GOLDEN_BEAST_IDS.length);
        const goldenBeasts = getGoldenBeastSummary(save);

        console.log(tr(477));
        console.log(tr(478, formatNumber(slots.length), formatNumber(emptySlots.length)));
        console.log(tr(479, formatNumber(goldenBeasts.count), formatNumber(goldenBeasts.typeCount), GOLDEN_BEAST_IDS.length));
        if (maxPerBeast < 1) {
          console.log(tr(480));
          await pause(rl);
          continue;
        }
        console.log(tr(481, formatNumber(maxPerBeast), formatNumber(maxPerBeast * GOLDEN_BEAST_IDS.length)));

        const input = (await rl.question(tr(482, maxPerBeast))).trim();
        if (input === '0') {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const count = input === '' ? 1 : Number(input);
        if (!Number.isInteger(count) || count < 1 || count > maxPerBeast) {
          console.log(tr(483, maxPerBeast));
          await pause(rl);
          continue;
        }

        if (!await confirm(rl, tr(484, count, count * GOLDEN_BEAST_IDS.length))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeGoldenBeasts(savePath, save, count);
        console.log(tr(485));
        console.log(tr(486, formatNumber(count), formatNumber(result.addedCount)));
        console.log(tr(487, formatNumber(result.previousBeastCount), formatNumber(result.currentBeastCount), formatNumber(result.addedCount)));
        console.log(tr(488, formatNumber(result.previousEmptySlots), formatNumber(result.currentEmptySlots), formatNumber(result.addedCount)));
        console.log(tr(416, result.backupPath));
      } else if (choice === '16') {
        const shop = getBloodniumShopState(save);
        console.log(tr(489));
        console.log(tr(490, formatNumber(shop.available.length), formatNumber(shop.bought.length)));
        if (!shop.needsReset) {
          console.log(tr(491));
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, tr(492, formatNumber(shop.bought.length), formatNumber(shop.duplicateCount)))) {
          console.log(tr(398));
          await pause(rl);
          continue;
        }
        const result = writeBloodniumShopReset(savePath, save);
        console.log(tr(493));
        console.log(tr(494, formatNumber(result.restoredCount)));
        console.log(tr(495, formatNumber(result.availableCount)));
        console.log(tr(416, result.backupPath));
      } else if (choice === '17') {
        const status = getCollisionMushroomStatus(savePath);
        console.log(tr(205, status.databasePath));
        console.log(tr(496, formatNumber(status.rows[0].tmmin)));
        console.log(tr(497, formatNumber(status.rows[1].tmmin)));
        const is30m = status.rows.every((row) =>
          row.tmmin === COLLISION_MUSHROOM_DURATION_SECONDS &&
          row.tmmax === COLLISION_MUSHROOM_DURATION_SECONDS);

        if (is30m) {
          console.log(tr(498));
          if (!await confirm(rl, tr(499))) continue;
          const result = restoreCollisionMushroomDefault(savePath);
          console.log(tr(500));
          console.log(tr(501));
          console.log(tr(402, result.backupPath));
        } else {
          if (!await confirm(rl, tr(502))) continue;
          const result = setCollisionMushroomThirtyMinutes(savePath);
          console.log(tr(503));
          console.log(tr(504, formatNumber(status.rows[0].tmmin), formatNumber(status.rows[1].tmmin)));
          console.log(tr(402, result.backupPath));
        }
      } else if (choice === '18') {
        const status = getUltimateFighterReturnStatus(savePath);
        const currentPercent = status.row.val0;
        const currentRatio = (currentPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
        console.log(tr(205, status.databasePath));
        console.log(tr(505));
        console.log(tr(506, formatNumber(currentPercent), currentRatio));
        console.log(tr(507));
        console.log(tr(508));
        console.log(tr(509));
        console.log(tr(510));
        console.log(tr(511));
        console.log(tr(512));

        const subChoice = (await rl.question(tr(513))).trim();
        if (subChoice === '1') {
          const input = (await rl.question(tr(514, currentPercent))).trim();
          if (!input) continue;
          const targetPercent = Number(input.replace(/[%]/g, ''));
          if (!Number.isInteger(targetPercent) || targetPercent < 1 || targetPercent > 1_000_000) {
            console.log(tr(515));
            continue;
          }
          if (targetPercent === currentPercent) {
            console.log(tr(516, formatNumber(currentPercent)));
            continue;
          }
          const targetRatio = (targetPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
          if (!await confirm(rl, tr(517, formatNumber(targetPercent), targetRatio))) continue;
          const result = setUltimateFighterReturnPercent(savePath, targetPercent);
          console.log(tr(518));
          console.log(tr(519, formatNumber(currentPercent), formatNumber(result.row.val0), targetRatio));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '2') {
          const input = (await rl.question(tr(520, currentRatio))).trim();
          if (!input) continue;
          const multiplier = Number(input.replace(/[x배X]/g, ''));
          if (isNaN(multiplier) || multiplier <= 0 || multiplier > 50000) {
            console.log(tr(521));
            continue;
          }
          const targetPercent = Math.round(ULTIMATE_FIGHTER_RETURN_BASE_PERCENT * multiplier);
          if (targetPercent === currentPercent) {
            console.log(tr(522, formatNumber(currentPercent), multiplier));
            continue;
          }
          if (!await confirm(rl, tr(523, multiplier, formatNumber(targetPercent)))) continue;
          const result = setUltimateFighterReturnPercent(savePath, targetPercent);
          console.log(tr(518));
          console.log(tr(519, formatNumber(currentPercent), formatNumber(result.row.val0), multiplier));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '3') {
          if (currentPercent === ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT) {
            console.log(tr(524));
            continue;
          }
          if (!await confirm(rl, tr(525))) continue;
          const result = setUltimateFighterReturnFiveTimes(savePath);
          console.log(tr(518));
          console.log(tr(526, formatNumber(currentPercent)));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '4') {
          if (currentPercent === ULTIMATE_FIGHTER_RETURN_BASE_PERCENT) {
            console.log(tr(527));
            continue;
          }
          if (!await confirm(rl, tr(528))) continue;
          const result = restoreUltimateFighterReturn(savePath);
          console.log(tr(529));
          console.log(tr(530, formatNumber(currentPercent)));
          console.log(tr(402, result.backupPath));
        } else {
          continue;
        }
      } else if (choice === '19') {
        const status = getQueenOfSpadesStatus(savePath);
        const currentPercent = status.row.val0;
        const currentRatio = (currentPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
        console.log(tr(205, status.databasePath));
        console.log(tr(531));
        console.log(tr(532, formatNumber(currentPercent), currentRatio));
        console.log(tr(533, formatNumber(status.row.val1), formatNumber(status.row.val2)));
        console.log(tr(534));
        console.log(tr(535));
        console.log(tr(507));
        console.log(tr(536));
        console.log(tr(537));
        console.log(tr(538, formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)));
        console.log(tr(539, QUEEN_OF_SPADES_BASE_ATTACK_PERCENT));
        console.log(tr(512));

        const subChoice = (await rl.question(tr(513))).trim();
        if (subChoice === '1') {
          const input = (await rl.question(tr(540, currentPercent))).trim();
          if (!input) continue;
          const targetPercent = parseQueenOfSpadesValue(input.replace(/[%]/g, ''));
          if (targetPercent === currentPercent) {
            console.log(tr(516, formatNumber(currentPercent)));
            continue;
          }
          const targetRatio = (targetPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
          if (!await confirm(rl, tr(541, formatNumber(targetPercent), targetRatio))) continue;
          const result = setQueenOfSpadesPercent(savePath, targetPercent);
          console.log(tr(542));
          console.log(tr(543, formatNumber(currentPercent), formatNumber(result.row.val0), targetRatio));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '2') {
          const input = (await rl.question(tr(544, currentRatio))).trim();
          if (!input) continue;
          const multiplier = Number(input.replace(/[x배X]/g, ''));
          const targetPercent = parseQueenOfSpadesValue(multiplier, true);
          if (targetPercent === currentPercent) {
            console.log(tr(522, formatNumber(currentPercent), multiplier));
            continue;
          }
          if (!await confirm(rl, tr(545, multiplier, formatNumber(targetPercent)))) continue;
          const result = setQueenOfSpadesPercent(savePath, targetPercent);
          console.log(tr(542));
          console.log(tr(543, formatNumber(currentPercent), formatNumber(result.row.val0), multiplier));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '3') {
          if (currentPercent === QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT) {
            console.log(tr(546, formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)));
            continue;
          }
          if (!await confirm(rl, tr(547, formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)))) continue;
          const result = setQueenOfSpadesExtremeDamage(savePath);
          console.log(tr(548));
          console.log(tr(549, formatNumber(currentPercent), formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '4') {
          if (currentPercent === QUEEN_OF_SPADES_BASE_ATTACK_PERCENT) {
            console.log(tr(550, QUEEN_OF_SPADES_BASE_ATTACK_PERCENT));
            continue;
          }
          if (!await confirm(rl, tr(551, QUEEN_OF_SPADES_BASE_ATTACK_PERCENT))) continue;
          const result = restoreQueenOfSpades(savePath);
          console.log(tr(552));
          console.log(tr(553, formatNumber(currentPercent), QUEEN_OF_SPADES_BASE_ATTACK_PERCENT));
          console.log(tr(402, result.backupPath));
        } else {
          continue;
        }
      } else if (choice === '20') {
        const status = getWolfRageStatus(savePath);
        const superPercent = status.superWolf.val0;
        const madPercent = status.madWolf.val0;
        console.log(tr(205, status.databasePath));
        console.log(tr(554));
        console.log(tr(555, formatNumber(superPercent)));
        console.log(tr(556, formatNumber(madPercent)));
        console.log(tr(557));
        console.log(tr(558));
        console.log(tr(507));
        console.log(tr(559, formatNumber(WOLF_RAGE_TARGET_PERCENT)));
        console.log(tr(560));
        console.log(tr(561));
        console.log(tr(512));

        const subChoice = (await rl.question(tr(513))).trim();
        if (subChoice === '1') {
          if (status.isBoosted) {
            console.log(tr(562, formatNumber(WOLF_RAGE_TARGET_PERCENT)));
          } else {
            if (!await confirm(rl, tr(563, formatNumber(WOLF_RAGE_TARGET_PERCENT)))) continue;
            const result = setWolfRagePercent(savePath, WOLF_RAGE_TARGET_PERCENT);
            console.log(tr(564));
            console.log(tr(565, formatNumber(superPercent), formatNumber(result.superWolf.val0)));
            console.log(tr(566, formatNumber(madPercent), formatNumber(result.madWolf.val0)));
            console.log(tr(402, result.backupPath));
          }
        } else if (subChoice === '2') {
          const input = (await rl.question(tr(567))).trim();
          if (!input) continue;
          const targetPercent = Number(input.replace(/[%]/g, ''));
          if (!Number.isInteger(targetPercent) || targetPercent < 1 || targetPercent > 50_000) {
            console.log(tr(568));
            continue;
          }
          if (superPercent === targetPercent && madPercent === targetPercent) {
            console.log(tr(569, formatNumber(targetPercent)));
            continue;
          }
          if (!await confirm(rl, tr(563, formatNumber(targetPercent)))) continue;
          const result = setWolfRagePercent(savePath, targetPercent);
          console.log(tr(570));
          console.log(tr(565, formatNumber(superPercent), formatNumber(result.superWolf.val0)));
          console.log(tr(566, formatNumber(madPercent), formatNumber(result.madWolf.val0)));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '3') {
          if (superPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P &&
              madPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P) {
            console.log(tr(571));
            continue;
          }
          if (!await confirm(rl, tr(572))) continue;
          const result = restoreWolfRageDefault(savePath);
          console.log(tr(573));
          console.log(tr(574, formatNumber(superPercent), formatNumber(result.superWolf.val0)));
          console.log(tr(575, formatNumber(madPercent), formatNumber(result.madWolf.val0)));
          console.log(tr(402, result.backupPath));
        } else {
          continue;
        }
      } else if (choice === '21') {
        const status = getRichFamilyStatus(savePath);
        const currentResource = status.resourcePercent;
        const currentDurability = status.durabilityPercent;
        console.log(tr(205, status.databasePath));
        console.log(tr(576));
        console.log(tr(577, formatNumber(currentResource)));
        console.log(tr(578, currentDurability >= 100 ? tr(579) : tr(580, formatNumber(currentDurability))));
        console.log(tr(581));
        console.log(tr(582));
        console.log(tr(507));
        console.log(tr(583));
        console.log(tr(584));
        console.log(tr(585));
        console.log(tr(586));
        console.log(tr(587));
        console.log(tr(512));

        const subChoice = (await rl.question(tr(513))).trim();
        if (subChoice === '1') {
          if (!await confirm(rl, tr(588))) continue;
          const result = setRichFamilyValues(savePath, RICH_FAMILY_RECOMMENDED_RESOURCE, RICH_FAMILY_INFINITE_DURABILITY);
          console.log(tr(589));
          console.log(tr(590, formatNumber(currentResource), formatNumber(result.resourcePercent)));
          console.log(tr(591, currentDurability, result.durabilityPercent));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '2') {
          if (!await confirm(rl, tr(592))) continue;
          const result = setRichFamilyValues(savePath, 1_000, RICH_FAMILY_INFINITE_DURABILITY);
          console.log(tr(589));
          console.log(tr(590, formatNumber(currentResource), formatNumber(result.resourcePercent)));
          console.log(tr(591, currentDurability, result.durabilityPercent));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '3') {
          if (!await confirm(rl, tr(593))) continue;
          const result = setRichFamilyValues(savePath, RICH_FAMILY_DEFAULT_RESOURCE, RICH_FAMILY_INFINITE_DURABILITY);
          console.log(tr(589));
          console.log(tr(594, formatNumber(result.resourcePercent)));
          console.log(tr(591, currentDurability, result.durabilityPercent));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '4') {
          const resInput = (await rl.question(tr(595, currentResource))).trim();
          if (!resInput) continue;
          const targetResource = Number(resInput.replace(/[%]/g, ''));
          if (!Number.isInteger(targetResource) || targetResource < 0 || targetResource > 50_000) {
            console.log(tr(596));
            continue;
          }
          const durInput = (await rl.question(tr(597, currentDurability))).trim();
          if (!durInput) continue;
          const targetDurability = Number(durInput.replace(/[%]/g, ''));
          if (!Number.isInteger(targetDurability) || targetDurability < 0 || targetDurability > 100) {
            console.log(tr(598));
            continue;
          }
          if (!await confirm(rl, tr(599, formatNumber(targetResource), targetDurability))) continue;
          const result = setRichFamilyValues(savePath, targetResource, targetDurability);
          console.log(tr(589));
          console.log(tr(590, formatNumber(currentResource), formatNumber(result.resourcePercent)));
          console.log(tr(600, currentDurability, result.durabilityPercent, result.isInfiniteDurability ? tr(601) : ''));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '5') {
          if (status.isDefault) {
            console.log(tr(602));
            continue;
          }
          if (!await confirm(rl, tr(603))) continue;
          const result = restoreRichFamilyDefault(savePath);
          console.log(tr(604));
          console.log(tr(605, formatNumber(currentResource)));
          console.log(tr(606, currentDurability));
          console.log(tr(402, result.backupPath));
        } else {
          continue;
        }
      } else if (choice === '22') {
        const status = getNaomiDetoxStatus(savePath);
        const currentResource = status.resourcePercent;
        const currentDurability = status.durabilityPercent;
        console.log(tr(205, status.databasePath));
        console.log(tr(607));
        console.log(tr(608, formatNumber(currentResource)));
        console.log(tr(609, currentDurability >= 100 ? tr(579) : currentDurability > 0 ? tr(580, formatNumber(currentDurability)) : tr(610)));
        console.log(tr(581));
        console.log(tr(611));
        console.log(tr(507));
        console.log(tr(612));
        console.log(tr(613));
        console.log(tr(614));
        console.log(tr(615));
        console.log(tr(616));
        console.log(tr(617));
        console.log(tr(512));

        const subChoice = (await rl.question(tr(513))).trim();
        if (subChoice === '1') {
          if (!await confirm(rl, tr(618))) continue;
          const result = setNaomiDetoxValues(savePath, NAOMI_DETOX_RECOMMENDED_RESOURCE, NAOMI_DETOX_INFINITE_DURABILITY);
          console.log(tr(619));
          console.log(tr(620, formatNumber(currentResource), formatNumber(result.resourcePercent)));
          console.log(tr(591, currentDurability, result.durabilityPercent));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '2') {
          if (!await confirm(rl, tr(621))) continue;
          const result = setNaomiDetoxValues(savePath, 1_000, NAOMI_DETOX_INFINITE_DURABILITY);
          console.log(tr(619));
          console.log(tr(620, formatNumber(currentResource), formatNumber(result.resourcePercent)));
          console.log(tr(591, currentDurability, result.durabilityPercent));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '3') {
          if (!await confirm(rl, tr(622))) continue;
          const result = setNaomiDetoxValues(savePath, 5_000, NAOMI_DETOX_INFINITE_DURABILITY);
          console.log(tr(619));
          console.log(tr(620, formatNumber(currentResource), formatNumber(result.resourcePercent)));
          console.log(tr(591, currentDurability, result.durabilityPercent));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '4') {
          if (!await confirm(rl, tr(623))) continue;
          const result = setNaomiDetoxValues(savePath, NAOMI_DETOX_RECOMMENDED_RESOURCE, 0);
          console.log(tr(619));
          console.log(tr(620, formatNumber(currentResource), formatNumber(result.resourcePercent)));
          console.log(tr(624, result.durabilityPercent));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '5') {
          const resInput = (await rl.question(tr(625, currentResource))).trim();
          if (!resInput) continue;
          const targetResource = Number(resInput.replace(/[%]/g, ''));
          if (!Number.isInteger(targetResource) || targetResource < 0 || targetResource > 50_000) {
            console.log(tr(626));
            continue;
          }
          const durInput = (await rl.question(tr(597, currentDurability))).trim();
          if (!durInput) continue;
          const targetDurability = Number(durInput.replace(/[%]/g, ''));
          if (!Number.isInteger(targetDurability) || targetDurability < 0 || targetDurability > 100) {
            console.log(tr(598));
            continue;
          }
          if (!await confirm(rl, tr(627, formatNumber(targetResource), targetDurability))) continue;
          const result = setNaomiDetoxValues(savePath, targetResource, targetDurability);
          console.log(tr(619));
          console.log(tr(620, formatNumber(currentResource), formatNumber(result.resourcePercent)));
          console.log(tr(600, currentDurability, result.durabilityPercent, result.isInfiniteDurability ? tr(601) : ''));
          console.log(tr(402, result.backupPath));
        } else if (subChoice === '6') {
          if (status.isDefault) {
            console.log(tr(628));
            continue;
          }
          if (!await confirm(rl, tr(629))) continue;
          const result = restoreNaomiDetoxDefault(savePath);
          console.log(tr(630));
          console.log(tr(631, formatNumber(currentResource)));
          console.log(tr(632, currentDurability));
          console.log(tr(402, result.backupPath));
        } else {
          continue;
        }
      } else if (choice === '23') {
        const status = getEquipmentMaterialStatus(savePath);
        console.log(tr(205, status.databasePath));
        console.log(tr(633, formatNumber(status.rowCount)));
        console.log(tr(634, formatNumber(status.nonZeroRows), formatNumber(status.nonZeroCells)));
        if (!await confirm(rl, tr(635))) continue;
        const result = setEquipmentMaterialsFree(savePath);
        if (!result.changed) {
          console.log(tr(636));
        } else {
          console.log(tr(637));
          console.log(tr(638, formatNumber(result.rowCount)));
          console.log(tr(639));
          console.log(tr(402, result.backupPath));
        }
      } else if (choice === '24') {
        const backups = listEquipmentMaterialBackups();
        if (backups.length === 0) {
          console.log(tr(640));
          continue;
        }
        const sourcePath = backups[0];
        const sourceSummary = summarizeEquipmentMaterialRows(readEquipmentMaterialRows(sourcePath));
        console.log(tr(641, sourcePath));
        console.log(tr(642, formatNumber(sourceSummary.nonZeroRows), formatNumber(sourceSummary.nonZeroCells)));
        if (!await confirm(rl, tr(643))) continue;
        const result = restoreEquipmentMaterials(savePath, sourcePath);
        console.log(tr(644));
        console.log(tr(645, formatNumber(result.nonZeroRows)));
        console.log(tr(409, result.safetyBackup));
      } else if (choice === '27' || choice === '28') {
        await manageEquipmentSpirit(rl,savePath,choice==='28');
      } else if (['29','30','31','32'].includes(choice)) {
        await manageJackalOption(rl,savePath,['29','30'].includes(choice)?'spawn':'blueprints',['30','32'].includes(choice));
      } else if (choice==='33'||choice==='34') {
        await manageM2gKnife(rl,savePath,choice==='34');
      } else if (choice === '25') {
        if (isGameRunning()) {
          console.log(tr(646));
          continue;
        }
        const backupPath = createBackup(savePath, save.packed);
        console.log(tr(647));
        console.log(tr(648, backupPath));
      } else if (choice === '26') {
        const backups = listBackups(savePath);
        if (backups.length === 0) {
          console.log(tr(649));
          continue;
        }
        const latest = backups[0];
        const backupSave = readSave(latest);
        console.log(tr(650, latest));
        printResourceValues(backupSave, tr(651));
        if (!await confirm(rl, tr(652))) continue;
        const result = restoreBackup(savePath, latest);
        console.log(tr(653));
        for (const [resourceKey, value] of Object.entries(result.restoredResources)) {
          console.log(`- ${RESOURCES[resourceKey].label}: ${formatNumber(value)}`);
        }
        console.log(tr(409, result.safetyBackup));
      } else {
        console.log(tr(654));
        continue;
      }

      await pause(rl);
    } catch (error) {
    const logFile = writeErrorLog(error, {
      mode: 'interactive',
      choice,
      savePath,
    });
    console.error(tr(655, error.message));
    if (logFile) console.error(tr(656, logFile));
    if (!error.userFacing && process.env.LID_KC_DEBUG === '1') console.error(error.stack);
  }
}
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const command = parsed.args[0] || 'interactive';
  const needsInteractiveInput = command === 'interactive' || !parsed.yes;
  const rl = needsInteractiveInput
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;

  try {
    const savePath = await chooseSave(rl, parsed.savePath);
    await configureMasterDatabase(
      rl,
      savePath,
      parsed.masterPath,
      command === 'interactive' || MASTER_DATABASE_COMMANDS.has(command),
    );
    const save = readSave(savePath);

    if (command === 'interactive') {
      await interactive(rl, savePath);
      return;
    }
    if (command === 'status') {
      printStatus(savePath, save);
      return;
    }
    if (command === 'set') {
      const hasResourceArgument = Boolean(RESOURCE_ALIASES[String(parsed.args[1] ?? '').toLowerCase()]);
      const resourceKey = hasResourceArgument ? getResourceKey(parsed.args[1]) : 'killcoins';
      const amount = parseAmount(parsed.args[hasResourceArgument ? 2 : 1]);
      const resource = RESOURCES[resourceKey];
      const capacity = getKnownCapacity(save, resourceKey);
      printStatus(savePath, save);
      if (capacity && amount > capacity) {
        console.log(tr(657, resource.label, formatNumber(capacity)));
      }
      if (!parsed.yes && !await confirm(rl, tr(428, resource.label, formatNumber(amount)))) return;
      const result = writeChangedSave(savePath, save, resourceKey, amount);
      console.log(tr(429, resource.label));
      console.log(tr(415, formatNumber(amount)));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'max') {
      const resourceKey = parsed.args[1] ? getResourceKey(parsed.args[1]) : 'killcoins';
      const resource = RESOURCES[resourceKey];
      const amount = getKnownCapacity(save, resourceKey);
      if (!amount) fail(tr(658, resource.label));
      printStatus(savePath, save);
      if (!parsed.yes && !await confirm(rl, tr(428, resource.label, formatNumber(amount)))) return;
      const result = writeChangedSave(savePath, save, resourceKey, amount);
      console.log(tr(659, resource.label));
      console.log(tr(415, formatNumber(amount)));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'backup') {
      if (isGameRunning()) fail(tr(660));
      printStatus(savePath, save);
      const backupPath = createBackup(savePath, save.packed);
      console.log(tr(661));
      console.log(tr(648, backupPath));
      return;
    }
    if (command === 'reset-shop') {
      const shop = getBloodniumShopState(save);
      printStatus(savePath, save);
      if (!shop.needsReset) fail(tr(662));
      if (!parsed.yes && !await confirm(rl, tr(492, formatNumber(shop.bought.length), formatNumber(shop.duplicateCount)))) return;
      const result = writeBloodniumShopReset(savePath, save);
      console.log(tr(493));
      console.log(tr(494, formatNumber(result.restoredCount)));
      console.log(tr(495, formatNumber(result.availableCount)));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'grant-all-decals' || command === 'grant-five-star-all') {
      printStatus(savePath, save);
      if (!parsed.yes && !await confirm(rl, tr(472, formatNumber(STEAM_DECAL_DEFINITION_COUNT)))) return;
      const result = writeAllDecals(savePath, save);
      console.log(tr(473));
      console.log(tr(474, formatNumber(result.addedCount), formatNumber(result.newTypes), formatNumber(result.incrementedTypes)));
      console.log(tr(475, formatNumber(result.previousStockCount), formatNumber(result.currentStockCount)));
      if (result.removedHistoryCount > 0) console.log(tr(476, formatNumber(result.removedHistoryCount)));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'grant-golden-beasts') {
      printStatus(savePath, save);
      const slots = getCoinLockerSlots(save);
      const emptySlots = slots.filter((entry) => entry.type === -1 && entry.eid === '');
      const maxPerBeast = Math.floor(emptySlots.length / GOLDEN_BEAST_IDS.length);

      let count = 1;
      if (parsed.args[1]) {
        const raw = Number(parsed.args[1]);
        if (!Number.isInteger(raw) || raw < 1) {
          fail(tr(663));
        }
        count = raw;
      }

      if (maxPerBeast < 1) {
        fail(tr(664));
      }
      if (count > maxPerBeast) {
        fail(tr(665, emptySlots.length, maxPerBeast, maxPerBeast * GOLDEN_BEAST_IDS.length));
      }

      console.log(tr(666, count, count * GOLDEN_BEAST_IDS.length));
      if (!parsed.yes && !await confirm(rl, tr(484, count, count * GOLDEN_BEAST_IDS.length))) return;
      const result = writeGoldenBeasts(savePath, save, count);
      console.log(tr(485));
      console.log(tr(486, formatNumber(count), formatNumber(result.addedCount)));
      console.log(tr(487, formatNumber(result.previousBeastCount), formatNumber(result.currentBeastCount), formatNumber(result.addedCount)));
      console.log(tr(488, formatNumber(result.previousEmptySlots), formatNumber(result.currentEmptySlots), formatNumber(result.addedCount)));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'grant-limited-recipes') {
      printStatus(savePath, save);
      const state = getLimitedRecipeState(save);
      if (state.missingIds.length === 0) {
        console.log(tr(667));
        return;
      }
      if (!parsed.yes && !await confirm(rl, tr(668, formatNumber(state.missingIds.length)))) return;
      const result = writeLimitedRecipes(savePath, save);
      console.log(tr(463));
      console.log(tr(464, formatNumber(result.addedCount)));
      console.log(tr(669, formatNumber(result.previousOwnedCount), formatNumber(result.currentOwnedCount)));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'grant-all-recipes') {
      printStatus(savePath, save);
      const definition = getAllRecipeDefinitions(savePath);
      const state = getRecipeUnlockState(save, definition.ids, tr(70));
      console.log(tr(670, formatNumber(state.ownedIds.length), formatNumber(ALL_RECIPE_DEFINITION_COUNT)));
      if (state.missingIds.length === 0) {
        console.log(tr(671));
        return;
      }
      if (!parsed.yes && !await confirm(rl, tr(672, formatNumber(state.missingIds.length)))) return;
      const result = writeAllRecipes(savePath, save);
      console.log(tr(469));
      console.log(tr(464, formatNumber(result.addedCount)));
      console.log(tr(669, formatNumber(result.previousOwnedCount), formatNumber(result.currentOwnedCount)));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'collision-30m' || command === 'collision-restore') {
      const status = getCollisionMushroomStatus(savePath);
      console.log(tr(174, status.databasePath));
      console.log(tr(673, formatNumber(status.rows[0].tmmin), formatNumber(status.rows[1].tmmin)));
      const is30m = status.rows.every((row) =>
        row.tmmin === COLLISION_MUSHROOM_DURATION_SECONDS &&
        row.tmmax === COLLISION_MUSHROOM_DURATION_SECONDS);

      if (command === 'collision-restore' || is30m) {
        if (!is30m) {
          console.log(tr(674));
          return;
        }
        console.log(tr(675));
        if (!parsed.yes && !await confirm(rl, tr(499))) return;
        const result = restoreCollisionMushroomDefault(savePath);
        console.log(tr(500));
        console.log(tr(501));
        console.log(tr(402, result.backupPath));
      } else {
        if (!parsed.yes && !await confirm(rl, tr(502))) return;
        const result = setCollisionMushroomThirtyMinutes(savePath);
        console.log(tr(503));
        console.log(tr(504, formatNumber(status.rows[0].tmmin), formatNumber(status.rows[1].tmmin)));
        console.log(tr(402, result.backupPath));
      }
      return;
    }
    if (command === 'ultimate-fighter' || command === 'ultimate-fighter-5x' || command === 'ultimate-fighter-restore') {
      const status = getUltimateFighterReturnStatus(savePath);
      const currentPercent = status.row.val0;
      const currentRatio = (currentPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
      console.log(tr(174, status.databasePath));
      console.log(tr(676, formatNumber(currentPercent), currentRatio));

      let targetPercent;
      let modeDesc = '';

      if (command === 'ultimate-fighter-restore') {
        targetPercent = ULTIMATE_FIGHTER_RETURN_BASE_PERCENT;
        modeDesc = tr(677);
      } else if (command === 'ultimate-fighter-5x') {
        targetPercent = ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT;
        modeDesc = tr(678);
      } else {
        const arg = parsed.args[1];
        if (!arg) {
          fail(tr(679));
        }
        if (arg.toLowerCase() === 'restore' || arg.toLowerCase() === 'default') {
          targetPercent = ULTIMATE_FIGHTER_RETURN_BASE_PERCENT;
          modeDesc = tr(677);
        } else if (/[x배X]$/i.test(arg)) {
          const mult = Number(arg.replace(/[x배X]/gi, ''));
          if (isNaN(mult) || mult <= 0 || mult > 50000) {
            fail(tr(680));
          }
          targetPercent = Math.round(ULTIMATE_FIGHTER_RETURN_BASE_PERCENT * mult);
          modeDesc = tr(681, mult, formatNumber(targetPercent));
        } else {
          const raw = Number(arg.replace(/[%]/g, ''));
          if (!Number.isInteger(raw) || raw < 1 || raw > 1_000_000) {
            fail(tr(682));
          }
          targetPercent = raw;
          const ratio = (targetPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
          modeDesc = tr(683, formatNumber(targetPercent), ratio);
        }
      }

      if (currentPercent === targetPercent) {
        console.log(tr(684, formatNumber(targetPercent)));
        return;
      }

      const ratio = (targetPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
      if (!parsed.yes && !await confirm(rl, tr(517, formatNumber(targetPercent), ratio))) return;

      const result = setUltimateFighterReturnPercent(savePath, targetPercent);
      console.log(tr(518));
      console.log(tr(685, modeDesc));
      console.log(tr(519, formatNumber(currentPercent), formatNumber(result.row.val0), ratio));
      console.log(tr(402, result.backupPath));
      return;
    }
    if (command === 'kamas-re-max') {
      const definition = getKamasResearchDefinition(savePath);
      const state = getKamasResearchState(
        save,
        definition.maximumInternalLevel,
        definition.limitBreakStart,
      );
      console.log(tr(686, state.completedDisplayLevel));
      if (state.currentDisplayLevel > state.completedDisplayLevel) {
        console.log(tr(446, state.currentDisplayLevel));
      }
      console.log(tr(447, definition.maximumDisplayLevel));
      if (!parsed.yes && !await confirm(rl, tr(449, definition.maximumDisplayLevel))) return;
      const result = writeKamasResearchMaximum(savePath, save);
      if (!result.changed) {
        console.log(tr(687, definition.maximumDisplayLevel));
      } else {
        console.log(tr(450));
        console.log(tr(451, result.maximumDisplayLevel));
        console.log(tr(416, result.backupPath));
      }
      return;
    }
    if (command === 'queen-spades' || command === 'queen-spades-extreme' || command === 'queen-spades-restore') {
      const status = getQueenOfSpadesStatus(savePath);
      const currentPercent = status.row.val0;
      const currentRatio = (currentPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
      console.log(tr(174, status.databasePath));
      console.log(tr(688, formatNumber(currentPercent), currentRatio, formatNumber(status.row.val1), formatNumber(status.row.val2)));

      let targetPercent;
      let modeDesc = '';

      if (command === 'queen-spades-restore') {
        targetPercent = QUEEN_OF_SPADES_BASE_ATTACK_PERCENT;
        modeDesc = tr(689, QUEEN_OF_SPADES_BASE_ATTACK_PERCENT);
      } else if (command === 'queen-spades-extreme') {
        targetPercent = QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT;
        modeDesc = tr(690, formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT));
      } else {
        const arg = parsed.args[1];
        if (!arg) {
          fail(tr(691));
        }
        if (arg.toLowerCase() === 'restore' || arg.toLowerCase() === 'default') {
          targetPercent = QUEEN_OF_SPADES_BASE_ATTACK_PERCENT;
          modeDesc = tr(689, QUEEN_OF_SPADES_BASE_ATTACK_PERCENT);
        } else if (arg.toLowerCase() === 'extreme') {
          targetPercent = QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT;
          modeDesc = tr(690, formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT));
        } else if (/[x배X]$/i.test(arg)) {
          const mult = Number(arg.replace(/[x배X]/gi, ''));
          targetPercent = parseQueenOfSpadesValue(mult, true);
          modeDesc = tr(681, mult, formatNumber(targetPercent));
        } else {
          const raw = Number(arg.replace(/[%]/g, ''));
          targetPercent = parseQueenOfSpadesValue(raw);
          const ratio = (targetPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
          modeDesc = tr(683, formatNumber(targetPercent), ratio);
        }
      }

      if (currentPercent === targetPercent) {
        console.log(tr(684, formatNumber(targetPercent)));
        return;
      }

      const ratio = (targetPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
      if (!parsed.yes && !await confirm(rl, tr(541, formatNumber(targetPercent), ratio))) return;

      const result = setQueenOfSpadesPercent(savePath, targetPercent);
      console.log(tr(548));
      console.log(tr(685, modeDesc));
      console.log(tr(543, formatNumber(currentPercent), formatNumber(result.row.val0), ratio));
      console.log(tr(402, result.backupPath));
      return;
    }
    if (command === 'wolf-rage' || command === 'wolf-rage-restore') {
      const status = getWolfRageStatus(savePath);
      const superPercent = status.superWolf.val0;
      const madPercent = status.madWolf.val0;
      console.log(tr(174, status.databasePath));
      console.log(tr(692, formatNumber(superPercent), formatNumber(madPercent)));

      if (command === 'wolf-rage-restore') {
        if (superPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P &&
            madPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P) {
          console.log(tr(693));
          return;
        }
        if (!parsed.yes && !await confirm(rl, tr(572))) return;
        const result = restoreWolfRageDefault(savePath);
        console.log(tr(573));
        console.log(tr(574, formatNumber(superPercent), formatNumber(result.superWolf.val0)));
        console.log(tr(575, formatNumber(madPercent), formatNumber(result.madWolf.val0)));
        console.log(tr(402, result.backupPath));
        return;
      }

      const arg = parsed.args[1];
      let targetPercent = WOLF_RAGE_TARGET_PERCENT;
      let modeDesc = tr(694, formatNumber(WOLF_RAGE_TARGET_PERCENT));

      if (arg) {
        if (arg.toLowerCase() === 'restore' || arg.toLowerCase() === 'default') {
          if (superPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P &&
              madPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P) {
            console.log(tr(693));
            return;
          }
          if (!parsed.yes && !await confirm(rl, tr(572))) return;
          const result = restoreWolfRageDefault(savePath);
          console.log(tr(573));
          console.log(tr(574, formatNumber(superPercent), formatNumber(result.superWolf.val0)));
          console.log(tr(575, formatNumber(madPercent), formatNumber(result.madWolf.val0)));
          console.log(tr(402, result.backupPath));
          return;
        }
        const raw = Number(arg.replace(/[%]/g, ''));
        if (!Number.isInteger(raw) || raw < 1 || raw > 50_000) {
          fail(tr(695));
        }
        targetPercent = raw;
        modeDesc = tr(696, formatNumber(targetPercent));
      }

      if (superPercent === targetPercent && madPercent === targetPercent) {
        console.log(tr(697, formatNumber(targetPercent)));
        return;
      }

      if (!parsed.yes && !await confirm(rl, tr(563, formatNumber(targetPercent)))) return;

      const result = setWolfRagePercent(savePath, targetPercent);
      console.log(tr(570));
      console.log(tr(685, modeDesc));
      console.log(tr(565, formatNumber(superPercent), formatNumber(result.superWolf.val0)));
      console.log(tr(566, formatNumber(madPercent), formatNumber(result.madWolf.val0)));
      console.log(tr(402, result.backupPath));
      return;
    }
    if (command === 'rich-family' || command === 'rich-family-restore') {
      const status = getRichFamilyStatus(savePath);
      const currentResource = status.resourcePercent;
      const currentDurability = status.durabilityPercent;
      console.log(tr(174, status.databasePath));
      console.log(tr(698, formatNumber(currentResource), currentDurability >= 100 ? tr(579) : `${currentDurability}%`));

      if (command === 'rich-family-restore') {
        if (status.isDefault) {
          console.log(tr(699));
          return;
        }
        if (!parsed.yes && !await confirm(rl, tr(603))) return;
        const result = restoreRichFamilyDefault(savePath);
        console.log(tr(604));
        console.log(tr(605, formatNumber(currentResource)));
        console.log(tr(606, currentDurability));
        console.log(tr(402, result.backupPath));
        return;
      }

      const arg1 = parsed.args[1];
      const arg2 = parsed.args[2];
      let targetResource = RICH_FAMILY_RECOMMENDED_RESOURCE; // 기본 500
      let targetDurability = RICH_FAMILY_INFINITE_DURABILITY; // 기본 100 (무한)
      let modeDesc = tr(700);

      if (arg1) {
        const lower1 = arg1.toLowerCase();
        if (lower1 === 'restore' || lower1 === 'default') {
          if (status.isDefault) {
            console.log(tr(699));
            return;
          }
          if (!parsed.yes && !await confirm(rl, tr(603))) return;
          const result = restoreRichFamilyDefault(savePath);
          console.log(tr(604));
          console.log(tr(605, formatNumber(currentResource)));
          console.log(tr(606, currentDurability));
          console.log(tr(402, result.backupPath));
          return;
        }
        if (lower1 === 'max' || lower1 === 'extreme') {
          targetResource = 1_000;
          targetDurability = RICH_FAMILY_INFINITE_DURABILITY;
          modeDesc = tr(701);
        } else if (lower1 === 'dur-only' || lower1 === 'durability') {
          targetResource = RICH_FAMILY_DEFAULT_RESOURCE;
          targetDurability = RICH_FAMILY_INFINITE_DURABILITY;
          modeDesc = tr(702);
        } else {
          const rawRes = Number(arg1.replace(/[%]/g, ''));
          if (!Number.isInteger(rawRes) || rawRes < 0 || rawRes > 50_000) {
            fail(tr(703));
          }
          targetResource = rawRes;

          if (arg2) {
            const rawDur = Number(arg2.replace(/[%]/g, ''));
            if (!Number.isInteger(rawDur) || rawDur < 0 || rawDur > 100) {
              fail(tr(704));
            }
            targetDurability = rawDur;
          } else {
            targetDurability = RICH_FAMILY_INFINITE_DURABILITY;
          }
          modeDesc = tr(705, formatNumber(targetResource), targetDurability, targetDurability >= 100 ? tr(601) : '');
        }
      }

      if (currentResource === targetResource && currentDurability === targetDurability) {
        console.log(tr(706, formatNumber(targetResource), targetDurability));
        return;
      }

      if (!parsed.yes && !await confirm(rl, tr(707, modeDesc))) return;

      const result = setRichFamilyValues(savePath, targetResource, targetDurability);
      console.log(tr(589));
      console.log(tr(685, modeDesc));
      console.log(tr(590, formatNumber(currentResource), formatNumber(result.resourcePercent)));
      console.log(tr(600, currentDurability, result.durabilityPercent, result.isInfiniteDurability ? tr(601) : ''));
      console.log(tr(402, result.backupPath));
      return;
    }
    if (command === 'naomi-detox' || command === 'detox' || command === 'naomi-detox-restore' || command === 'detox-restore') {
      const status = getNaomiDetoxStatus(savePath);
      const currentResource = status.resourcePercent;
      const currentDurability = status.durabilityPercent;
      console.log(tr(174, status.databasePath));
      console.log(tr(708, formatNumber(currentResource), currentDurability >= 100 ? tr(579) : currentDurability > 0 ? `${currentDurability}%` : tr(610)));

      if (command === 'naomi-detox-restore' || command === 'detox-restore') {
        if (status.isDefault) {
          console.log(tr(709));
          return;
        }
        if (!parsed.yes && !await confirm(rl, tr(629))) return;
        const result = restoreNaomiDetoxDefault(savePath);
        console.log(tr(630));
        console.log(tr(631, formatNumber(currentResource)));
        console.log(tr(632, currentDurability));
        console.log(tr(402, result.backupPath));
        return;
      }

      const arg1 = parsed.args[1];
      const arg2 = parsed.args[2];
      let targetResource = NAOMI_DETOX_RECOMMENDED_RESOURCE; // 기본 500
      let targetDurability = NAOMI_DETOX_INFINITE_DURABILITY; // 기본 100 (무한)
      let modeDesc = tr(710);

      if (arg1) {
        const lower1 = arg1.toLowerCase();
        if (lower1 === 'restore' || lower1 === 'default') {
          if (status.isDefault) {
            console.log(tr(709));
            return;
          }
          if (!parsed.yes && !await confirm(rl, tr(629))) return;
          const result = restoreNaomiDetoxDefault(savePath);
          console.log(tr(630));
          console.log(tr(631, formatNumber(currentResource)));
          console.log(tr(632, currentDurability));
          console.log(tr(402, result.backupPath));
          return;
        }
        if (lower1 === 'max' || lower1 === 'extreme') {
          targetResource = 1_000;
          targetDurability = NAOMI_DETOX_INFINITE_DURABILITY;
          modeDesc = tr(711);
        } else if (lower1 === 'farm' || lower1 === 'farming') {
          targetResource = 5_000;
          targetDurability = NAOMI_DETOX_INFINITE_DURABILITY;
          modeDesc = tr(712);
        } else if (lower1 === 'kc-only' || lower1 === 'no-dur') {
          targetResource = arg2 ? Number(arg2.replace(/[%]/g, '')) : NAOMI_DETOX_RECOMMENDED_RESOURCE;
          if (!Number.isInteger(targetResource) || targetResource < 0 || targetResource > 50_000) {
            fail(tr(713));
          }
          targetDurability = 0;
          modeDesc = tr(714, formatNumber(targetResource));
        } else {
          const rawRes = Number(arg1.replace(/[%]/g, ''));
          if (!Number.isInteger(rawRes) || rawRes < 0 || rawRes > 50_000) {
            fail(tr(715));
          }
          targetResource = rawRes;

          if (arg2) {
            const rawDur = Number(arg2.replace(/[%]/g, ''));
            if (!Number.isInteger(rawDur) || rawDur < 0 || rawDur > 100) {
              fail(tr(704));
            }
            targetDurability = rawDur;
          } else {
            targetDurability = NAOMI_DETOX_INFINITE_DURABILITY;
          }
          modeDesc = tr(716, formatNumber(targetResource), targetDurability, targetDurability >= 100 ? tr(601) : '');
        }
      }

      if (currentResource === targetResource && currentDurability === targetDurability) {
        console.log(tr(717, formatNumber(targetResource), targetDurability));
        return;
      }

      if (!parsed.yes && !await confirm(rl, tr(718, modeDesc))) return;

      const result = setNaomiDetoxValues(savePath, targetResource, targetDurability);
      console.log(tr(619));
      console.log(tr(685, modeDesc));
      console.log(tr(620, formatNumber(currentResource), formatNumber(result.resourcePercent)));
      console.log(tr(600, currentDurability, result.durabilityPercent, result.isInfiniteDurability ? tr(601) : ''));
      console.log(tr(402, result.backupPath));
      return;
    }
    if (command==='m2g-knife-compensate'||command==='m2g-knife-restore') {
      await manageM2gKnife(rl,savePath,command==='m2g-knife-restore',parsed.yes);
      return;
    }
    if (command === 'equipment-spirit-free' || command === 'equipment-spirit-restore') {
      await manageEquipmentSpirit(rl,savePath,command==='equipment-spirit-restore',parsed.yes,parsed.args[1] ? path.resolve(parsed.args[1]) : undefined);
      return;
    }
    if (['jackal-spawn-fast','jackal-spawn-restore','jackal-blueprints','jackal-blueprints-restore'].includes(command)) {
      await manageJackalOption(rl,savePath,command.startsWith('jackal-spawn-')?'spawn':'blueprints',command.endsWith('-restore'),parsed.yes,parsed.args[1]);
      return;
    }
    if (command === 'equipment-materials-free') {
      const status = getEquipmentMaterialStatus(savePath);
      console.log(tr(174, status.databasePath));
      console.log(tr(719, formatNumber(status.nonZeroRows), formatNumber(status.nonZeroCells)));
      if (!parsed.yes && !await confirm(rl, tr(635))) return;
      const result = setEquipmentMaterialsFree(savePath);
      if (!result.changed) {
        console.log(tr(720));
      } else {
        console.log(tr(637));
        console.log(tr(638, formatNumber(result.rowCount)));
        console.log(tr(639));
        console.log(tr(402, result.backupPath));
      }
      return;
    }
    if (command === 'equipment-materials-restore') {
      const backups = listEquipmentMaterialBackups();
      const backupPath = parsed.args[1] ? path.resolve(parsed.args[1]) : backups[0];
      if (!backupPath) fail(tr(721));
      const summary = summarizeEquipmentMaterialRows(readEquipmentMaterialRows(backupPath));
      console.log(tr(208, backupPath));
      console.log(tr(642, formatNumber(summary.nonZeroRows), formatNumber(summary.nonZeroCells)));
      if (!parsed.yes && !await confirm(rl, tr(643))) return;
      const result = restoreEquipmentMaterials(savePath, backupPath);
      console.log(tr(644));
      console.log(tr(645, formatNumber(result.nonZeroRows)));
      console.log(tr(409, result.safetyBackup));
      return;
    }
    if (command === 'max-facility') {
      printStatus(savePath, save);
      const facilityState = getFacilityState(save);
      console.log(tr(431, facilityState.safeLevel, facilityState.tankLevel));
      if (facilityState.isMaxed) {
        console.log(tr(722));
        return;
      }
      if (!parsed.yes && !await confirm(rl, tr(433))) return;
      const result = writeFacilityUpgradesMaximum(savePath, save);
      console.log(tr(434));
      console.log(tr(435, result.previousSafeLevel, result.currentSafeLevel, result.previousTankLevel, result.currentTankLevel));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'max-mastery') {
      printStatus(savePath, save);
      const masteryState = getWeaponMasteryState(save);
      console.log(tr(453, formatNumber(masteryState.maxLevelCount), formatNumber(masteryState.totalCount)));
      if (masteryState.isMaxed) {
        console.log(tr(723));
        return;
      }
      if (!parsed.yes && !await confirm(rl, tr(455, formatNumber(masteryState.totalCount)))) return;
      const result = writeWeaponMasteriesMaximum(savePath, save);
      console.log(tr(456));
      console.log(tr(457, formatNumber(result.upgradedCount)));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'max-equipment' || command === 'max-upgrades') {
      printStatus(savePath, save);
      const researchState = getEquipmentResearchState(save, savePath);
      console.log(tr(437, formatNumber(researchState.existingCount)));
      if (researchState.isMaxed) {
        console.log(tr(724));
        return;
      }
      if (!parsed.yes && !await confirm(rl, tr(439))) return;
      const result = writeEquipmentResearchMaximum(savePath, save);
      console.log(tr(440));
      console.log(tr(441, formatNumber(result.totalPartCount)));
      console.log(tr(442, formatNumber(result.totalEntries), formatNumber(result.addedCount)));
      console.log(tr(443));
      console.log(tr(416, result.backupPath));
      return;
    }
    if (command === 'restore') {
      const backups = listBackups(savePath);
      if (backups.length === 0) fail(tr(725));
      const backupPath = parsed.args[1] ? path.resolve(parsed.args[1]) : backups[0];
      const backupSave = readSave(backupPath);
      console.log(tr(208, backupPath));
      printResourceValues(backupSave, tr(651));
      if (!parsed.yes && !await confirm(rl, tr(652))) return;
      const result = restoreBackup(savePath, backupPath);
      console.log(tr(726));
      for (const [resourceKey, value] of Object.entries(result.restoredResources)) {
        console.log(`- ${RESOURCES[resourceKey].label}: ${formatNumber(value)}`);
      }
      console.log(tr(409, result.safetyBackup));
      return;
    }
    if (command === 'fighters' || command === 'fighter-status') {
      printStatus(savePath, save);
      const fighters = getFighterList(save);
      console.log(tr(727, fighters.length));
      fighters.forEach((f, idx) => {
        const s = f.stats;
        const fBase = getBaseSkillSlots(f.grade, f.type);
        const fTotal = getTotalSkillSlots(f.grade, f.type, s.skill);
        const fMaxAdd = getMaxAddableSkillSlots(f.grade, f.type);
        console.log(tr(728, idx + 1, f.name, f.typeName, f.grade, f.limitBreak, f.state));
        console.log(tr(729, s.lvl));
        console.log(tr(730, s.hp, s.hp_bonus || 0, s.str, s.str_bonus || 0, s.dex, s.dex_bonus || 0));
        console.log(tr(731, s.vit, s.vit_bonus || 0, s.stm, s.stm_bonus || 0, s.luk, s.luk_bonus || 0));
        console.log(tr(732, s.skill, fTotal, fBase, fBase + fMaxAdd, s.bag, s.rage));
      });
      return;
    }
    if (command === 'set-fighter-stat') {
      const targetArg = parsed.args[1];
      const statKeyArg = parsed.args[2]?.toLowerCase();
      const valArg = parsed.args[3];
      if (!targetArg || !statKeyArg) {
        fail(tr(733));
      }
      const fighters = getFighterList(save);
      let fIdx = -1;
      if (/^\d+$/.test(targetArg)) {
        fIdx = Number(targetArg) - 1;
      } else {
        fIdx = fighters.findIndex((f) => f.name.toLowerCase() === targetArg.toLowerCase());
      }
      if (fIdx < 0 || fIdx >= fighters.length) {
        fail(tr(734, targetArg, fighters.length));
      }

      const targetFighter = fighters[fIdx];
      const targetLimits = require('./fighter-db-limits').readFighterLimits(getMasterDatabasePath(savePath), targetFighter);
      const targetBase = getBaseSkillSlots(targetFighter.grade, targetFighter.type);
      const targetMaxSkill = targetLimits.extraMaxima.skill;
      const targetTotal = targetBase + targetMaxSkill;
      let updates = {};
      let modeDesc = '';

      if (['legit', 'max-legit'].includes(statKeyArg)) {
        updates = require('./fighter-db-limits').buildFighterMaximum(getMasterDatabasePath(savePath), targetFighter, true);
        modeDesc = tr(735, Object.entries(updates).map(([k,v]) => `${k}=${v}`).join(' / '));
      } else if (['db', 'max-db'].includes(statKeyArg)) {
        updates = require('./fighter-db-limits').buildFighterMaximum(getMasterDatabasePath(savePath), targetFighter);
        modeDesc = tr(736, Object.entries(updates).map(([key, value]) => `${key.toUpperCase()} ${value}`).join(' / '));
      } else if (['max-bonus', 'bonus-max'].includes(statKeyArg)) {
        updates = Object.fromEntries(FIGHTER_BONUS_KEYS.map(key => [key, targetLimits.bonusMax]));
        modeDesc = tr(737, targetLimits.bonusMax);
      } else if (statKeyArg === 'bonus') {
        if (valArg === undefined) fail(tr(738, targetLimits.bonusValues.join(', ')));
        const val = Number(valArg);
        if (!targetLimits.bonusValues.includes(val)) fail(tr(738, targetLimits.bonusValues.join(', ')));
        updates = { hp_bonus: val, str_bonus: val, dex_bonus: val, vit_bonus: val, stm_bonus: val, luk_bonus: val };
        modeDesc = tr(739, val);
      } else if (['max-slots', 'slots-max'].includes(statKeyArg)) {
        updates = { skill: targetMaxSkill, bag: targetLimits.extraMaxima.bag };
        modeDesc = tr(740, targetMaxSkill, targetTotal);
      } else if (['expand-slots', 'slots-expand'].includes(statKeyArg)) {
        updates = { skill: targetMaxSkill, bag: targetLimits.extraMaxima.bag };
        modeDesc = tr(741, targetTotal, updates.bag);
      } else if (statKeyArg === 'all') {
        if (valArg === undefined) fail(tr(742));
        const val = Number(valArg);
        if (!Number.isInteger(val) || val < 1 || val > 50) fail(tr(743));
        updates = { hp: val, str: val, dex: val, vit: val, stm: val, luk: val };
        modeDesc = tr(744, val);
      } else {
        if (valArg === undefined) fail(tr(745, statKeyArg));
        const val = Number(valArg);
        if (!Number.isInteger(val) || val < 0) {
          fail(tr(746));
        }

        const allowedKeys = {
          hp: { min: 1, legitMax: 45, max: 50 },
          str: { min: 1, legitMax: 45, max: 50 },
          dex: { min: 1, legitMax: 45, max: 50 },
          vit: { min: 1, legitMax: 45, max: 50 },
          stm: { min: 1, legitMax: 45, max: 50 },
          luk: { min: 1, legitMax: 45, max: 50 },
          skill: { min: 0, legitMax: targetMaxSkill, max: targetMaxSkill },
          bag: { min: 0, legitMax: 45, max: 50 },
          rage: { min: 0, legitMax: 5, max: 5 },
          hp_bonus: { min: 0, legitMax: 5, max: 5 },
          str_bonus: { min: 0, legitMax: 5, max: 5 },
          dex_bonus: { min: 0, legitMax: 5, max: 5 },
          vit_bonus: { min: 0, legitMax: 5, max: 5 },
          stm_bonus: { min: 0, legitMax: 5, max: 5 },
          luk_bonus: { min: 0, legitMax: 5, max: 5 },
        };
        const meta = allowedKeys[statKeyArg];
        if (!meta) {
          fail(tr(747, statKeyArg));
        }
        meta.max = statKeyArg.endsWith('_bonus') ? targetLimits.bonusMax : (targetLimits.extraMaxima[statKeyArg] ?? targetLimits.maxima[statKeyArg]);
        meta.legitMax = Math.min(meta.legitMax, meta.max);
        if (val < meta.min || val > meta.max) {
          fail(tr(748, statKeyArg.toUpperCase(), meta.min, meta.max, meta.legitMax));
        }
        updates = { [statKeyArg]: val };
        modeDesc = `${statKeyArg.toUpperCase()} ${val}`;
      }

      console.log(tr(749, fIdx + 1, targetFighter.name, targetFighter.typeName, modeDesc));
      console.log(tr(750), updates);
      if (!await promptFighterWarningIfNeeded(rl, updates, savePath, parsed.yes, targetFighter)) return;
      if (!parsed.yes && !await confirm(rl, tr(751))) return;
      const result = writeFighterStats(savePath, save, fIdx, updates);
      printFighterChangeSummary(result, modeDesc);
      return;
    }
    if (command === 'expand-fighter-limits') {
      const status = getFighterLimitStatus(savePath);
      console.log(tr(174, status.databasePath));
      console.log(tr(389, status.statMaxLevel, status.expMaxLevel));
      if (status.statMaxLevel >= 50 && status.expMaxLevel >= 500 && status.skillSlotsCount === 9) {
        console.log(tr(752));
        return;
      }
      console.log('\n' + '='.repeat(72));
      console.log(tr(391));
      console.log('-'.repeat(72));
      console.log(tr(392));
      console.log(tr(393));
      console.log(tr(394));
      console.log(tr(395));
      console.log(tr(396));
      console.log('='.repeat(72));
      if (!parsed.yes && !await confirm(rl, tr(397))) return;
      const result = expandFighterLimits(savePath, 50, 500);
      console.log(tr(399));
      console.log(tr(400, status.statMaxLevel, result.statMaxLevel, result.addedStatusRows));
      console.log(tr(401, status.expMaxLevel, result.expMaxLevel, result.addedExpRows));
      console.log(tr(402, result.backupPath));
      return;
    }
    if (command === 'restore-fighter-limits') {
      const backups = listFighterLimitBackups();
      if (backups.length === 0) fail(tr(753));
      const sourceBackup = parsed.args[1] ? path.resolve(parsed.args[1]) : backups[0];
      console.log(tr(405, sourceBackup));
      if (!parsed.yes && !await confirm(rl, tr(406))) return;
      const result = restoreFighterLimits(savePath, sourceBackup);
      console.log(tr(407));
      console.log(tr(408, result.statMaxLevel, result.expMaxLevel));
      console.log(tr(409, result.safetyBackup));
      return;
    }

    fail(tr(754));
  } finally {
    if (rl) rl.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const logFile = writeErrorLog(error, {
      mode: 'cli',
      argv: process.argv,
    });
    console.error(tr(655, error.message));
    if (logFile) console.error(tr(656, logFile));
    if (!error.userFacing && process.env.LID_KC_DEBUG === '1') console.error(error.stack);
    process.exitCode = 1;
  });
}

module.exports = {
  configureMasterDatabase,
  discoverSaves,
  findGameInstallDirectories,
  findMasterDatabasePath,
  findSteamRoots,
  getAllEquipmentResearchDefinitions,
  getEquipmentResearchState,
  getFacilityState,
  getMasterDatabasePath,
  getWeaponMasteryDefinitions,
  getWeaponMasteryState,
  logDirectory,
  readSave,
  replaceEquipmentResearchMaximum,
  replaceFacilityUpgradesMaximum,
  replaceWeaponMasteriesMaximum,
  resolveMasterDatabaseInput,
  resolveManualSaveInput,
  restoreCollisionMushroomDefault,
  restoreQueenOfSpades,
  restoreUltimateFighterReturn,
  restoreWolfRageDefault,
  setCollisionMushroomThirtyMinutes,
  setMasterDatabaseOverride,
  setQueenOfSpadesExtremeDamage,
  setQueenOfSpadesPercent,
  parseQueenOfSpadesValue,
  setUltimateFighterReturnFiveTimes,
  setUltimateFighterReturnPercent,
  setWolfRagePercent,
  getWolfRageStatus,
  WOLF_RAGE_DECAL_IDS,
  WOLF_RAGE_DEFAULT_VALUES,
  WOLF_RAGE_TARGET_PERCENT,
  getRichFamilyStatus,
  setRichFamilyValues,
  restoreRichFamilyDefault,
  RICH_FAMILY_DECAL_ID,
  RICH_FAMILY_DEFAULT_RESOURCE,
  RICH_FAMILY_DEFAULT_DURABILITY,
  RICH_FAMILY_RECOMMENDED_RESOURCE,
  RICH_FAMILY_INFINITE_DURABILITY,
  getNaomiDetoxStatus,
  setNaomiDetoxValues,
  restoreNaomiDetoxDefault,
  NAOMI_DETOX_DECAL_ID,
  NAOMI_DETOX_DEFAULT_RESOURCE,
  NAOMI_DETOX_DEFAULT_DURABILITY,
  NAOMI_DETOX_RECOMMENDED_RESOURCE,
  NAOMI_DETOX_INFINITE_DURABILITY,
  calculateFighterTotalLevel,
  getBaseSkillSlots,
  getMaxAddableSkillSlots,
  getTotalSkillSlots,
  FIGHTER_TYPES,
  getFighterList,
  replaceFighterStats,
  writeEquipmentResearchMaximum,
  writeErrorLog,
  writeFacilityUpgradesMaximum,
  writeFighterStats,
  writeWeaponMasteriesMaximum,
  expandFighterLimits,
  setFighterBagExpansion,
  setEquipmentSpiritFree,
  restoreEquipmentSpirit,
  restoreFighterLimits,
  getFighterLimitStatus,
};
