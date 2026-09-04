#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const childProcess = require('child_process');
const readline = require('readline/promises');

const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split('.').map(Number);
if (NODE_MAJOR < 22 || (NODE_MAJOR === 22 && NODE_MINOR < 5)) {
  console.error('오류: 이 도구는 Node.js 22.5 이상이 필요합니다.');
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
const QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT = 1_000; // 32비트 정수 연산 오버플로 방지 안전 극대치 (+1,000% = 11배 대미지)
const WOLF_RAGE_DECAL_IDS = ['SKL_RGSPDUP_02_P', 'SKL_RGSPUP_RDURDOWN_01_P'];
const WOLF_RAGE_DEFAULT_VALUES = {
  SKL_RGSPDUP_02_P: 80,
  SKL_RGSPUP_RDURDOWN_01_P: 120,
};
const WOLF_RAGE_TARGET_PERCENT = 1_000; // 레이지 축적 속도 +1,000% (오버플로/단타 즉사 시에도 1타당 게이지 즉시 충전)
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
    label: '킬코인',
    field: 'free_money',
    levelField: 'safe_level',
  },
  splithium: {
    label: '스피리튬',
    field: 'spirit',
    levelField: 'spirit_tank_level',
  },
  bloodnium: {
    label: '블러드늄',
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
  if (!key) fail('자원은 killcoins(kc), splithium(sp), bloodnium 중 하나여야 합니다.');
  return key;
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
    fail('지원하지 않는 세이브입니다: BRG 헤더가 없습니다.');
  }

  const version = packed.readUInt32LE(4);
  if (version !== FORMAT_VERSION) {
    fail(`지원하지 않는 세이브 버전입니다: ${version} (지원 버전: ${FORMAT_VERSION})`);
  }
  if (!packed.subarray(12, 16).equals(FORMAT_CODEC)) {
    fail('지원하지 않는 압축 형식입니다: ZLIB 세이브가 아닙니다.');
  }

  const declaredSize = packed.readUInt32LE(8);
  const parts = [];
  let offset = 16;
  let decodedSize = 0;

  while (decodedSize < declaredSize) {
    if (offset + 8 > packed.length) {
      fail('세이브 블록 헤더가 잘려 있습니다.');
    }
    const unpackedSize = packed.readUInt32LE(offset);
    const compressedSize = packed.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + compressedSize;
    if (compressedSize === 0 || end > packed.length) {
      fail('세이브 압축 블록 크기가 올바르지 않습니다.');
    }

    let part;
    try {
      part = zlib.inflateSync(packed.subarray(start, end));
    } catch (error) {
      fail(`세이브 압축을 풀 수 없습니다: ${error.message}`);
    }
    if (part.length !== unpackedSize) {
      fail('세이브 압축 블록의 크기 검증에 실패했습니다.');
    }
    parts.push(part);
    decodedSize += part.length;
    offset = end;
  }

  if (decodedSize !== declaredSize) {
    fail('세이브 전체 크기 검증에 실패했습니다.');
  }

  const trailer = packed.subarray(offset);
  if (trailer.length !== 4 || !trailer.equals(Buffer.alloc(4))) {
    fail('알 수 없는 세이브 꼬리 데이터가 있어 안전하게 중단했습니다.');
  }

  const jsonBuffer = Buffer.concat(parts);
  const jsonText = jsonBuffer.toString('utf8');
  if (!Buffer.from(jsonText, 'utf8').equals(jsonBuffer)) {
    fail('세이브 JSON이 올바른 UTF-8 데이터가 아닙니다.');
  }

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (error) {
    fail(`세이브 JSON을 읽을 수 없습니다: ${error.message}`);
  }
  if (!data.soul) {
    fail('자원 데이터(soul)를 찾지 못했습니다.');
  }
  for (const resource of Object.values(RESOURCES)) {
    if (!Number.isSafeInteger(data.soul[resource.field])) {
      fail(`${resource.label} 필드(soul.${resource.field})를 찾지 못했습니다.`);
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
  if (text[start] !== '"') fail('세이브 JSON 문자열 구조가 올바르지 않습니다.');
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
  fail('세이브 JSON 문자열이 닫히지 않았습니다.');
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
      if (stack.pop() !== expected) fail('세이브 JSON 괄호 구조가 올바르지 않습니다.');
      if (stack.length === 0) return offset + 1;
    }
  }
  fail('세이브 JSON 값이 닫히지 않았습니다.');
}

function findObjectProperty(text, objectStart, propertyName) {
  let offset = skipWhitespace(text, objectStart);
  if (text[offset] !== '{') fail('세이브 JSON 객체 구조가 올바르지 않습니다.');
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
      fail('세이브 JSON 속성 이름을 읽을 수 없습니다.');
    }
    offset = skipWhitespace(text, keyEnd);
    if (text[offset] !== ':') fail('세이브 JSON 속성 구분자가 없습니다.');
    const valueStart = skipWhitespace(text, offset + 1);
    const valueEnd = findJsonValueEnd(text, valueStart);
    if (key === propertyName) return { valueStart, valueEnd };
    offset = skipWhitespace(text, valueEnd);
    if (text[offset] === ',') {
      offset += 1;
    } else if (text[offset] !== '}') {
      fail('세이브 JSON 객체 구분자가 올바르지 않습니다.');
    }
  }
  fail(`세이브 JSON에서 ${propertyName} 속성을 찾지 못했습니다.`);
}

function replaceResource(save, resourceKey, amount) {
  const resource = RESOURCES[resourceKey];
  const soul = findObjectProperty(save.jsonText, 0, 'soul');
  const field = findObjectProperty(save.jsonText, soul.valueStart, resource.field);
  const rawValue = save.jsonText.slice(field.valueStart, field.valueEnd);
  if (!/^-?\d+$/.test(rawValue)) {
    fail(`${resource.label} 원문 값이 정수가 아닙니다.`);
  }
  const current = Number(rawValue);
  if (current !== save.data.soul[resource.field]) {
    fail(`${resource.label} 값 교차 검증에 실패했습니다.`);
  }

  const changedText = save.jsonText.slice(0, field.valueStart) +
    String(amount) + save.jsonText.slice(field.valueEnd);

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(`수정된 세이브 JSON 검증에 실패했습니다: ${error.message}`);
  }
  if (changedData.soul[resource.field] !== amount) {
    fail(`수정된 ${resource.label} 값 검증에 실패했습니다.`);
  }

  // The output is constructed from the original text plus one numeric token.
  // This guarantees no other JSON field is serialized or normalized.
  return changedText;
}

function parseGoodsIds(value, fieldName) {
  if (typeof value !== 'string') {
    fail(`세이브의 ${fieldName} 값이 문자열이 아닙니다.`);
  }
  if (value === '') return [];
  const ids = value.split(',');
  if (ids.some((id) => !/^\d+$/.test(id))) {
    fail(`세이브의 ${fieldName} 상품 ID 형식이 올바르지 않습니다.`);
  }
  if (new Set(ids).size !== ids.length) {
    fail(`세이브의 ${fieldName}에 중복 상품 ID가 있습니다.`);
  }
  return ids;
}

function getBloodniumShopState(save) {
  if (!save.data.user || typeof save.data.user !== 'object') {
    fail('세이브에서 상점 데이터(user)를 찾지 못했습니다.');
  }
  const available = parseGoodsIds(
    save.data.user[BLOODNIUM_SHOP_AVAILABLE_FIELD],
    BLOODNIUM_SHOP_AVAILABLE_FIELD,
  );
  const bought = parseGoodsIds(
    save.data.user[BLOODNIUM_SHOP_BOUGHT_FIELD],
    BLOODNIUM_SHOP_BOUGHT_FIELD,
  );
  const duplicate = available.find((id) => bought.includes(id));
  if (duplicate) fail(`블러드늄 상점 상품 ${duplicate}이 두 목록에 중복되어 있습니다.`);
  return { available, bought };
}

function replaceObjectStringProperty(jsonText, objectName, propertyName, expectedValue, newValue) {
  const object = findObjectProperty(jsonText, 0, objectName);
  const field = findObjectProperty(jsonText, object.valueStart, propertyName);
  const rawValue = jsonText.slice(field.valueStart, field.valueEnd);
  let currentValue;
  try {
    currentValue = JSON.parse(rawValue);
  } catch {
    fail(`세이브의 ${propertyName} 문자열을 읽지 못했습니다.`);
  }
  if (currentValue !== expectedValue) {
    fail(`세이브의 ${propertyName} 값 교차 검증에 실패했습니다.`);
  }
  return jsonText.slice(0, field.valueStart) +
    JSON.stringify(newValue) + jsonText.slice(field.valueEnd);
}

function replaceBloodniumShopHistory(save) {
  const state = getBloodniumShopState(save);
  const restored = [...state.available, ...state.bought];
  let changedText = replaceObjectStringProperty(
    save.jsonText,
    'user',
    BLOODNIUM_SHOP_AVAILABLE_FIELD,
    state.available.join(','),
    restored.join(','),
  );
  changedText = replaceObjectStringProperty(
    changedText,
    'user',
    BLOODNIUM_SHOP_BOUGHT_FIELD,
    state.bought.join(','),
    '',
  );

  let changedData;
  try {
    changedData = JSON.parse(changedText);
  } catch (error) {
    fail(`수정된 세이브 JSON 검증에 실패했습니다: ${error.message}`);
  }
  if (changedData.user[BLOODNIUM_SHOP_AVAILABLE_FIELD] !== restored.join(',') ||
      changedData.user[BLOODNIUM_SHOP_BOUGHT_FIELD] !== '') {
    fail('수정된 블러드늄 상점 목록 검증에 실패했습니다.');
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
    fail('세이브에서 데칼 뽑기 이력을 찾지 못했습니다.');
  }
  return history;
}

function getDecalStock(save) {
  const stock = save.data?.soul?.skl?.psskl;
  if (!Array.isArray(stock)) fail('세이브에서 데칼 소유 목록을 찾지 못했습니다.');
  const ids = new Set();
  for (const entry of stock) {
    if (!entry || typeof entry !== 'object' || typeof entry.sklid !== 'string' ||
        !Number.isSafeInteger(entry.cnt) || entry.cnt < 0 ||
        !Number.isSafeInteger(entry.updated) || ![0, 1].includes(entry.is_checked)) {
      fail('데칼 소유 목록의 항목 형식이 올바르지 않습니다.');
    }
    if (ids.has(entry.sklid)) fail(`데칼 소유 목록에 ${entry.sklid}가 중복되어 있습니다.`);
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
    fail('Steam용 전체 데칼 목록 검증에 실패했습니다.');
  }
  if (LEGACY_FIVE_STAR_DECAL_IDS.length !== 41 ||
      new Set(LEGACY_FIVE_STAR_DECAL_IDS).size !== 41) {
    fail('이전 ★5 데칼 지급 이력 정리 목록 검증에 실패했습니다.');
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
    fail('세이브의 데칼 소유 목록을 읽지 못했습니다.');
  }
  if (JSON.stringify(rawStock) !== JSON.stringify(stock)) {
    fail('데칼 소유 목록 교차 검증에 실패했습니다.');
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
    fail(`수정된 세이브 JSON 검증에 실패했습니다: ${error.message}`);
  }
  const verifiedHistory = changedData?.soul?.skl?.gacha?.normal?.sklids;
  const verifiedStock = changedData?.soul?.skl?.psskl;
  const historyMatches = Array.isArray(verifiedHistory)
    ? verifiedHistory.length === cleanedHistory.length
    : (typeof verifiedHistory === 'object' && Object.keys(verifiedHistory).length === 0 && cleanedHistory.length === 0);
  if (!historyMatches ||
      !Array.isArray(verifiedStock) || verifiedStock.length !== changedStock.length) {
    fail('수정된 전체 데칼 데이터 검증에 실패했습니다.');
  }
  const previousCounts = new Map(stock.map((entry) => [entry.sklid, entry.cnt]));
  const verifiedCounts = new Map(verifiedStock.map((entry) => [entry.sklid, entry.cnt]));
  for (const id of decalIds) {
    if (verifiedCounts.get(id) !== (previousCounts.get(id) ?? 0) + 1) {
      fail(`수정된 데칼 ${id} 수량 검증에 실패했습니다.`);
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
  if (!Array.isArray(stock)) fail('세이브에서 동물 소유 목록을 찾지 못했습니다.');
  for (const entry of stock) {
    if (!entry || typeof entry !== 'object' || typeof entry.eid !== 'string' || !entry.eid ||
        typeof entry.owner !== 'string' || typeof entry.bstid !== 'string' ||
        typeof entry.rwdemsrid !== 'string') {
      fail('동물 소유 목록의 항목 형식이 올바르지 않습니다.');
    }
  }
  return stock;
}

function getMushroomStock(save) {
  const stock = save.data?.mushroom?.msrs;
  if (!Array.isArray(stock)) fail('세이브에서 버섯 소유 목록을 찾지 못했습니다.');
  for (const entry of stock) {
    if (!entry || typeof entry !== 'object' || typeof entry.eid !== 'string' || !entry.eid ||
        typeof entry.owner !== 'string' || typeof entry.msrid !== 'string') {
      fail('버섯 소유 목록의 항목 형식이 올바르지 않습니다.');
    }
  }
  return stock;
}

function getCoinLockerSlots(save) {
  const slots = save.data?.soul?.cl;
  if (!Array.isArray(slots)) fail('세이브에서 코인 보관함 슬롯 목록을 찾지 못했습니다.');
  const slotNumbers = new Set();
  for (const entry of slots) {
    if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.slot) || entry.slot < 0 ||
        !Number.isSafeInteger(entry.type) || typeof entry.eid !== 'string') {
      fail('코인 보관함 슬롯 항목의 형식이 올바르지 않습니다.');
    }
    if (slotNumbers.has(entry.slot)) fail(`코인 보관함 슬롯 ${entry.slot}이 중복되어 있습니다.`);
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
    fail(`${label} 목록 검증에 실패했습니다.`);
  }
  const research = save.data?.soul?.partresearch?.user;
  if (!Array.isArray(research)) {
    fail('세이브에서 장비 연구 목록을 찾지 못했습니다.');
  }

  const targetIds = new Set(recipeIds);
  const levelsById = new Map(recipeIds.map((id) => [id, new Set()]));
  for (const entry of research) {
    if (!targetIds.has(entry?.ptid)) continue;
    // Existing saves use additional state flag values depending on how and
    // when a recipe was obtained. Ownership only depends on ptid + lvl, and
    // every existing object is preserved byte-for-byte by the mutation.
    if (!Number.isSafeInteger(entry.lvl) || entry.lvl < 1) {
      fail(`${label} ${entry.ptid} 연구 레벨의 형식이 예상과 다릅니다.`);
    }
    const levels = levelsById.get(entry.ptid);
    if (levels.has(entry.lvl)) {
      fail(`${label} ${entry.ptid}의 연구 레벨 ${entry.lvl}이 중복돼 있습니다.`);
    }
    levels.add(entry.lvl);
  }

  const ownedIds = [];
  const missingIds = [];
  for (const id of recipeIds) {
    const levels = levelsById.get(id);
    if (levels.size > 0 && !levels.has(1)) {
      fail(`${label} ${id}의 최초 연구 레벨이 누락돼 있어 안전하게 중단했습니다.`);
    }
    (levels.has(1) ? ownedIds : missingIds).push(id);
  }
  return { research, ownedIds, missingIds };
}

function getLimitedRecipeState(save) {
  if (LIMITED_RECIPE_IDS.length !== LIMITED_RECIPE_DEFINITION_COUNT) {
    fail('내장된 기간 한정 레시피 수가 예상과 다릅니다.');
  }
  return getRecipeUnlockState(save, LIMITED_RECIPE_IDS, '기간 한정 레시피');
}

function replaceRecipeUnlocks(save, definitions, label) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    fail(`${label} 마스터 정의가 예상과 다릅니다.`);
  }
  const definitionIds = definitions.map((entry) => entry.id);
  if (new Set(definitionIds).size !== definitionIds.length ||
      definitionIds.some((id) => typeof id !== 'string' || !id)) {
    fail(`${label} 마스터 정의 ID가 예상과 다릅니다.`);
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
    fail('세이브의 장비 연구 목록을 읽지 못했습니다.');
  }
  if (JSON.stringify(rawResearch) !== JSON.stringify(state.research)) {
    fail('장비 연구 목록 교차 검증에 실패했습니다.');
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
    fail(`수정된 ${label} 데이터를 읽을 수 없습니다: ${error.message}`);
  }
  const verifiedState = getRecipeUnlockState({ data: changedData }, definitionIds, label);
  if (verifiedState.missingIds.length !== 0 ||
      verifiedState.research.length !== state.research.length + state.missingIds.length ||
      JSON.stringify(verifiedState.research.slice(0, state.research.length)) !==
        JSON.stringify(state.research)) {
    fail(`수정된 ${label} 데이터 검증에 실패했습니다.`);
  }
  for (let index = 0; index < state.missingIds.length; index += 1) {
    const entry = verifiedState.research[state.research.length + index];
    if (entry.ptid !== state.missingIds[index] || entry.lvl !== 1 ||
        entry.research_type !== 'MAP' || entry.receive_type !== 'UNKNOWN' ||
        entry.is_announced !== 0 || entry.is_checked !== 1 ||
        entry.before_ptid !== '' || entry.before_lvl !== 0) {
      fail(`수정된 ${label} ${state.missingIds[index]} 검증에 실패했습니다.`);
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
    fail('기간 한정 레시피 마스터 정의 순서가 예상과 다릅니다.');
  }
  return replaceRecipeUnlocks(save, definitions, '기간 한정 레시피');
}

function replaceAllRecipes(save, definitions) {
  if (!Array.isArray(definitions) || definitions.length !== ALL_RECIPE_DEFINITION_COUNT) {
    fail('Steam용 전체 레시피 마스터 정의가 예상과 다릅니다.');
  }
  return replaceRecipeUnlocks(save, definitions, 'Steam용 전체 레시피');
}

function replaceGoldenBeasts(save, definitions, countPerBeast = 1) {
  const count = Number(countPerBeast);
  if (!Number.isInteger(count) || count < 1) {
    fail('황금동물 지급 수량은 1 이상의 정수여야 합니다.');
  }
  if (GOLDEN_BEAST_IDS.length !== 11 || new Set(GOLDEN_BEAST_IDS).size !== 11) {
    fail('내장된 황금동물 목록 검증에 실패했습니다.');
  }
  if (!Array.isArray(definitions) || definitions.length !== GOLDEN_BEAST_IDS.length) {
    fail('황금동물 마스터 정의가 예상과 다릅니다.');
  }

  const definitionById = new Map(definitions.map((entry) => [entry.id, entry]));
  for (const id of GOLDEN_BEAST_IDS) {
    const definition = definitionById.get(id);
    if (!definition || typeof definition.rwdmsrid !== 'string' || !definition.rwdmsrid) {
      fail(`황금동물 ${id}의 보상 버섯 정의가 올바르지 않습니다.`);
    }
  }

  const beasts = getBeastStock(save);
  const mushrooms = getMushroomStock(save);
  const slots = getCoinLockerSlots(save);
  const emptySlots = slots.filter((entry) => entry.type === -1 && entry.eid === '');
  const totalRequired = GOLDEN_BEAST_IDS.length * count;
  if (emptySlots.length < totalRequired) {
    fail(`코인 보관함의 빈칸이 ${emptySlots.length}개뿐입니다. 황금동물 11종 x ${count}마리(총 ${totalRequired}마리) 지급에는 ${totalRequired}칸이 필요합니다.`);
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
    fail(`수정된 세이브 JSON 검증에 실패했습니다: ${error.message}`);
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
      fail(`수정된 황금동물 ${grant.beastId} 데이터 검증에 실패했습니다.`);
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
    fail('세이브에서 장비 연구 목록을 찾지 못했습니다.');
  }
  const entries = research.filter((entry) => entry?.ptid === KAMAS_RE_FINAL_PART_ID);
  if (entries.length === 0) {
    fail('KAMAS-A1 어설트 라이플 RE 최종 티어(4티어) 연구 데이터가 없습니다. 인게임에서 KAMAS-A1 RE 설계도를 구매하고 4티어 연구를 시작한 세이브에서만 강화할 수 있습니다.');
  }

  const byLevel = new Map();
  for (const entry of entries) {
    if (!Number.isInteger(entry.lvl) || entry.lvl < 1 || entry.lvl > maximumInternalLevel ||
        typeof entry.research_type !== 'string' || typeof entry.receive_type !== 'string' ||
        ![0, 1].includes(entry.is_announced) || ![0, 1].includes(entry.is_checked) ||
        typeof entry.before_ptid !== 'string' || !Number.isInteger(entry.before_lvl)) {
      fail('KAMAS RE 연구 항목의 형식이 예상과 달라 중단했습니다.');
    }
    if (byLevel.has(entry.lvl)) {
      fail(`KAMAS RE 내부 연구 레벨 ${entry.lvl}이 중복됩니다.`);
    }
    byLevel.set(entry.lvl, entry);
  }

  const currentInternalLevel = Math.max(...byLevel.keys());
  for (let level = 1; level <= currentInternalLevel; level += 1) {
    if (!byLevel.has(level)) fail(`KAMAS RE 내부 연구 레벨 ${level}이 누락돼 있습니다.`);
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
    fail('KAMAS RE 연구 목록 교차 검증에 실패했습니다.');
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
    fail(`수정된 KAMAS RE 연구 데이터를 읽을 수 없습니다: ${error.message}`);
  }
  const verified = getKamasResearchState(
    { data: changedData },
    maximumInternalLevel,
    limitBreakStart,
  );
  if (!verified.isMaxed) fail('수정된 KAMAS RE 최대 강화 검증에 실패했습니다.');

  return { changedText, state, verified, addedLevels };
}

function getFacilityState(save) {
  const soul = save.data?.soul;
  if (!soul || typeof soul !== 'object') {
    fail('세이브에서 시설 데이터(soul)를 찾지 못했습니다.');
  }
  const safeLevel = soul.safe_level;
  const tankLevel = soul.spirit_tank_level;
  if (!Number.isInteger(safeLevel) || safeLevel < 1 ||
      !Number.isInteger(tankLevel) || tankLevel < 1) {
    fail('세이브 시설 레벨 형식이 올바르지 않습니다.');
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
    fail(`수정된 시설 레벨 JSON 검증에 실패했습니다: ${error.message}`);
  }
  if (changedData.soul.safe_level !== 99 || changedData.soul.spirit_tank_level !== 99) {
    fail('수정된 시설 레벨 검증에 실패했습니다.');
  }

  return { changedText, state, changed: true };
}

function writeFacilityUpgradesMaximum(savePath, save) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
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
    fail('이전 시설 업그레이드 수정 작업의 임시 파일이 남아 있습니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getFacilityState(check);
    if (!checkState.isMaxed) {
      fail('임시 세이브의 시설 레벨 검증에 실패했습니다.');
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
      fail('마스터 DB에서 무기 숙련도 정의를 찾지 못했습니다.');
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
    fail('세이브에서 무기 숙련도 목록(expert)을 찾지 못했습니다.');
  }
  for (const entry of expert) {
    if (!entry || typeof entry !== 'object' || typeof entry.ptarmtp !== 'string' ||
        !Number.isInteger(entry.lvl) || !Number.isInteger(entry.abp)) {
      fail('무기 숙련도 항목의 형식이 올바르지 않습니다.');
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
    fail(`수정된 무기 숙련도 JSON 검증에 실패했습니다: ${error.message}`);
  }
  const verified = getWeaponMasteryState({ data: changedData });
  if (!verified.isMaxed) {
    fail('수정된 무기 숙련도 최대 레벨 검증에 실패했습니다.');
  }

  const upgradedCount = state.expert.filter((entry, i) => entry.lvl < changedExpert[i].lvl).length;
  return { changedText, state, verified, upgradedCount };
}

function writeWeaponMasteriesMaximum(savePath, save) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
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
    fail('이전 무기 숙련도 수정 작업의 임시 파일이 남아 있습니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getWeaponMasteryState(check);
    if (!checkState.isMaxed) {
      fail('임시 세이브의 무기 숙련도 최대 레벨 검증에 실패했습니다.');
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
    fail('세이브에서 장비 연구 목록(partresearch.user)을 찾지 못했습니다.');
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
    fail(`수정된 장비 연구 JSON 검증에 실패했습니다: ${error.message}`);
  }

  const verifiedState = getEquipmentResearchState({ data: changedData, jsonText: changedText }, savePath);
  if (!verifiedState.isMaxed) {
    fail('수정된 장비 연구 최대치 검증에 실패했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
  }

  const mutation = replaceEquipmentResearchMaximum(save, savePath);

  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.equipment-max-edit.tmp`;
  const rollbackPath = `${savePath}.equipment-max-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail('이전 장비 연구 최대화 수정 작업의 임시 파일이 남아 있습니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getEquipmentResearchState(check, savePath);
    if (!checkState.isMaxed) {
      fail('임시 세이브의 장비 연구 최대치 검증에 실패했습니다.');
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
  BAL: '올라운더',
  BRE: '스트라이커',
  DEF: '디펜더',
  TEC: '어태커',
  SHT: '슈터',
  COL: '콜렉터',
  SKI: '스킬 마스터',
  LUK: '럭키 스타',
};

const FIGHTER_STAT_KEYS = ['hp', 'str', 'dex', 'vit', 'stm', 'luk'];
const FIGHTER_EXTRA_KEYS = ['skill', 'bag', 'rage'];
const FIGHTER_BONUS_KEYS = ['hp_bonus', 'str_bonus', 'dex_bonus', 'vit_bonus', 'stm_bonus', 'luk_bonus'];
const FIGHTER_PARAM_LEGIT_MAX = 45;
const FIGHTER_PARAM_DB_MAX = 50;

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

function getFighterOverLimitWarnings(updates, savePath) {
  let dbStatMax = 45;
  let dbExpMax = 280;
  if (savePath) {
    try {
      const status = getFighterLimitStatus(savePath);
      dbStatMax = status.statMaxLevel;
      dbExpMax = status.expMaxLevel;
    } catch {}
  }

  const notices = [];
  const statKeys = ['hp', 'str', 'dex', 'vit', 'stm', 'luk'];
  const overLegitStats = statKeys.filter((k) => updates[k] !== undefined && updates[k] > 45);
  const overDbStats = statKeys.filter((k) => updates[k] !== undefined && updates[k] > dbStatMax);

  if (overDbStats.length > 0) {
    notices.push(
      `6대 주 능력치(${overDbStats.map((s) => s.toUpperCase()).join(', ')}) DB 등록 상한(Lv.${dbStatMax}) 초과\n` +
      `     -> 마스터 DB(masters.db)에 데이터가 없어 인게임에서 ATK 10 / DEF 30으로 롤백됩니다.\n` +
      `     -> 'expand-fighter-limits' DB 패치로 상한을 먼저 해제해야 합니다.`
    );
  } else if (overLegitStats.length > 0) {
    notices.push(
      `6대 주 능력치(${overLegitStats.map((s) => s.toUpperCase()).join(', ')}) 순정 공식 한도(Lv.45) 초과 [상한 해제 Lv.50 적용]\n` +
      `     -> masters.db 상한 해제 패치를 통해 인게임에서 HP 31,320 / STR 582 등 최고 스펙이 온전히 유지됩니다.`
    );
  }

  if (updates.skill !== undefined && updates.skill > 4) {
    notices.push(
      `데칼 슬롯 +${updates.skill} (순정/물리 UI 한도 +4 [총 9칸] 초과)\n` +
      `     -> 인게임 3x3 데칼 UI 한계로 인해 10번째 이후 슬롯은 화면에 표시되지 않습니다. (최대 9칸 권장)`
    );
  }

  if (updates.bag !== undefined && updates.bag > 12) {
    if (dbExpMax < 500) {
      notices.push(
        `가방 용량 +${updates.bag} (순정 상한 +12 초과)\n` +
        `     -> 총 레벨 280 초과로 밍고 헤드 프리즈 발생 위험 ('expand-fighter-limits' DB 패치 필요)`
      );
    } else {
      notices.push(
        `가방 용량 +${updates.bag} (순정 상한 +12를 넘어선 [가방 상한 해제] 적용)\n` +
        `     -> 인게임 데스 백이 74칸으로 대폭 확장 스크롤됩니다.`
      );
    }
  }

  const bonusKeys = ['hp_bonus', 'str_bonus', 'dex_bonus', 'vit_bonus', 'stm_bonus', 'luk_bonus'];
  const overBonuses = bonusKeys.filter((k) => updates[k] !== undefined && updates[k] > 5);
  if (overBonuses.length > 0) {
    notices.push(
      `블러드늄 언캡 보너스(+${updates[overBonuses[0]]}) 순정 공식 상한(+5) 초과 적용`
    );
  }
  return notices;
}

async function promptFighterWarningIfNeeded(rl, updates, savePath, forceYes = false) {
  const notices = getFighterOverLimitWarnings(updates, savePath);
  if (notices.length === 0) return true;

  console.log('\n' + '='.repeat(78));
  console.log(' [안내] 파이터 상한 해제(Uncap) 및 확장 수치 적용');
  console.log('-'.repeat(78));
  console.log('순정 공식 한도를 초과하는 상한 해제 및 확장 설정이 감지되었습니다:');
  notices.forEach((w, idx) => console.log(`  ${idx + 1}. ${w}`));
  console.log('='.repeat(78));

  if (forceYes) {
    console.log('--yes 옵션으로 인해 확인을 통과하고 진행합니다.');
    return true;
  }
  if (!rl) return false;
  const proceed = await confirm(rl, '위 상한 해제 수치를 캐릭터에 적용하시겠습니까?');
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

  const statItems = [
    { label: 'HP (체력)', key: 'hp' },
    { label: 'STR (공격력)', key: 'str' },
    { label: 'DEX (기교)', key: 'dex' },
    { label: 'VIT (체력/방어)', key: 'vit' },
    { label: 'STM (스태미나)', key: 'stm' },
    { label: 'LUK (행운)', key: 'luk' },
    { label: '데칼 슬롯', key: 'skill', fmt: (v) => `+${v} (총 ${Math.min(9, 5 + v)}칸)` },
    { label: '가방 용량', key: 'bag', fmt: (v) => `+${v}칸` },
    { label: '분노 게이지', key: 'rage', fmt: (v) => `${v}/5` },
    { label: 'HP 보너스', key: 'hp_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: 'STR 보너스', key: 'str_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: 'DEX 보너스', key: 'dex_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: 'VIT 보너스', key: 'vit_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: 'STM 보너스', key: 'stm_bonus', fmt: (v) => `+${v ?? 0}` },
    { label: 'LUK 보너스', key: 'luk_bonus', fmt: (v) => `+${v ?? 0}` },
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
  console.log(` [성공] 파이터 '${f.name}' (${f.typeName}) 능력치 변경 및 세이브 저장이 완료되었습니다!`);
  console.log('-'.repeat(78));
  console.log(`• 설정 모드  : [${modeDesc}]`);
  console.log(`• 총 파이터 렙: Lv.${p.lvl}  →  Lv.${u.lvl} (${u.lvl >= p.lvl ? '+' : ''}${u.lvl - p.lvl})`);

  if (changedItems.length > 0) {
    console.log(`• 변경된 스탯: ${changedItems.length}개 항목`);
    changedItems.forEach((ci) => {
      console.log(`    ▶ ${ci.label}: ${ci.bStr} → ${ci.aStr} ${ci.diff}`);
    });
  } else {
    console.log(`• 변경된 스탯: 수치 변동 없음 (동일 수치 유지)`);
  }

  console.log('------------------------------------------------------------------------------');
  console.log(`${padEndVisual('능력치 항목', 20)} ${padEndVisual('변경 전', 16)} ${padEndVisual('변경 후', 16)} 상태`);
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
    const statusText = isChanged ? `★ 변경됨 ${diff}` : '유지';
    console.log(`  ${padEndVisual(item.label, 18)} : ${padEndVisual(bStr, 14)} →  ${padEndVisual(aStr, 14)} [${statusText}]`);
  }
  console.log('------------------------------------------------------------------------------');
  console.log(`• 세이브 백업: ${result.backupPath}`);
  console.log('==============================================================================\n');
}

function getFighterList(save) {
  const uid = String(save.data?.soul?.uid ?? Object.keys(save.data?.bodyuser || {})[0]);
  let chrs = save.data?.soul?.chr?.chrs;
  if (chrs && !Array.isArray(chrs) && typeof chrs === 'object') {
    chrs = chrs[uid] || Object.values(chrs)[0];
  }
  if (!Array.isArray(chrs) || chrs.length === 0) {
    fail('세이브에서 파이터 목록(soul.chr.chrs)을 찾지 못했습니다.');
  }

  let bodyusers = save.data?.bodyuser;
  if (bodyusers && !Array.isArray(bodyusers) && typeof bodyusers === 'object') {
    bodyusers = bodyusers[uid] || Object.values(bodyusers)[0];
  }
  if (!Array.isArray(bodyusers) || bodyusers.length === 0) {
    fail(`세이브에서 파이터 능력치 데이터(bodyuser.${uid})를 찾지 못했습니다.`);
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
      fail(`파이터 '${chr.name || chr.cid}'의 능력치 정보(bodyuser)를 찾지 못했습니다.`);
    }
    return {
      chrIndex,
      bodyIndex: entry.bodyIndex,
      uid,
      cid: chr.cid,
      name: chr.name || `파이터 ${chrIndex + 1}`,
      type: chr.type || 'UNKNOWN',
      typeName: FIGHTER_TYPES[chr.type] || chr.type || '알 수 없음',
      grade: chr.grade ?? 1,
      limitBreak: chr.limit_break ?? 0,
      state: chr.state === 'USE' ? '사용 중' : (chr.state === 'GUARD' ? '대기실/냉동고' : (chr.state || '보관')),
      rawState: chr.state,
      stats: { ...entry.data },
    };
  });
}

function replaceFighterStats(save, fighterIndex, statUpdates) {
  const fighters = getFighterList(save);
  if (!Number.isInteger(fighterIndex) || fighterIndex < 0 || fighterIndex >= fighters.length) {
    fail(`파이터 번호(${fighterIndex + 1})가 유효하지 않습니다. (1~${fighters.length})`);
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
    fail(`수정된 파이터 능력치 JSON 검증에 실패했습니다: ${error.message}`);
  }

  const updatedTarget = changedData.bodyuser[uid][target.bodyIndex];
  for (const [key, value] of Object.entries(statUpdates)) {
    if (value !== undefined && value !== null && updatedTarget[key] !== value) {
      fail(`파이터 능력치 ${key} 검증에 실패했습니다.`);
    }
  }
  if (updatedTarget.lvl !== calculateFighterTotalLevel(updatedTarget)) {
    fail('파이터 총 레벨 재계산 검증에 실패했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
  }

  const mutation = replaceFighterStats(save, fighterIndex, statUpdates);
  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.fighter-edit.tmp`;
  const rollbackPath = `${savePath}.fighter-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail('이전 파이터 능력치 수정 작업의 임시 파일이 남아 있습니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkFighters = getFighterList(check);
    const checkTarget = checkFighters[fighterIndex];
    for (const [key, value] of Object.entries(statUpdates)) {
      if (value !== undefined && value !== null && checkTarget.stats[key] !== value) {
        fail(`임시 세이브의 파이터 ${key} 검증에 실패했습니다.`);
      }
    }
    if (checkTarget.stats.lvl !== mutation.updatedStats.lvl) {
      fail('임시 세이브의 파이터 총 레벨 검증에 실패했습니다.');
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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

function listNumericSaveFiles(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^\d+\.sav$/i.test(name))
    .map((name) => path.join(directory, name));
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
    return /^\d+\.sav$/i.test(path.basename(resolved)) ? [resolved] : [];
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
    fail('입력한 위치에서 masters.db를 찾지 못했습니다. LET IT DIE 설치 폴더 또는 masters.db 파일을 지정하세요.');
  }
  masterDatabaseOverridePath = matches[0];
  return masterDatabaseOverridePath;
}

function discoverSaves() {
  const saves = [];
  for (const installDirectory of findGameInstallDirectories()) {
    const saveDirectory = path.join(installDirectory, 'Savedata');
    if (!fs.existsSync(saveDirectory)) continue;
    for (const name of fs.readdirSync(saveDirectory)) {
      if (/^\d+\.sav$/i.test(name)) saves.push(path.join(saveDirectory, name));
    }
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
      'LET IT DIE 멀티툴 오류 로그',
      '================================================================================',
      `일시: ${new Date().toISOString()} (${new Date().toLocaleString('ko-KR')})`,
      `Node.js: ${process.version}`,
      `플랫폼: ${process.platform} ${process.arch}`,
      `실행 파일: ${process.argv.join(' ')}`,
    ];

    if (context.mode) {
      lines.push(`실행 모드: ${context.mode}`);
    }
    if (context.command) {
      lines.push(`명령어: ${context.command}`);
    }
    if (context.choice !== undefined) {
      lines.push(`대화형 메뉴 선택 번호: ${context.choice}`);
    }
    if (context.savePath) {
      lines.push(`세이브 파일: ${context.savePath}`);
    }
    try {
      const dbPath = masterDatabaseOverridePath || (context.savePath ? findMasterDatabasePath(context.savePath) : null);
      if (dbPath) lines.push(`마스터 DB: ${dbPath}`);
    } catch {
      // ignore
    }

    lines.push('--------------------------------------------------------------------------------');
    lines.push(`오류 메시지: ${error?.message || String(error)}`);
    lines.push('--------------------------------------------------------------------------------');
    lines.push('스택 트레이스:');
    lines.push(error?.stack || '(스택 정보 없음)');
    if (error?.cause) {
      lines.push('--------------------------------------------------------------------------------');
      lines.push(`원인(cause): ${error.cause?.stack || error.cause?.message || String(error.cause)}`);
    }
    lines.push('================================================================================\n');

    fs.writeFileSync(destination, lines.join('\n'), 'utf8');
    return destination;
  } catch (logError) {
    console.error(`로그 파일 작성 실패: ${logError.message}`);
    return null;
  }
}

function createBackup(savePath, packed) {
  const directory = backupDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const name = `${path.basename(savePath)}.${timestamp()}.${sha256(packed).slice(0, 12)}.bak`;
  const destination = path.join(directory, name);
  fs.writeFileSync(destination, packed, { flag: 'wx' });
  return destination;
}

function findMasterDatabasePath(savePath) {
  if (masterDatabaseOverridePath) return masterDatabaseOverridePath;
  const adjacentInstallDirectory = path.dirname(path.dirname(savePath));
  const candidates = uniquePaths([
    path.join(adjacentInstallDirectory, 'BrgGame', 'Content', 'masters.db'),
    ...findGameInstallDirectories().map((installDirectory) =>
      path.join(installDirectory, 'BrgGame', 'Content', 'masters.db')),
  ]);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getMasterDatabasePath(savePath) {
  const databasePath = findMasterDatabasePath(savePath);
  if (databasePath) return databasePath;
  fail('마스터 DB를 찾지 못했습니다. LET IT DIE 설치 폴더 또는 masters.db 경로를 입력하거나 --game/--master 옵션으로 지정하세요.');
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
      fail(`마스터 DB의 Steam용 전체 데칼 ${STEAM_DECAL_DEFINITION_COUNT}종 정의가 예상과 달라 안전하게 중단했습니다.`);
    }
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (typeof row.id !== 'string' || !row.id || row.no_steam !== index + 1 ||
          ![0, 1].includes(row.premium) || !Number.isSafeInteger(row.rarity) ||
          row.rarity < 1 || row.rarity > 5 || row.is_display !== 1 ||
          row.is_display_list !== 1 || row.platform !== 0) {
        fail(`마스터 DB의 Steam 데칼 ${index + 1}번 정의가 예상과 달라 안전하게 중단했습니다.`);
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
      fail('마스터 DB의 황금동물 11종 정의가 예상과 달라 안전하게 중단했습니다.');
    }
    for (let index = 0; index < GOLDEN_BEAST_IDS.length; index += 1) {
      const row = rows[index];
      if (row.id !== GOLDEN_BEAST_IDS[index] || row.idx !== index + 12 ||
          typeof row.rwdmsrid !== 'string' || !row.rwdmsrid ||
          row.reward_definition_id !== row.rwdmsrid) {
        fail(`마스터 DB의 황금동물 ${GOLDEN_BEAST_IDS[index]} 정의가 예상과 달라 안전하게 중단했습니다.`);
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
      fail(`마스터 DB의 Steam용 기간 한정 레시피 ${LIMITED_RECIPE_DEFINITION_COUNT}종 정의가 예상과 달라 안전하게 중단했습니다.`);
    }
    const orderedRows = LIMITED_RECIPE_IDS.map((id) => byId.get(id));
    for (const row of orderedRows) {
      if (!row || typeof row.name !== 'string' || !row.name.includes('.') ||
          !['PTTP_ARM', 'PTTP_HEAD', 'PTTP_BODY', 'PTTP_LEGS'].includes(row.type) ||
          row.platform !== 0 || row.is_initial !== 0 || row.is_open !== 1 ||
          typeof row.display_name !== 'string' || !row.display_name) {
        fail(`마스터 DB의 기간 한정 레시피 ${row?.id ?? '(없음)'} 정의가 예상과 달라 안전하게 중단했습니다.`);
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
      fail(`마스터 DB의 Steam용 전체 레시피 ${ALL_RECIPE_DEFINITION_COUNT}종 정의가 예상과 달라 안전하게 중단했습니다.`);
    }
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id ||
          typeof row.name !== 'string' || !row.name.includes('.') ||
          !['PTTP_ARM', 'PTTP_HEAD', 'PTTP_BODY', 'PTTP_LEGS'].includes(row.type) ||
          row.platform !== 0 || ![0, 1].includes(row.is_initial) || row.is_open !== 1 ||
          !Number.isSafeInteger(row.sort_no) ||
          typeof row.display_name !== 'string' || !row.display_name) {
        fail(`마스터 DB의 전체 레시피 ${row?.id ?? '(없음)'} 정의가 예상과 달라 안전하게 중단했습니다.`);
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
      fail('KAMAS RE 최종 티어 정의가 예상과 달라 안전하게 중단했습니다.');
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
      fail('충돌버섯 효과 정의가 예상과 달라 안전하게 중단했습니다.');
    }
    return { databasePath, rows };
  } finally {
    if (database) database.close();
  }
}

function createMasterDatabaseBackup(original, prefix = 'masters.db') {
  if (!/^[a-z0-9.-]+$/i.test(prefix)) fail('마스터 DB 백업 이름이 올바르지 않습니다.');
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
    fail(`장비 연구 DB 구조가 예상과 다릅니다. 없는 열: ${missing.join(', ')}`);
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const status = getEquipmentMaterialStatus(savePath);
  if (status.rowCount === 0) fail('장비 연구 정의가 비어 있어 안전하게 중단했습니다.');
  if (status.nonZeroCells === 0) {
    return { ...status, changed: false, backupPath: undefined };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original, 'masters.db.equipment-materials');
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
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
      fail(`재료 비용 수정 행 수가 예상과 다릅니다: ${result.changes} / ${status.nonZeroRows}`);
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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
    fail('수정 결과 검증에 실패해 원본 DB를 복구했습니다.');
  }
  return { ...verified, changed: true, backupPath };
}

function restoreEquipmentMaterials(savePath, requestedBackupPath) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const backups = listEquipmentMaterialBackups();
  const sourcePath = requestedBackupPath ? path.resolve(requestedBackupPath) : backups[0];
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    fail('복원할 장비 재료 비용 백업이 없습니다.');
  }
  const sourceRows = readEquipmentMaterialRows(sourcePath);
  if (sourceRows.length === 0) fail('장비 재료 비용 백업이 비어 있습니다.');

  const databasePath = getMasterDatabasePath(savePath);
  const currentRows = readEquipmentMaterialRows(databasePath);
  if (currentRows.length !== sourceRows.length ||
      currentRows.some((row, index) => row.ptid !== sourceRows[index].ptid)) {
    fail('현재 DB와 백업의 장비 연구 목록이 달라 안전하게 중단했습니다.');
  }

  const original = fs.readFileSync(databasePath);
  const originalHash = sha256(original);
  const safetyBackup = createMasterDatabaseBackup(original, 'masters.db.before-equipment-materials-restore');
  let database;
  try {
    if (sha256(fs.readFileSync(databasePath)) !== originalHash) {
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
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
        fail(`장비 재료 비용 복원에 실패했습니다: ${row.ptid}`);
      }
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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
    fail('복원 결과 검증에 실패해 복원 직전 DB로 되돌렸습니다.');
  }
  return {
    databasePath,
    sourcePath,
    safetyBackup,
    ...summarizeEquipmentMaterialRows(restoredRows),
  };
}

function setCollisionMushroomThirtyMinutes(savePath) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
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
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
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
        fail(`충돌버섯 효과 ${id} 수정 건수가 올바르지 않습니다.`);
      }
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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
    fail('수정 결과 검증에 실패해 원본 DB를 복구했습니다.');
  }

  return { ...verified, changed: true, backupPath };
}

function restoreCollisionMushroomDefault(savePath) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
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
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    const update = database.prepare(
      'UPDATE master_mushroom_efc SET tmmin = ?, tmmax = ? WHERE id = ?',
    );
    for (const [id, defaultSec] of Object.entries(COLLISION_MUSHROOM_DEFAULT_DURATIONS)) {
      const result = update.run(defaultSec, defaultSec, id);
      if (Number(result.changes) !== 1) {
        fail(`충돌버섯 효과 ${id} 복원 건수가 올바르지 않습니다.`);
      }
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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
    fail('복원 결과 검증에 실패해 직전 DB를 복구했습니다.');
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
      fail('궁극 파이터의 귀환 데칼 정의가 예상과 달라 안전하게 중단했습니다.');
    }
    if ([row.val1, row.val2, row.val3, row.val4, row.val5].some((value) => value !== 0)) {
      fail('궁극 파이터의 귀환에 예상하지 못한 추가 효과 수치가 있어 중단했습니다.');
    }
    return { databasePath, row };
  } finally {
    if (database) database.close();
  }
}

function setUltimateFighterReturnPercent(savePath, targetPercent) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const percent = Number(targetPercent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 1_000_000) {
    fail('얼티메이트 파이터 리턴 효과 수치는 1 ~ 1,000,000 사이의 정수여야 합니다.');
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
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
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
      fail('궁극 파이터의 귀환 효과 수정 건수가 올바르지 않습니다.');
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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
    fail('수정 결과 검증에 실패해 원본 DB를 복구했습니다.');
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
      fail('스페이드 여왕 데칼 정의가 예상과 달라 안전하게 중단했습니다.');
    }
    return { databasePath, row };
  } finally {
    if (database) database.close();
  }
}

function setQueenOfSpadesPercent(savePath, targetPercent) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const percent = Number(targetPercent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 5_000) {
    fail('스페이드 여왕 공격력 수치는 1 ~ 5,000 사이의 정수여야 합니다. (32비트 연산 오버플로 방지 안전 한도)');
  }

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
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
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
      fail('스페이드 여왕 공격력 효과 수정 건수가 올바르지 않습니다.');
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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
    fail('수정 결과 검증에 실패해 원본 DB를 복구했습니다.');
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
    const superWolf = database.prepare('SELECT * FROM master_skill WHERE id = ?').get('SKL_RGSPDUP_02_P');
    const madWolf = database.prepare('SELECT * FROM master_skill WHERE id = ?').get('SKL_RGSPUP_RDURDOWN_01_P');
    if (!superWolf || !madWolf) {
      fail('마스터 DB에서 울프 계열 데칼(슈퍼 울프/매드 울프) 정의를 찾지 못했습니다.');
    }
    return {
      databasePath,
      superWolf,
      madWolf,
      isBoosted: superWolf.val0 >= WOLF_RAGE_TARGET_PERCENT && madWolf.val0 >= WOLF_RAGE_TARGET_PERCENT,
    };
  } finally {
    if (database) database.close();
  }
}

function setWolfRagePercent(savePath, targetPercent = WOLF_RAGE_TARGET_PERCENT) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const percent = Number(targetPercent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 50_000) {
    fail('레이지 축적 속도 수치는 1 ~ 50,000 사이의 정수여야 합니다.');
  }

  const status = getWolfRageStatus(savePath);
  if (status.superWolf.val0 === percent && status.madWolf.val0 === percent) {
    return { ...status, changed: false, backupPath: undefined, targetPercent: percent };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    const result1 = database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(percent, 'SKL_RGSPDUP_02_P');
    const result2 = database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(percent, 'SKL_RGSPUP_RDURDOWN_01_P');
    if (Number(result1.changes) !== 1 || Number(result2.changes) !== 1) {
      fail('울프 계열 데칼 레이지 축적 속도 수정 건수가 올바르지 않습니다.');
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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
  if (verified.superWolf.val0 !== percent || verified.madWolf.val0 !== percent) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail('수정 결과 검증에 실패해 원본 DB를 복구했습니다.');
  }

  return { ...verified, changed: true, backupPath, targetPercent: percent };
}

function restoreWolfRageDefault(savePath) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const status = getWolfRageStatus(savePath);
  if (status.superWolf.val0 === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P &&
      status.madWolf.val0 === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P) {
    return { ...status, changed: false, backupPath: undefined };
  }

  const original = fs.readFileSync(status.databasePath);
  const originalHash = sha256(original);
  const backupPath = createMasterDatabaseBackup(original);
  let database;
  try {
    if (sha256(fs.readFileSync(status.databasePath)) !== originalHash) {
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
    }
    database = new DatabaseSync(status.databasePath);
    database.exec('BEGIN IMMEDIATE');
    database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P, 'SKL_RGSPDUP_02_P');
    database.prepare('UPDATE master_skill SET val0 = ? WHERE id = ?').run(WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P, 'SKL_RGSPUP_RDURDOWN_01_P');
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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

function expandFighterLimits(savePath, targetStatMax = 50, targetExpMax = 500) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const databasePath = getMasterDatabasePath(savePath);
  const status = getFighterLimitStatus(savePath);
  if (status.statMaxLevel >= targetStatMax && status.expMaxLevel >= targetExpMax && status.bodyDetailParamMax >= targetStatMax && status.skillSlotsCount >= 15) {
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
      fail('마스터 DB를 읽은 뒤 파일이 변경됐습니다. 안전하게 중단했습니다.');
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
        fail(`파이터 클래스 '${type}'의 41~45레벨 데이터를 찾을 수 없어 확장을 중단했습니다.`);
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
    const slotsString = Array.from({ length: 15 }, (_, i) => i + 1).join(',');
    database.prepare(`
      UPDATE master_body_detail 
      SET param_lv_max = 50, skill_slots = ? 
      WHERE grade = 6 AND limit_break = 4
    `).run(slotsString);

    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail('마스터 DB 무결성 검사에 실패했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const databasePath = getMasterDatabasePath(savePath);
  const backups = listFighterLimitBackups();
  const backupToUse = sourceBackupPath || (backups.length > 0 ? backups[0] : null);
  if (!backupToUse || !fs.existsSync(backupToUse)) {
    fail('복원할 마스터 DB 파이터 상한 해제 백업 파일을 찾지 못했습니다.');
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
        throw new Error('복원된 DB 파일의 무결성 검사에 실패했습니다.');
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
    fail(`킬코인은 0~${formatNumber(INT32_MAX)} 사이의 정수여야 합니다.`);
  }
}

function parseAmount(value) {
  const text = String(value ?? '').replaceAll(',', '').trim();
  if (!/^\d+$/.test(text)) {
    fail('킬코인은 숫자로 입력해야 합니다.');
  }
  const amount = Number(text);
  validateAmount(amount);
  return amount;
}

function writeChangedSave(savePath, save, resourceKey, amount) {
  const resource = RESOURCES[resourceKey];
  validateAmount(amount);
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
  }

  const changedText = replaceResource(save, resourceKey, amount);
  const packed = packSave(changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.kc-edit.tmp`;
  const rollbackPath = `${savePath}.kc-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail('이전 수정 작업의 임시 파일이 남아 있습니다. 수동 확인이 필요합니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    if (check.data.soul[resource.field] !== amount) {
      fail(`임시 세이브의 ${resource.label} 검증에 실패했습니다.`);
    }
    const expectedText = replaceResource(save, resourceKey, amount);
    if (check.jsonText !== expectedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
  }

  const mutation = replaceBloodniumShopHistory(save);
  if (mutation.previous.bought.length === 0) {
    fail('블러드늄 상점에서 복구할 구매 완료 재고가 없습니다.');
  }
  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.shop-edit.tmp`;
  const rollbackPath = `${savePath}.shop-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail('이전 상점 수정 작업의 임시 파일이 남아 있습니다. 수동 확인이 필요합니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getBloodniumShopState(check);
    if (checkState.bought.length !== 0 ||
        checkState.available.join(',') !== mutation.restored.join(',')) {
      fail('임시 세이브의 블러드늄 상점 재고 검증에 실패했습니다.');
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
  }

  const definition = getAllDecalDefinitions(savePath);
  const mutation = replaceAllDecals(save, definition.ids);
  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.decal-edit.tmp`;
  const rollbackPath = `${savePath}.decal-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail('이전 데칼 수정 작업의 임시 파일이 남아 있습니다. 수동 확인이 필요합니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkStock = getDecalStock(check);
    if (checkStock.length !== mutation.changedStock.length) {
      fail('임시 세이브의 전체 데칼 검증에 실패했습니다.');
    }
    const checkCounts = new Map(checkStock.map((entry) => [entry.sklid, entry.cnt]));
    const expectedCounts = new Map(mutation.changedStock.map((entry) => [entry.sklid, entry.cnt]));
    for (const id of definition.ids) {
      if (checkCounts.get(id) !== expectedCounts.get(id)) {
        fail(`임시 세이브의 ${id} 수량 검증에 실패했습니다.`);
      }
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
  }

  const definition = getGoldenBeastDefinitions(savePath);
  const mutation = replaceGoldenBeasts(save, definition.rows, countPerBeast);
  const packed = packSave(mutation.changedText, save.blockCount, save.trailer);
  const tempPath = `${savePath}.golden-beast-edit.tmp`;
  const rollbackPath = `${savePath}.golden-beast-edit.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail('이전 황금동물 수정 작업의 임시 파일이 남아 있습니다. 수동 확인이 필요합니다.');
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
        fail(`임시 세이브의 황금동물 ${grant.beastId} 검증에 실패했습니다.`);
      }
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
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
    fail('이전 기간 한정 레시피 수정 작업의 임시 파일이 남아 있습니다. 수동 확인이 필요합니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getLimitedRecipeState(check);
    if (checkState.missingIds.length !== 0 ||
        checkState.research.length !== mutation.changedResearch.length ||
        JSON.stringify(checkState.research) !== JSON.stringify(mutation.changedResearch)) {
      fail('임시 세이브의 기간 한정 레시피 검증에 실패했습니다.');
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
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
    fail('이전 전체 레시피 수정 작업의 임시 파일이 남아 있습니다. 수동 확인이 필요합니다.');
  }

  const backupPath = createBackup(savePath, save.packed);
  fs.writeFileSync(tempPath, packed, { flag: 'wx' });
  try {
    const check = readSave(tempPath);
    const checkState = getRecipeUnlockState(check, definition.ids, 'Steam용 전체 레시피');
    if (checkState.missingIds.length !== 0 ||
        checkState.research.length !== mutation.changedResearch.length ||
        JSON.stringify(checkState.research) !== JSON.stringify(mutation.changedResearch)) {
      fail('임시 세이브의 전체 레시피 검증에 실패했습니다.');
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
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
    fail('이전 KAMAS RE 수정 작업의 임시 파일이 남아 있습니다.');
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
      fail('임시 세이브의 KAMAS RE 최대 강화 검증에 실패했습니다.');
    }
    if (check.jsonText !== mutation.changedText) {
      fail('임시 세이브에서 예상하지 않은 데이터 변경이 발견됐습니다.');
    }
    if (!fs.readFileSync(savePath).equals(save.packed)) {
      fail('수정 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
  const prefix = `${path.basename(savePath)}.`;
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
    .map((name) => path.join(directory, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function restoreBackup(savePath, backupPath) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  const backupSave = readSave(backupPath);
  const current = readSave(savePath);
  const safetyBackup = createBackup(savePath, current.packed);
  const tempPath = `${savePath}.kc-restore.tmp`;
  const rollbackPath = `${savePath}.kc-restore.rollback`;
  if (fs.existsSync(tempPath) || fs.existsSync(rollbackPath)) {
    fail('이전 복원 작업의 임시 파일이 남아 있습니다. 수동 확인이 필요합니다.');
  }
  fs.writeFileSync(tempPath, backupSave.packed, { flag: 'wx' });
  try {
    readSave(tempPath);
    if (!fs.readFileSync(savePath).equals(current.packed)) {
      fail('복원 준비 중 원본 세이브가 변경됐습니다. 안전하게 중단했습니다.');
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
      if (!args[index + 1]) fail('--save 뒤에 세이브 경로가 필요합니다.');
      savePath = path.resolve(args[index + 1]);
      args.splice(index, 2);
    } else if (args[index] === '--game' || args[index] === '--master') {
      const option = args[index];
      if (!args[index + 1]) fail(`${option} 뒤에 게임 설치 폴더 또는 masters.db 경로가 필요합니다.`);
      masterPath = args[index + 1];
      args.splice(index, 2);
    } else if (args[index] === '--yes') {
      yes = true;
      args.splice(index, 1);
    } else {
      index += 1;
    }
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
  'equipment-materials-free',
  'equipment-materials-restore',
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
    fail('마스터 DB를 자동으로 찾지 못했습니다. --game 또는 --master 옵션으로 위치를 지정하세요.');
  }
  console.log('\nLET IT DIE 마스터 DB를 자동으로 찾지 못했습니다.');
  console.log('게임 설치 폴더, BrgGame 폴더, Content 폴더 또는 masters.db 파일을 창에 끌어놓아도 됩니다.');
  const manualInput = await rl.question('게임 설치 폴더 또는 masters.db 경로 (Enter=종료): ');
  if (!manualInput.trim()) fail('사용자가 마스터 DB 경로 입력을 취소했습니다.');
  const databasePath = setMasterDatabaseOverride(manualInput);
  console.log(`마스터 DB: ${databasePath}`);
}

async function chooseSave(rl, explicitPath) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) fail(`세이브 파일이 없습니다: ${explicitPath}`);
    return explicitPath;
  }
  let saves = discoverSaves();
  if (saves.length === 0) {
    if (!rl) {
      fail('Steam LET IT DIE 세이브를 자동으로 찾지 못했습니다. --save 경로를 지정하세요.');
    }
    console.log('\nSteam LET IT DIE 세이브를 자동으로 찾지 못했습니다.');
    console.log('숫자 이름의 .sav 파일 또는 Savedata/LET IT DIE/SteamLibrary 폴더를 창에 끌어놓아도 됩니다.');
    const manualInput = await rl.question('세이브 파일 또는 폴더 경로 (Enter=종료): ');
    if (!manualInput.trim()) fail('사용자가 경로 입력을 취소했습니다.');
    saves = resolveManualSaveInput(manualInput);
    if (saves.length === 0) {
      fail('입력한 위치에서 숫자 이름의 .sav 세이브 파일을 찾지 못했습니다.');
    }
  }
  if (saves.length === 1 || !rl) return saves[0];
  console.log('\n세이브 선택:');
  saves.forEach((savePath, index) => console.log(`  ${index + 1}. ${savePath}`));
  const answer = Number(await rl.question('번호: '));
  if (!Number.isInteger(answer) || answer < 1 || answer > saves.length) {
    fail('잘못된 선택입니다.');
  }
  return saves[answer - 1];
}

function printStatus(savePath, save) {
  console.log(`\n세이브: ${savePath}`);
  for (const [resourceKey, resource] of Object.entries(RESOURCES)) {
    const value = save.data.soul[resource.field];
    const capacity = getKnownCapacity(save, resourceKey);
    const level = resource.levelField ? save.data.soul[resource.levelField] : undefined;
    const levelText = Number.isInteger(level) ? ` / 시설 레벨 ${level}` : '';
    const capacityText = capacity ? ` / 알려진 한도 ${formatNumber(capacity)}` : '';
    console.log(`${resource.label}: ${formatNumber(value)}${levelText}${capacityText}`);
  }
  const shop = getBloodniumShopState(save);
  console.log(`블러드늄 상점: 구매 가능 ${formatNumber(shop.available.length)}개 / 구매 완료 ${formatNumber(shop.bought.length)}개`);
  const decalStock = getDecalStock(save);
  console.log(`데칼 소유 목록: ${formatNumber(decalStock.length)} / ${formatNumber(STEAM_DECAL_DEFINITION_COUNT)}종`);
  const goldenBeasts = getGoldenBeastSummary(save);
  console.log(`황금동물(보관함): ${formatNumber(goldenBeasts.count)}마리 / ${formatNumber(goldenBeasts.typeCount)}/${formatNumber(GOLDEN_BEAST_IDS.length)}종 보유`);
  const limitedRecipes = getLimitedRecipeState(save);
  console.log(`기간 한정 레시피: ${formatNumber(limitedRecipes.ownedIds.length)}/${formatNumber(LIMITED_RECIPE_DEFINITION_COUNT)}종 해금`);
  console.log(`원본 SHA-256: ${sha256(save.packed)}`);
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
  await rl.question('\n계속하려면 Enter 키를 누르세요...');
}

async function interactive(rl, savePath) {
  while (true) {
    const save = readSave(savePath);
    printStatus(savePath, save);

    console.log('\n======================= [1. 캐릭터(파이터) 육성 & DB 상한 해제] =======================');
    console.log(' 1. 캐릭터(파이터) 능력치 레벨 현황 조회 및 세부 설정');
    console.log(' 2. 파이터 스탯(Lv.50) 및 레벨 경험치(Lv.500) 상한 해제 DB 패치');
    console.log(' 3. 파이터 상한 해제 DB 패치 복원 (순정 DB 복구)');
    console.log('\n============================ [2. 보유 자원 및 시설 관리] ============================');
    console.log(' 4. 킬코인을 알려진 한도로 채우기');
    console.log(' 5. 스피리튬을 알려진 한도로 채우기');
    console.log(' 6. 블러드늄을 알려진 한도로 채우기');
    console.log(' 7. 자원 수치 직접 입력 (KC / SP / Blood)');
    console.log(' 8. 시설 레벨(금고·스피리튬 탱크) 최대 99로 업그레이드');
    console.log('\n====================== [3. 장비 R&D, 무기 숙련도 및 레시피 해금] ======================');
    console.log(' 9. 모든 장비 연구·개발(R&D 1,262종) 최대치로 업그레이드');
    console.log('10. KAMAS-A1 어설트 라이플 RE를 최대 +24로 강화');
    console.log('11. 모든 무기 숙련도(57종) 최대 Lv.20으로 업그레이드');
    console.log(`12. Steam용 기간 한정 레시피 전체 ${formatNumber(LIMITED_RECIPE_DEFINITION_COUNT)}종 해금`);
    console.log(`13. Steam용 모든 레시피 전체 ${formatNumber(ALL_RECIPE_DEFINITION_COUNT)}종 해금`);
    console.log('\n========================= [4. 데칼, 아이템 및 상점 관리] ==========================');
    console.log(`14. Steam용 전체 데칼 ${formatNumber(STEAM_DECAL_DEFINITION_COUNT)}종 지급`);
    console.log('15. 황금동물 전체 11종을 보관함에 지급 (수량 지정 가능)');
    console.log('16. 블러드늄 상점 구매 재고 복구');
    console.log('\n=================== [5. 마스터 DB 게임 편의 / 특수 강화 모드] ====================');
    console.log('17. 충돌버섯·구운 충돌버섯 30분 지속시간 적용 / 기본값 복구 (토글)');
    console.log('18. 궁극 파이터의 귀환 데칼 효과 수치 변경(배율/퍼센트 직접 입력) / 기본값 복구');
    console.log('19. 스페이드 여왕 공격력 수치 변경(배율/퍼센트 직접 입력) / 기본값 복구');
    console.log('20. 슈퍼 울프·매드 울프 레이지 축적 속도 +1,000% 적용 (게이지 즉시 충전) / 기본값 복구');
    console.log('21. 모든 장비 개발·강화 재료 비용을 0으로 변경');
    console.log('22. 장비 개발·강화 재료 비용을 전용 백업에서 복원');
    console.log('\n=========================== [6. 세이브 백업 및 복원] ===========================');
    console.log('23. 현재 세이브 백업하기');
    console.log('24. 최신 백업 복원');
    console.log('\n 0. 프로그램 종료');

    const choice = (await rl.question('\n선택: ')).trim();

    if (choice === '0') return;

    try {
      if (choice === '1') {
        const fighters = getFighterList(save);
        console.log('\n============================= [캐릭터(파이터) 목록] =============================');
        fighters.forEach((f, idx) => {
          const s = f.stats;
          console.log(`  ${idx + 1}. [${f.state}] ${f.name} (${f.typeName}) | ${f.grade}성 LB${f.limitBreak} | Lv.${s.lvl} (HP:${s.hp}, STR:${s.str}, DEX:${s.dex}, VIT:${s.vit}, STM:${s.stm}, LUK:${s.luk})`);
        });
        console.log('  0. 이전 메뉴로 돌아가기');
        console.log('==================================================================================');

        const fIdxStr = (await rl.question('관리할 파이터 번호 선택 (0=취소): ')).trim();
        if (fIdxStr === '0' || !fIdxStr) continue;
        const fIdx = Number(fIdxStr) - 1;
        if (!Number.isInteger(fIdx) || fIdx < 0 || fIdx >= fighters.length) {
          console.log('\n잘못된 파이터 번호입니다.');
          continue;
        }

        const selected = fighters[fIdx];
        const s = selected.stats;
        console.log(`\n================== [파이터 상세 현황: ${selected.name} (${selected.typeName})] ==================`);
        console.log(`등급: ${selected.grade}성 | 한계돌파: ${selected.limitBreak}단계 | 상태: ${selected.state}`);
        console.log(`총 레벨: Lv.${s.lvl}`);
        console.log('----------------------------------------------------------------------------------');
        console.log('항목                 현재값     순정 최대치      DB 더미 최대치 비고');
        console.log('----------------------------------------------------------------------------------');
        console.log(`1. HP          :     ${String(s.hp).padEnd(6)}     45 (LB4)         50 (더미OLD)   보너스: ${s.hp_bonus ?? 0}/5`);
        console.log(`2. STR (공격력):     ${String(s.str).padEnd(6)}     45 (LB4)         50 (더미OLD)   보너스: ${s.str_bonus ?? 0}/5`);
        console.log(`3. DEX (기교)  :     ${String(s.dex).padEnd(6)}     45 (LB4)         50 (더미OLD)   보너스: ${s.dex_bonus ?? 0}/5`);
        console.log(`4. VIT (체력)  :     ${String(s.vit).padEnd(6)}     45 (LB4)         50 (더미OLD)   보너스: ${s.vit_bonus ?? 0}/5`);
        console.log(`5. STM (스태미나):   ${String(s.stm).padEnd(6)}     45 (LB4)         50 (더미OLD)   보너스: ${s.stm_bonus ?? 0}/5`);
        console.log(`6. LUK (행운)  :     ${String(s.luk).padEnd(6)}     45 (LB4)         50 (더미OLD)   보너스: ${s.luk_bonus ?? 0}/5`);
        console.log(`7. 데칼 슬롯   :     +${String(s.skill).padEnd(5)}     총 9칸 (+4)      총 15칸 (+10)  기본 5칸 + 추가 해금`);
        console.log(`8. 가방 용량   :     +${String(s.bag).padEnd(5)}     총 34~54 (+12)   +50칸 확장     기본 22~42칸 + 추가 확장`);
        console.log(`9. 분노 게이지 :     ${String(s.rage).padEnd(6)}     5                5              게이지 확장`);
        console.log('==================================================================================');
        console.log('1. [주 능력치 순정 최대] 6대 주 능력치(HP/STR/DEX/VIT/STM/LUK) 45로 일괄 변경 (권장)');
        console.log('2. [주 능력치 DB 더미]   6대 주 능력치(HP/STR/DEX/VIT/STM/LUK) 50으로 일괄 변경 (주의: 롤백 발생)');
        console.log('3. [주 능력치 직접 지정] 6대 주 능력치 수치 직접 입력 일괄 지정 (1~50, 45 초과 시 주의)');
        console.log('4. [보너스 순정 최대]    6대 능력치 보너스 +5로 일괄 적용 (총 +30, 권장)');
        console.log('5. [보너스 확장 지정]    6대 능력치 보너스 수치 직접 입력 일괄 지정 (0~50)');
        console.log('6. [슬롯·가방 순정 최대] 데칼 슬롯 +4 (총 9칸) / 데스백 +12칸 일괄 적용 (권장)');
        console.log('7. [슬롯 9칸 + 가방 확장] 데칼 슬롯 +4 (총 9칸) / 데스백 +50칸 일괄 적용 (권장)');
        console.log('8. 개별 능력치/슬롯/보너스 세부 설정');
        console.log('0. 취소');

        const subChoice = (await rl.question('선택: ')).trim();
        if (subChoice === '0' || !subChoice) continue;

        let updates = {};
        let modeDesc = '';
        if (subChoice === '1') {
          updates = { hp: 45, str: 45, dex: 45, vit: 45, stm: 45, luk: 45 };
          modeDesc = '주 능력치 순정 최대치(45)';
          if (!await confirm(rl, `${selected.name}의 6대 능력치를 모두 순정 최대치(45)로 변경할까요?`)) continue;
        } else if (subChoice === '2') {
          updates = { hp: 50, str: 50, dex: 50, vit: 50, stm: 50, luk: 50 };
          modeDesc = '주 능력치 DB 더미 최대치(50)';
          if (!await confirm(rl, `${selected.name}의 6대 능력치를 모두 50으로 변경할까요?`)) continue;
        } else if (subChoice === '3') {
          const valStr = (await rl.question('6대 능력치에 설정할 레벨 (1~50, 순정 최대:45 / 45초과 시 스탯롤백 주의): ')).trim();
          const val = Number(valStr);
          if (!Number.isInteger(val) || val < 1 || val > 50) {
            console.log('\n능력치 레벨은 1~50 사이의 정수여야 합니다.');
            continue;
          }
          updates = { hp: val, str: val, dex: val, vit: val, stm: val, luk: val };
          modeDesc = `주 능력치 일괄 ${val}`;
          if (!await confirm(rl, `${selected.name}의 6대 능력치를 모두 ${val}(으)로 변경할까요?`)) continue;
        } else if (subChoice === '4') {
          updates = { hp_bonus: 5, str_bonus: 5, dex_bonus: 5, vit_bonus: 5, stm_bonus: 5, luk_bonus: 5 };
          modeDesc = '보너스 순정 최대치(+5)';
          if (!await confirm(rl, `${selected.name}의 6대 능력치 보너스를 모두 순정 최대치인 +5(총 +30)로 적용할까요?`)) continue;
        } else if (subChoice === '5') {
          const valStr = (await rl.question('6대 능력치에 설정할 보너스 포인트 (0~50, 순정 최대: 5): ')).trim();
          const val = Number(valStr);
          if (!Number.isInteger(val) || val < 0 || val > 50) {
            console.log('\n보너스 포인트는 0~50 사이의 정수여야 합니다.');
            continue;
          }
          updates = { hp_bonus: val, str_bonus: val, dex_bonus: val, vit_bonus: val, stm_bonus: val, luk_bonus: val };
          modeDesc = `보너스 포인트 일괄 ${val}`;
          if (!await confirm(rl, `${selected.name}의 6대 능력치 보너스를 모두 ${val}(으)로 변경할까요?`)) continue;
        } else if (subChoice === '6') {
          updates = { skill: 4, bag: 12 };
          modeDesc = '슬롯·가방 순정 최대치(슬롯+4 / 가방+12)';
          if (!await confirm(rl, `${selected.name}의 데칼 슬롯을 +4(총 9칸), 가방을 +12칸으로 변경할까요?`)) continue;
        } else if (subChoice === '7') {
          updates = { skill: 4, bag: 50 };
          modeDesc = '슬롯 9칸 + 가방 50칸 확장 (슬롯+4 / 가방+50)';
          if (!await confirm(rl, `${selected.name}의 데칼 슬롯을 +4(총 9칸, 인게임 UI 최대), 가방을 +50칸으로 확장할까요?`)) continue;
        } else if (subChoice === '8') {
          console.log('\n개별 설정할 항목을 선택하세요:');
          console.log(' 1. HP (체력)             (1~50, 순정최대: 45)');
          console.log(' 2. STR (공격력)          (1~50, 순정최대: 45)');
          console.log(' 3. DEX (기교)            (1~50, 순정최대: 45)');
          console.log(' 4. VIT (체력/방어)       (1~50, 순정최대: 45)');
          console.log(' 5. STM (스태미나)        (1~50, 순정최대: 45)');
          console.log(' 6. LUK (행운)            (1~50, 순정최대: 45)');
          console.log(' 7. 데칼 슬롯 추가        (0~4, 총 5~9칸, 인게임 UI 최대: +4)');
          console.log(' 8. 가방 용량 추가        (0~50, 순정최대: 12칸 / 최대 50칸 확장)');
          console.log(' 9. 분노 게이지           (0~5)');
          console.log('10. HP 보너스 포인트      (0~50, 순정최대: 5)');
          console.log('11. STR 보너스 포인트     (0~50, 순정최대: 5)');
          console.log('12. DEX 보너스 포인트     (0~50, 순정최대: 5)');
          console.log('13. VIT 보너스 포인트     (0~50, 순정최대: 5)');
          console.log('14. STM 보너스 포인트     (0~50, 순정최대: 5)');
          console.log('15. LUK 보너스 포인트     (0~50, 순정최대: 5)');
          console.log(' 0. 취소');
          const statChoice = (await rl.question('선택: ')).trim();
          if (statChoice === '0' || !statChoice) continue;

          const statKeyMap = {
            '1': { key: 'hp', name: 'HP', min: 1, legitMax: 45, max: 50 },
            '2': { key: 'str', name: 'STR', min: 1, legitMax: 45, max: 50 },
            '3': { key: 'dex', name: 'DEX', min: 1, legitMax: 45, max: 50 },
            '4': { key: 'vit', name: 'VIT', min: 1, legitMax: 45, max: 50 },
            '5': { key: 'stm', name: 'STM', min: 1, legitMax: 45, max: 50 },
            '6': { key: 'luk', name: 'LUK', min: 1, legitMax: 45, max: 50 },
            '7': { key: 'skill', name: '데칼 슬롯', min: 0, legitMax: 4, max: 4 },
            '8': { key: 'bag', name: '가방 용량', min: 0, legitMax: 12, max: 50 },
            '9': { key: 'rage', name: '분노 게이지', min: 0, legitMax: 5, max: 5 },
            '10': { key: 'hp_bonus', name: 'HP 보너스', min: 0, legitMax: 5, max: 50 },
            '11': { key: 'str_bonus', name: 'STR 보너스', min: 0, legitMax: 5, max: 50 },
            '12': { key: 'dex_bonus', name: 'DEX 보너스', min: 0, legitMax: 5, max: 50 },
            '13': { key: 'vit_bonus', name: 'VIT 보너스', min: 0, legitMax: 5, max: 50 },
            '14': { key: 'stm_bonus', name: 'STM 보너스', min: 0, legitMax: 5, max: 50 },
            '15': { key: 'luk_bonus', name: 'LUK 보너스', min: 0, legitMax: 5, max: 50 },
          };
          const targetMeta = statKeyMap[statChoice];
          if (!targetMeta) {
            console.log('\n잘못된 항목 번호입니다.');
            continue;
          }
          const currentVal = s[targetMeta.key] ?? 0;
          const newValStr = (await rl.question(`새 ${targetMeta.name} 수치 (범위: ${targetMeta.min}~${targetMeta.max}, 순정최대:${targetMeta.legitMax}, 현재: ${currentVal}): `)).trim();
          const newVal = Number(newValStr);
          if (!Number.isInteger(newVal) || newVal < targetMeta.min || newVal > targetMeta.max) {
            console.log(`\n수치는 ${targetMeta.min}~${targetMeta.max} 사이의 정수여야 합니다.`);
            continue;
          }
          updates = { [targetMeta.key]: newVal };
          modeDesc = `${targetMeta.name} ${newVal}`;
          if (!await confirm(rl, `${selected.name}의 ${targetMeta.name}을(를) ${currentVal} → ${newVal}(으)로 변경할까요?`)) continue;
        } else {
          console.log('\n잘못된 선택입니다.');
          continue;
        }

        if (!await promptFighterWarningIfNeeded(rl, updates, savePath)) continue;

        const result = writeFighterStats(savePath, save, fIdx, updates);
        printFighterChangeSummary(result, modeDesc);
      } else if (choice === '2') {
        const status = getFighterLimitStatus(savePath);
        console.log(`\n==================== [파이터 스탯 & 경험치 상한 해제 DB 패치] ====================`);
        console.log(`마스터 DB: ${status.databasePath}`);
        console.log(`현재 DB 주 능력치 한도: Lv.${status.statMaxLevel} / 총 레벨 경험치 한도: Lv.${status.expMaxLevel}`);
        if (status.statMaxLevel >= 50 && status.expMaxLevel >= 500 && status.skillSlotsCount >= 15) {
          console.log('\n[안내] 파이터 스탯(Lv.50), 경험치(Lv.500), 슬롯(15개) 상한 해제가 이미 DB에 적용돼 있습니다.');
          await pause(rl);
          continue;
        }
        console.log('\n' + '='.repeat(72));
        console.log('[경고] 게임 데이터베이스(masters.db) 변조 알림');
        console.log('-'.repeat(72));
        console.log('- 본 기능은 게임 클라이언트의 원본 마스터 DB를 직접 패치합니다.');
        console.log('- 6성 8개 파이터 클래스의 주 능력치를 Lv.50까지 확장하고,');
        console.log('  경험치 테이블을 Lv.500까지 확장하여 스탯 롤백 및 레벨 오류를 방지합니다.');
        console.log('- Steam 무결성 검사 시 순정으로 초기화될 수 있습니다.');
        console.log('- 패치 전 원본 DB는 backups 폴더에 자동 백업됩니다.');
        console.log('='.repeat(72));
        if (!await confirm(rl, '파이터 스탯 및 경험치 상한 해제 DB 패치를 진행할까요?')) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = expandFighterLimits(savePath, 50, 500);
        console.log('\n[성공] 파이터 상한 해제 DB 패치가 성공적으로 완료되었습니다.');
        console.log(`- 6성 파이터 주 능력치 상한: Lv.${status.statMaxLevel} → Lv.${result.statMaxLevel} (추가 ${result.addedStatusRows}행)`);
        console.log(`- 6성 경험치/총 레벨 상한: Lv.${status.expMaxLevel} → Lv.${result.expMaxLevel} (추가 ${result.addedExpRows}행)`);
        console.log(`- 마스터 DB 백업: ${result.backupPath}`);
      } else if (choice === '3') {
        const backups = listFighterLimitBackups();
        console.log(`\n====================== [파이터 상한 해제 순정 DB 복원] ======================`);
        if (backups.length === 0) {
          console.log('\n[안내] 복원할 파이터 상한 해제 DB 백업이 없습니다.');
          await pause(rl);
          continue;
        }
        const sourcePath = backups[0];
        console.log(`복원 대상 백업: ${sourcePath}`);
        if (!await confirm(rl, '이 백업을 사용하여 순정 DB로 복원할까요?')) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = restoreFighterLimits(savePath, sourcePath);
        console.log('\n[성공] 파이터 상한 순정 DB 복원이 성공적으로 완료되었습니다.');
        console.log(`- 주 능력치 상한: Lv.${result.statMaxLevel} / 경험치 상한: Lv.${result.expMaxLevel}`);
        console.log(`- 복원 전 안전 백업: ${result.safetyBackup}`);
      } else if (['4', '5', '6'].includes(choice)) {
        const resourceKey = ['killcoins', 'splithium', 'bloodnium'][Number(choice) - 4];
        const resource = RESOURCES[resourceKey];
        const capacity = getKnownCapacity(save, resourceKey);
        console.log(`\n============================ [${resource.label} 충전] ============================`);
        if (!capacity) {
          console.log(`현재 ${resource.label} 시설 레벨의 한도 정보가 없어 자동 설정할 수 없습니다.`);
          await pause(rl);
          continue;
        }
        console.log(`현재 보유: ${formatNumber(getResourceAmount(save, resourceKey))} / 알려진 한도: ${formatNumber(capacity)}`);
        if (!await confirm(rl, `${resource.label}을 한도인 ${formatNumber(capacity)}(으)로 채울까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeChangedSave(savePath, save, resourceKey, capacity);
        console.log(`\n[성공] ${resource.label} 충전이 성공적으로 완료되었습니다.`);
        console.log(`- 설정 값: ${formatNumber(capacity)}`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '7') {
        console.log('\n========================= [자원 수치 직접 입력] =========================');
        console.log('1. 킬코인');
        console.log('2. 스피리튬');
        console.log('3. 블러드늄');
        console.log('0. 취소');
        const resourceChoice = (await rl.question('자원 선택: ')).trim();
        if (resourceChoice === '0' || !resourceChoice) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        if (!['1', '2', '3'].includes(resourceChoice)) {
          console.log('\n[오류] 잘못된 선택입니다.');
          await pause(rl);
          continue;
        }
        const resourceKey = ['killcoins', 'splithium', 'bloodnium'][Number(resourceChoice) - 1];
        const resource = RESOURCES[resourceKey];
        const capacity = getKnownCapacity(save, resourceKey);
        const currentAmount = getResourceAmount(save, resourceKey);
        console.log(`현재 ${resource.label}: ${formatNumber(currentAmount)} (알려진 한도: ${capacity ? formatNumber(capacity) : '없음'})`);
        const amount = parseAmount(await rl.question(`새 ${resource.label} 값: `));
        if (capacity && amount > capacity) {
          console.log(`주의: 알려진 한도 ${formatNumber(capacity)}을 초과합니다.`);
        }
        if (!await confirm(rl, `${resource.label}을 ${formatNumber(amount)}(으)로 변경할까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeChangedSave(savePath, save, resourceKey, amount);
        console.log(`\n[성공] ${resource.label} 변경이 성공적으로 완료되었습니다.`);
        console.log(`- 설정 값: ${formatNumber(amount)}`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '8') {
        const facilityState = getFacilityState(save);
        console.log(`\n============================= [시설 레벨 최대 업그레이드] =============================`);
        console.log(`금고 레벨: Lv.${facilityState.safeLevel} / 스피리튬 탱크 레벨: Lv.${facilityState.tankLevel} (최대 99)`);
        if (facilityState.isMaxed) {
          console.log('\n[안내] 시설 레벨이 이미 모두 최대치(99)입니다.');
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, '금고와 스피리튬 탱크 레벨을 모두 99로 업그레이드할까요?')) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeFacilityUpgradesMaximum(savePath, save);
        console.log('\n[성공] 시설 레벨 최대 업그레이드가 성공적으로 완료되었습니다.');
        console.log(`- 금고: Lv.${result.previousSafeLevel} → Lv.${result.currentSafeLevel}, 스피리튬 탱크: Lv.${result.previousTankLevel} → Lv.${result.currentTankLevel} (한도 2,560,000)`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '9') {
        const researchState = getEquipmentResearchState(save, savePath);
        console.log(`\n======================== [모든 장비 연구·개발(R&D) 최대치 완료] ========================`);
        console.log(`장비 연구 완료: ${formatNumber(researchState.existingCount)}개 항목 등록됨 (전체 356개 계보 / 1,262종 장비)`);
        if (researchState.isMaxed) {
          console.log('\n[안내] 모든 장비 연구·개발(R&D)이 이미 최대치까지 완료돼 있습니다.');
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, '모든 장비(1,262종)의 연구·개발(R&D) 및 최종 한계돌파 강화를 최대치로 완료할까요?')) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeEquipmentResearchMaximum(savePath, save);
        console.log('\n[성공] 모든 장비 연구·개발(R&D) 최대 업그레이드가 성공적으로 완료되었습니다.');
        console.log(`- 대상 장비: 총 ${formatNumber(result.totalPartCount)}종 (356개 계보 전체)`);
        console.log(`- 등록된 연구 단계: 총 ${formatNumber(result.totalEntries)}개 (신규 추가/갱신 ${formatNumber(result.addedCount)}개)`);
        console.log('- 최종 한계돌파(최대 +24강) 및 각 티어 최대 강화 완료');
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '10') {
        const definition = getKamasResearchDefinition(savePath);
        const state = getKamasResearchState(
          save,
          definition.maximumInternalLevel,
          definition.limitBreakStart,
        );
        console.log(`\n===================== [KAMAS-A1 어설트 라이플 RE 최대 강화] =====================`);
        console.log(`현재 완료: +${state.completedDisplayLevel} 완료`);
        if (state.currentDisplayLevel > state.completedDisplayLevel) {
          console.log(`현재 연구 중: +${state.currentDisplayLevel}`);
        }
        console.log(`DB 최대 강화: +${definition.maximumDisplayLevel}`);
        if (state.completedDisplayLevel >= definition.maximumDisplayLevel) {
          console.log(`\n[안내] 이미 KAMAS RE 연구가 최대 +${definition.maximumDisplayLevel}입니다.`);
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, `연구를 최대 +${definition.maximumDisplayLevel} 완료 상태로 변경할까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeKamasResearchMaximum(savePath, save);
        if (!result.changed) {
          console.log(`\n[안내] 이미 KAMAS RE 연구가 최대 +${definition.maximumDisplayLevel}입니다.`);
        } else {
          console.log('\n[성공] KAMAS-A1 어설트 라이플 RE 최대 연구가 성공적으로 완료되었습니다.');
          console.log(`- 연구 완료 등급: +${result.maximumDisplayLevel}`);
          console.log(`- 세이브 백업: ${result.backupPath}`);
        }
      } else if (choice === '11') {
        const masteryState = getWeaponMasteryState(save);
        console.log(`\n========================== [모든 무기 숙련도 최대 업그레이드] ==========================`);
        console.log(`무기 숙련도(Lv.20): ${formatNumber(masteryState.maxLevelCount)} / ${formatNumber(masteryState.totalCount)}종`);
        if (masteryState.isMaxed) {
          console.log('\n[안내] 모든 무기 숙련도가 이미 최대(Lv.20)입니다.');
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, `모든 무기 숙련도(${formatNumber(masteryState.totalCount)}종)를 최대 Lv.20으로 업그레이드할까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeWeaponMasteriesMaximum(savePath, save);
        console.log('\n[성공] 모든 무기 숙련도 최대 업그레이드가 성공적으로 완료되었습니다.');
        console.log(`- 무기 숙련도 ${formatNumber(result.upgradedCount)}종 Lv.20 최대치 적용 (전체 57종 달성)`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '12') {
        const state = getLimitedRecipeState(save);
        console.log('\n====================== [Steam용 기간 한정 레시피 해금] ======================');
        console.log(`현재 해금 현황: ${formatNumber(state.ownedIds.length)} / ${formatNumber(LIMITED_RECIPE_DEFINITION_COUNT)}종 (미보유: ${formatNumber(state.missingIds.length)}종)`);
        console.log('----------------------------------------------------------------------------------');
        if (state.missingIds.length === 0) {
          console.log('\n[안내] Steam용 기간 한정 레시피 25종이 이미 모두 해금되어 있습니다.');
          await pause(rl);
          continue;
        }
        console.log(`미보유 기간 한정 레시피 ${formatNumber(state.missingIds.length)}종을 설계도 습득 상태로 추가합니다.`);
        if (!await confirm(rl, `미보유 레시피 ${formatNumber(state.missingIds.length)}종을 모두 해금할까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeLimitedRecipes(savePath, save);
        console.log('\n[성공] Steam용 기간 한정 레시피 해금이 성공적으로 완료되었습니다.');
        console.log(`- 추가된 레시피: ${formatNumber(result.addedCount)}종`);
        console.log(`- 해금 목록: ${formatNumber(result.previousOwnedCount)} → ${formatNumber(result.currentOwnedCount)}종 (총 ${formatNumber(LIMITED_RECIPE_DEFINITION_COUNT)}종 완료)`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '13') {
        const definition = getAllRecipeDefinitions(savePath);
        const state = getRecipeUnlockState(save, definition.ids, 'Steam용 전체 레시피');
        console.log('\n======================== [Steam용 모든 레시피 전체 해금] ========================');
        console.log(`현재 해금 현황: ${formatNumber(state.ownedIds.length)} / ${formatNumber(ALL_RECIPE_DEFINITION_COUNT)}종 (미보유: ${formatNumber(state.missingIds.length)}종)`);
        console.log('----------------------------------------------------------------------------------');
        if (state.missingIds.length === 0) {
          console.log('\n[안내] Steam용 모든 레시피 356종이 이미 모두 해금되어 있습니다.');
          await pause(rl);
          continue;
        }
        console.log(`미보유 전체 레시피 ${formatNumber(state.missingIds.length)}종을 설계도 습득 상태로 추가합니다.`);
        if (!await confirm(rl, `미보유 레시피 ${formatNumber(state.missingIds.length)}종을 모두 해금할까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeAllRecipes(savePath, save);
        console.log('\n[성공] Steam용 모든 레시피 해금이 성공적으로 완료되었습니다.');
        console.log(`- 추가된 레시피: ${formatNumber(result.addedCount)}종`);
        console.log(`- 해금 목록: ${formatNumber(result.previousOwnedCount)} → ${formatNumber(result.currentOwnedCount)}종 (총 ${formatNumber(ALL_RECIPE_DEFINITION_COUNT)}종 완료)`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '14') {
        const definition = getSteamDecalDefinitions(savePath);
        const currentStock = getDecalStockSummary(save, definition.ids);
        console.log('\n============================ [Steam용 전체 데칼 지급] ============================');
        console.log(`현재 보유 데칼: ${formatNumber(currentStock.typeCount)} / ${formatNumber(STEAM_DECAL_DEFINITION_COUNT)}종`);
        if (!await confirm(rl, `Steam용 전체 데칼 ${formatNumber(STEAM_DECAL_DEFINITION_COUNT)}종을 각각 한 장씩 추가할까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeAllDecals(savePath, save);
        console.log('\n[성공] Steam용 전체 데칼 지급이 성공적으로 완료되었습니다.');
        console.log(`- 지급 수량: ${formatNumber(result.addedCount)}장 (신규 ${formatNumber(result.newTypes)}종 / 기존 수량 증가 ${formatNumber(result.incrementedTypes)}종)`);
        console.log(`- 데칼 소유 목록: ${formatNumber(result.previousStockCount)} → ${formatNumber(result.currentStockCount)}종`);
        if (result.removedHistoryCount > 0) console.log(`- 잘못 추가됐던 뽑기 이력 ${formatNumber(result.removedHistoryCount)}개 정리`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '15') {
        const slots = getCoinLockerSlots(save);
        const emptySlots = slots.filter((entry) => entry.type === -1 && entry.eid === '');
        const maxPerBeast = Math.floor(emptySlots.length / GOLDEN_BEAST_IDS.length);
        const goldenBeasts = getGoldenBeastSummary(save);

        console.log('\n======================== [황금동물 전체 11종 보관함 지급] ========================');
        console.log(`코인 보관함: 총 ${formatNumber(slots.length)}칸 중 빈칸 ${formatNumber(emptySlots.length)}개`);
        console.log(`현재 보관 중인 황금동물: ${formatNumber(goldenBeasts.count)}마리 (${formatNumber(goldenBeasts.typeCount)}/${GOLDEN_BEAST_IDS.length}종)`);
        if (maxPerBeast < 1) {
          console.log('\n[안내] 코인 보관함에 빈칸이 11칸 미만(최소 1세트)이어서 황금동물을 추가할 수 없습니다.');
          await pause(rl);
          continue;
        }
        console.log(`※ 보관함 빈칸 기준 11종을 최대 ${formatNumber(maxPerBeast)}마리씩 (총 ${formatNumber(maxPerBeast * GOLDEN_BEAST_IDS.length)}마리) 지급 가능합니다.`);

        const input = (await rl.question(`\n황금동물 11종을 각각 몇 마리씩 지급할까요? (기본값: 1, 최대: ${maxPerBeast}, 0=취소): `)).trim();
        if (input === '0') {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const count = input === '' ? 1 : Number(input);
        if (!Number.isInteger(count) || count < 1 || count > maxPerBeast) {
          console.log(`\n[오류] 1 ~ ${maxPerBeast} 사이의 정수를 입력해야 합니다.`);
          await pause(rl);
          continue;
        }

        if (!await confirm(rl, `황금동물 11종을 각각 ${count}마리씩 (총 ${count * GOLDEN_BEAST_IDS.length}마리) 코인 보관함에 추가할까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeGoldenBeasts(savePath, save, count);
        console.log('\n[성공] 황금동물 보관함 지급이 성공적으로 완료되었습니다!');
        console.log(`- 지급 수량: 황금동물 전체 11종 x 각 ${formatNumber(count)}마리 (총 ${formatNumber(result.addedCount)}마리)`);
        console.log(`- 동물 목록: ${formatNumber(result.previousBeastCount)} → ${formatNumber(result.currentBeastCount)}마리 (+${formatNumber(result.addedCount)})`);
        console.log(`- 보관함 빈칸: ${formatNumber(result.previousEmptySlots)} → ${formatNumber(result.currentEmptySlots)}개 (-${formatNumber(result.addedCount)})`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '16') {
        const shop = getBloodniumShopState(save);
        console.log('\n=========================== [블러드늄 상점 구매 재고 복구] ===========================');
        console.log(`현재 상태: 구매 가능 ${formatNumber(shop.available.length)}개 / 구매 완료 ${formatNumber(shop.bought.length)}개`);
        if (shop.bought.length === 0) {
          console.log('\n[안내] 복구할 블러드늄 상점 구매 완료 재고가 없습니다. (모든 상품 구매 가능 상태)');
          await pause(rl);
          continue;
        }
        if (!await confirm(rl, `구매 완료 ${formatNumber(shop.bought.length)}개를 구매 가능 상태로 되돌릴까요?`)) {
          console.log('\n[안내] 작업이 취소되었습니다.');
          await pause(rl);
          continue;
        }
        const result = writeBloodniumShopReset(savePath, save);
        console.log('\n[성공] 블러드늄 상점 구매 재고 복구가 성공적으로 완료되었습니다.');
        console.log(`- 복구 수량: ${formatNumber(result.restoredCount)}개`);
        console.log(`- 현재 구매 가능: ${formatNumber(result.availableCount)}개`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      } else if (choice === '17') {
        const status = getCollisionMushroomStatus(savePath);
        console.log(`\n마스터 DB: ${status.databasePath}`);
        console.log(`충돌버섯: ${formatNumber(status.rows[0].tmmin)}초`);
        console.log(`구운 충돌버섯: ${formatNumber(status.rows[1].tmmin)}초`);
        const is30m = status.rows.every((row) =>
          row.tmmin === COLLISION_MUSHROOM_DURATION_SECONDS &&
          row.tmmax === COLLISION_MUSHROOM_DURATION_SECONDS);

        if (is30m) {
          console.log('현재 30분(1,800초) 지속시간이 적용돼 있습니다.');
          if (!await confirm(rl, '기본 상태(일반 30초 / 구운 것 40초)로 복구(토글)할까요?')) continue;
          const result = restoreCollisionMushroomDefault(savePath);
          console.log('\n[성공] 충돌버섯·구운 충돌버섯 기본 지속시간 복구가 성공적으로 완료되었습니다.');
          console.log('- 지속시간: 30분 (1,800초) → 일반 30초 / 구운 것 40초 (기본값 복구)');
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else {
          if (!await confirm(rl, '두 효과를 모두 1,800초(30분)로 변경할까요?')) continue;
          const result = setCollisionMushroomThirtyMinutes(savePath);
          console.log('\n[성공] 충돌버섯·구운 충돌버섯 지속시간 변경이 성공적으로 완료되었습니다.');
          console.log(`- 지속시간: 일반 ${formatNumber(status.rows[0].tmmin)}초 / 구운 것 ${formatNumber(status.rows[1].tmmin)}초 → 30분 (1,800초)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        }
      } else if (choice === '18') {
        const status = getUltimateFighterReturnStatus(savePath);
        const currentPercent = status.row.val0;
        const currentRatio = (currentPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
        console.log(`\n마스터 DB: ${status.databasePath}`);
        console.log(`궁극 파이터의 귀환 (Ultimate Fighter Return):`);
        console.log(`- 현재 효과: 모든 기본 능력치 +${formatNumber(currentPercent)}% (기본 20% 대비 ${currentRatio}배)`);
        console.log('\n수정 방식을 선택하세요:');
        console.log('1. 퍼센트(%) 직접 입력 (예: 50 입력 시 +50%, 100 입력 시 +100%)');
        console.log('2. 배율(배)로 입력 (기본 20% 기준, 예: 5 입력 시 5배인 +100%, 10 입력 시 10배인 +200%)');
        console.log('3. 5배(+100%) 바로 적용');
        console.log('4. 기본값(+20%)으로 복구');
        console.log('0. 뒤로 가기');

        const subChoice = (await rl.question('\n선택 (기본값 0): ')).trim();
        if (subChoice === '1') {
          const input = (await rl.question(`\n설정할 증가 퍼센트(%)를 입력하세요 (현재: +${currentPercent}%): `)).trim();
          if (!input) continue;
          const targetPercent = Number(input.replace(/[%]/g, ''));
          if (!Number.isInteger(targetPercent) || targetPercent < 1 || targetPercent > 1_000_000) {
            console.log('오류: 1 ~ 1,000,000 사이의 정수를 입력해야 합니다.');
            continue;
          }
          if (targetPercent === currentPercent) {
            console.log(`이미 +${formatNumber(currentPercent)}%가 적용되어 있습니다.`);
            continue;
          }
          const targetRatio = (targetPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
          if (!await confirm(rl, `궁극 파이터의 귀환 효과를 +${formatNumber(targetPercent)}% (${targetRatio}배)로 변경할까요?`)) continue;
          const result = setUltimateFighterReturnPercent(savePath, targetPercent);
          console.log('\n[성공] 궁극 파이터의 귀환 효과 변경이 성공적으로 완료되었습니다!');
          console.log(`- 모든 기본 능력치 증가: +${formatNumber(currentPercent)}% → +${formatNumber(result.row.val0)}% (${targetRatio}배)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else if (subChoice === '2') {
          const input = (await rl.question(`\n설정할 배율을 입력하세요 (기본 20% 기준, 현재: ${currentRatio}배): `)).trim();
          if (!input) continue;
          const multiplier = Number(input.replace(/[x배X]/g, ''));
          if (isNaN(multiplier) || multiplier <= 0 || multiplier > 50000) {
            console.log('오류: 0보다 크고 50,000 이하의 숫자를 입력해야 합니다.');
            continue;
          }
          const targetPercent = Math.round(ULTIMATE_FIGHTER_RETURN_BASE_PERCENT * multiplier);
          if (targetPercent === currentPercent) {
            console.log(`이미 +${formatNumber(currentPercent)}% (${multiplier}배)가 적용되어 있습니다.`);
            continue;
          }
          if (!await confirm(rl, `궁극 파이터의 귀환 효과를 ${multiplier}배인 +${formatNumber(targetPercent)}%로 변경할까요?`)) continue;
          const result = setUltimateFighterReturnPercent(savePath, targetPercent);
          console.log('\n[성공] 궁극 파이터의 귀환 효과 변경이 성공적으로 완료되었습니다!');
          console.log(`- 모든 기본 능력치 증가: +${formatNumber(currentPercent)}% → +${formatNumber(result.row.val0)}% (${multiplier}배)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else if (subChoice === '3') {
          if (currentPercent === ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT) {
            console.log('이미 5배(+100%) 효과가 적용되어 있습니다.');
            continue;
          }
          if (!await confirm(rl, '효과를 5배인 +100%로 변경할까요?')) continue;
          const result = setUltimateFighterReturnFiveTimes(savePath);
          console.log('\n[성공] 궁극 파이터의 귀환 효과 변경이 성공적으로 완료되었습니다!');
          console.log(`- 모든 기본 능력치 증가: +${formatNumber(currentPercent)}% → +100% (5배)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else if (subChoice === '4') {
          if (currentPercent === ULTIMATE_FIGHTER_RETURN_BASE_PERCENT) {
            console.log('이미 기본 상태(+20%)입니다.');
            continue;
          }
          if (!await confirm(rl, '기본 상태(+20%)로 복구할까요?')) continue;
          const result = restoreUltimateFighterReturn(savePath);
          console.log('\n[성공] 궁극 파이터의 귀환 기본 효과 복구가 성공적으로 완료되었습니다!');
          console.log(`- 모든 기본 능력치 증가: +${formatNumber(currentPercent)}% → +20% (기본값 복구)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else {
          continue;
        }
      } else if (choice === '19') {
        const status = getQueenOfSpadesStatus(savePath);
        const currentPercent = status.row.val0;
        const currentRatio = (currentPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
        console.log(`\n마스터 DB: ${status.databasePath}`);
        console.log(`스페이드 여왕 (Queen of Spades) 데칼:`);
        console.log(`- 현재 효과: 공격력 +${formatNumber(currentPercent)}% (기본 30% 대비 ${currentRatio}배)`);
        console.log(`- 기타 효과: 치명타 확률 +${formatNumber(status.row.val1)}% / 피해 무효화 ${formatNumber(status.row.val2)}% (기본 유지)`);
        console.log('※ 주의: 공격력이 지나치게 높으면(수십만 이상 단일 대미지) 엔진의 32비트 연산 오버플로로');
        console.log('   인해 레이지 게이지가 충전되지 않을 수 있으므로 +5,000% 이하로 안전하게 설정하는 것을 권장합니다.');
        console.log('\n수정 방식을 선택하세요:');
        console.log('1. 퍼센트(%) 직접 입력 (1 ~ 5,000% 안전 한도)');
        console.log('2. 배율(배)로 입력 (기본 30% 기준, 최대 166배)');
        console.log(`3. 극단 공격력(+${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%) 바로 적용 (오버플로 방지 안전 극대치)`);
        console.log(`4. 기본값(+${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}%)으로 복구`);
        console.log('0. 뒤로 가기');

        const subChoice = (await rl.question('\n선택 (기본값 0): ')).trim();
        if (subChoice === '1') {
          const input = (await rl.question(`\n설정할 공격력 증가 퍼센트(%)를 입력하세요 (현재: +${currentPercent}%, 권장최대: 5000): `)).trim();
          if (!input) continue;
          const targetPercent = Number(input.replace(/[%]/g, ''));
          if (!Number.isInteger(targetPercent) || targetPercent < 1 || targetPercent > 5_000) {
            console.log('오류: 1 ~ 5,000 사이의 정수를 입력해야 합니다. (32비트 연산 오버플로 방지 안전 한도)');
            continue;
          }
          if (targetPercent === currentPercent) {
            console.log(`이미 +${formatNumber(currentPercent)}%가 적용되어 있습니다.`);
            continue;
          }
          const targetRatio = (targetPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
          if (!await confirm(rl, `스페이드 여왕 공격력을 +${formatNumber(targetPercent)}% (${targetRatio}배)로 변경할까요?`)) continue;
          const result = setQueenOfSpadesPercent(savePath, targetPercent);
          console.log('\n[성공] 스페이드 여왕 공격력 효과 변경이 성공적으로 완료되었습니다!');
          console.log(`- 공격력 증가: +${formatNumber(currentPercent)}% → +${formatNumber(result.row.val0)}% (${targetRatio}배)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else if (subChoice === '2') {
          const input = (await rl.question(`\n설정할 배율을 입력하세요 (기본 30% 기준, 현재: ${currentRatio}배, 최대 166배): `)).trim();
          if (!input) continue;
          const multiplier = Number(input.replace(/[x배X]/g, ''));
          if (isNaN(multiplier) || multiplier <= 0 || multiplier > 166) {
            console.log('오류: 0보다 크고 166 이하의 숫자를 입력해야 합니다.');
            continue;
          }
          const targetPercent = Math.round(QUEEN_OF_SPADES_BASE_ATTACK_PERCENT * multiplier);
          if (targetPercent === currentPercent) {
            console.log(`이미 +${formatNumber(currentPercent)}% (${multiplier}배)가 적용되어 있습니다.`);
            continue;
          }
          if (!await confirm(rl, `스페이드 여왕 공격력을 ${multiplier}배인 +${formatNumber(targetPercent)}%로 변경할까요?`)) continue;
          const result = setQueenOfSpadesPercent(savePath, targetPercent);
          console.log('\n[성공] 스페이드 여왕 공격력 효과 변경이 성공적으로 완료되었습니다!');
          console.log(`- 공격력 증가: +${formatNumber(currentPercent)}% → +${formatNumber(result.row.val0)}% (${multiplier}배)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else if (subChoice === '3') {
          if (currentPercent === QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT) {
            console.log(`이미 극단 공격력(+${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%)이 적용되어 있습니다.`);
            continue;
          }
          if (!await confirm(rl, `공격력을 오버플로 방지 안전 극대치인 +${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%로 변경할까요?`)) continue;
          const result = setQueenOfSpadesExtremeDamage(savePath);
          console.log('\n[성공] 스페이드 여왕 공격력 변경이 성공적으로 완료되었습니다!');
          console.log(`- 공격력 증가: +${formatNumber(currentPercent)}% → +${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else if (subChoice === '4') {
          if (currentPercent === QUEEN_OF_SPADES_BASE_ATTACK_PERCENT) {
            console.log(`이미 기본 상태(+${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}%)입니다.`);
            continue;
          }
          if (!await confirm(rl, `기본 상태(+${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}%)로 복구할까요?`)) continue;
          const result = restoreQueenOfSpades(savePath);
          console.log('\n[성공] 스페이드 여왕 기본 효과 복구가 성공적으로 완료되었습니다!');
          console.log(`- 공격력 증가: +${formatNumber(currentPercent)}% → +${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}% (기본값 복구)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else {
          continue;
        }
      } else if (choice === '20') {
        const status = getWolfRageStatus(savePath);
        const superPercent = status.superWolf.val0;
        const madPercent = status.madWolf.val0;
        console.log(`\n마스터 DB: ${status.databasePath}`);
        console.log('울프 계열 데칼 (분노/레이지 게이지 축적 속도):');
        console.log(`- 슈퍼 울프 (SKL_RGSPDUP_02_P): +${formatNumber(superPercent)}% (기본값: +80%)`);
        console.log(`- 매드 울프 (SKL_RGSPUP_RDURDOWN_01_P): +${formatNumber(madPercent)}% (기본값: +120%)`);
        console.log('※ 단일 타격 대미지가 수십만을 초과할 때 발생하는 32비트 연산 오버플로 시에도');
        console.log('   울프 데칼의 레이지 축적 속도를 +1,000%로 설정하면 스치기만 해도 게이지가 1~2칸씩 즉시 충전됩니다.');
        console.log('\n수정 방식을 선택하세요:');
        console.log(`1. 레이지 축적 속도 +${formatNumber(WOLF_RAGE_TARGET_PERCENT)}% 바로 적용 (적 피격 시 게이지 즉시 충전)`);
        console.log('2. 축적 속도 퍼센트(%) 직접 입력 (1 ~ 50,000%)');
        console.log('3. 기본값 복구 (슈퍼 울프 +80% / 매드 울프 +120%)');
        console.log('0. 뒤로 가기');

        const subChoice = (await rl.question('\n선택 (기본값 0): ')).trim();
        if (subChoice === '1') {
          if (status.isBoosted) {
            console.log(`\n이미 두 데칼 모두 +${formatNumber(WOLF_RAGE_TARGET_PERCENT)}% 이상으로 적용되어 있습니다.`);
          } else {
            if (!await confirm(rl, `슈퍼 울프와 매드 울프의 레이지 축적 속도를 +${formatNumber(WOLF_RAGE_TARGET_PERCENT)}%로 변경할까요?`)) continue;
            const result = setWolfRagePercent(savePath, WOLF_RAGE_TARGET_PERCENT);
            console.log('\n[성공] 울프 계열 레이지 축적 속도 +1,000% 변경이 성공적으로 완료되었습니다!');
            console.log(`- 슈퍼 울프: +${formatNumber(superPercent)}% → +${formatNumber(result.superWolf.val0)}%`);
            console.log(`- 매드 울프: +${formatNumber(madPercent)}% → +${formatNumber(result.madWolf.val0)}%`);
            console.log(`- 마스터 DB 백업: ${result.backupPath}`);
          }
        } else if (subChoice === '2') {
          const input = (await rl.question('\n설정할 레이지 축적 속도 퍼센트(%)를 입력하세요 (기본 권장: 1000): ')).trim();
          if (!input) continue;
          const targetPercent = Number(input.replace(/[%]/g, ''));
          if (!Number.isInteger(targetPercent) || targetPercent < 1 || targetPercent > 50_000) {
            console.log('오류: 1 ~ 50,000 사이의 정수를 입력해야 합니다.');
            continue;
          }
          if (superPercent === targetPercent && madPercent === targetPercent) {
            console.log(`\n이미 두 데칼 모두 +${formatNumber(targetPercent)}%가 적용되어 있습니다.`);
            continue;
          }
          if (!await confirm(rl, `슈퍼 울프와 매드 울프의 레이지 축적 속도를 +${formatNumber(targetPercent)}%로 변경할까요?`)) continue;
          const result = setWolfRagePercent(savePath, targetPercent);
          console.log('\n[성공] 울프 계열 레이지 축적 속도 변경이 성공적으로 완료되었습니다!');
          console.log(`- 슈퍼 울프: +${formatNumber(superPercent)}% → +${formatNumber(result.superWolf.val0)}%`);
          console.log(`- 매드 울프: +${formatNumber(madPercent)}% → +${formatNumber(result.madWolf.val0)}%`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else if (subChoice === '3') {
          if (superPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P &&
              madPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P) {
            console.log('\n이미 두 데칼 모두 기본값(80% / 120%) 상태입니다.');
            continue;
          }
          if (!await confirm(rl, '울프 계열 데칼의 레이지 축적 속도를 기본값(80% / 120%)으로 복구할까요?')) continue;
          const result = restoreWolfRageDefault(savePath);
          console.log('\n[성공] 울프 계열 레이지 축적 속도 기본값 복구가 성공적으로 완료되었습니다!');
          console.log(`- 슈퍼 울프: +${formatNumber(superPercent)}% → +${formatNumber(result.superWolf.val0)}% (기본값: +80%)`);
          console.log(`- 매드 울프: +${formatNumber(madPercent)}% → +${formatNumber(result.madWolf.val0)}% (기본값: +120%)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        } else {
          continue;
        }
      } else if (choice === '21') {
        const status = getEquipmentMaterialStatus(savePath);
        console.log(`\n마스터 DB: ${status.databasePath}`);
        console.log(`장비 연구 정의: ${formatNumber(status.rowCount)}종`);
        console.log(`재료가 필요한 정의: ${formatNumber(status.nonZeroRows)}종 / 수량 항목 ${formatNumber(status.nonZeroCells)}개`);
        if (!await confirm(rl, '모든 장비의 개발·강화 재료 수량을 0으로 변경할까요?')) continue;
        const result = setEquipmentMaterialsFree(savePath);
        if (!result.changed) {
          console.log('\n이미 모든 장비 개발·강화 재료 수량이 0입니다.');
        } else {
          console.log('\n[성공] 장비 개발·강화 재료 무료화가 성공적으로 완료되었습니다.');
          console.log(`- 장비 ${formatNumber(result.rowCount)}종의 개발·강화 재료 비용 제거`);
          console.log('- 킬코인·스피리튬 비용과 연구 시간은 유지됩니다.');
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        }
      } else if (choice === '22') {
        const backups = listEquipmentMaterialBackups();
        if (backups.length === 0) {
          console.log('\n복원할 장비 재료 비용 전용 백업이 없습니다.');
          continue;
        }
        const sourcePath = backups[0];
        const sourceSummary = summarizeEquipmentMaterialRows(readEquipmentMaterialRows(sourcePath));
        console.log(`\n복원 대상: ${sourcePath}`);
        console.log(`백업의 재료 필요 정의: ${formatNumber(sourceSummary.nonZeroRows)}종 / 수량 항목 ${formatNumber(sourceSummary.nonZeroCells)}개`);
        if (!await confirm(rl, '이 백업의 장비 재료 수량만 복원할까요?')) continue;
        const result = restoreEquipmentMaterials(savePath, sourcePath);
        console.log('\n[성공] 장비 재료 비용 복원이 성공적으로 완료되었습니다.');
        console.log(`- 복원 완료: 장비 재료 비용 ${formatNumber(result.nonZeroRows)}종`);
        console.log(`- 복원 전 안전 백업: ${result.safetyBackup}`);
      } else if (choice === '23') {
        if (isGameRunning()) {
          console.log('\nLET IT DIE를 완전히 종료한 뒤 백업하세요.');
          continue;
        }
        const backupPath = createBackup(savePath, save.packed);
        console.log('\n[성공] 현재 세이브 백업이 성공적으로 완료되었습니다.');
        console.log(`- 백업 파일: ${backupPath}`);
      } else if (choice === '24') {
        const backups = listBackups(savePath);
        if (backups.length === 0) {
          console.log('\n복원할 백업이 없습니다.');
          continue;
        }
        const latest = backups[0];
        const backupSave = readSave(latest);
        console.log(`\n최신 백업: ${latest}`);
        printResourceValues(backupSave, '백업 ');
        if (!await confirm(rl, '이 백업으로 복원할까요?')) continue;
        const result = restoreBackup(savePath, latest);
        console.log('\n[성공] 백업 복원이 성공적으로 완료되었습니다.');
        for (const [resourceKey, value] of Object.entries(result.restoredResources)) {
          console.log(`- ${RESOURCES[resourceKey].label}: ${formatNumber(value)}`);
        }
        console.log(`- 복원 전 안전 백업: ${result.safetyBackup}`);
      } else {
        console.log('\n잘못된 선택입니다.');
        continue;
      }

      await pause(rl);
    } catch (error) {
    const logFile = writeErrorLog(error, {
      mode: 'interactive',
      choice,
      savePath,
    });
    console.error(`\n오류: ${error.message}`);
    if (logFile) console.error(`오류 로그 저장됨: ${logFile}`);
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
        console.log(`주의: ${resource.label}의 알려진 한도 ${formatNumber(capacity)}을 초과합니다.`);
      }
      if (!parsed.yes && !await confirm(rl, `${resource.label}을 ${formatNumber(amount)}(으)로 변경할까요?`)) return;
      const result = writeChangedSave(savePath, save, resourceKey, amount);
      console.log(`\n[성공] ${resource.label} 변경이 성공적으로 완료되었습니다.`);
      console.log(`- 설정 값: ${formatNumber(amount)}`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'max') {
      const resourceKey = parsed.args[1] ? getResourceKey(parsed.args[1]) : 'killcoins';
      const resource = RESOURCES[resourceKey];
      const amount = getKnownCapacity(save, resourceKey);
      if (!amount) fail(`${resource.label}의 알려진 한도 정보가 없습니다.`);
      printStatus(savePath, save);
      if (!parsed.yes && !await confirm(rl, `${resource.label}을 ${formatNumber(amount)}(으)로 변경할까요?`)) return;
      const result = writeChangedSave(savePath, save, resourceKey, amount);
      console.log(`\n[성공] ${resource.label} 최대 한도 충전이 성공적으로 완료되었습니다.`);
      console.log(`- 설정 값: ${formatNumber(amount)}`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'backup') {
      if (isGameRunning()) fail('LET IT DIE를 완전히 종료한 뒤 백업하세요.');
      printStatus(savePath, save);
      const backupPath = createBackup(savePath, save.packed);
      console.log(`\n[성공] 세이브 백업이 성공적으로 완료되었습니다.`);
      console.log(`- 백업 파일: ${backupPath}`);
      return;
    }
    if (command === 'reset-shop') {
      const shop = getBloodniumShopState(save);
      printStatus(savePath, save);
      if (shop.bought.length === 0) fail('복구할 블러드늄 상점 구매 완료 재고가 없습니다.');
      if (!parsed.yes && !await confirm(rl, `구매 완료 ${formatNumber(shop.bought.length)}개를 구매 가능 상태로 되돌릴까요?`)) return;
      const result = writeBloodniumShopReset(savePath, save);
      console.log('\n[성공] 블러드늄 상점 구매 재고 복구가 성공적으로 완료되었습니다.');
      console.log(`- 복구 수량: ${formatNumber(result.restoredCount)}개`);
      console.log(`- 현재 구매 가능: ${formatNumber(result.availableCount)}개`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'grant-all-decals' || command === 'grant-five-star-all') {
      printStatus(savePath, save);
      if (!parsed.yes && !await confirm(rl, `Steam용 전체 데칼 ${formatNumber(STEAM_DECAL_DEFINITION_COUNT)}종을 각각 한 장씩 추가할까요?`)) return;
      const result = writeAllDecals(savePath, save);
      console.log('\n[성공] Steam용 전체 데칼 지급이 성공적으로 완료되었습니다.');
      console.log(`- 지급 수량: ${formatNumber(result.addedCount)}장 (신규 ${formatNumber(result.newTypes)}종 / 기존 수량 증가 ${formatNumber(result.incrementedTypes)}종)`);
      console.log(`- 데칼 소유 목록: ${formatNumber(result.previousStockCount)} → ${formatNumber(result.currentStockCount)}종`);
      if (result.removedHistoryCount > 0) console.log(`- 잘못 추가됐던 뽑기 이력 ${formatNumber(result.removedHistoryCount)}개 정리`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
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
          fail('오류: 황금동물 지급 수량은 1 이상의 정수여야 합니다.');
        }
        count = raw;
      }

      if (maxPerBeast < 1) {
        fail('오류: 코인 보관함의 빈칸이 부족합니다 (최소 11칸 필요).');
      }
      if (count > maxPerBeast) {
        fail(`오류: 보관함 빈칸(${emptySlots.length}칸)이 부족합니다. 최대 ${maxPerBeast}마리(총 ${maxPerBeast * GOLDEN_BEAST_IDS.length}마리)까지 지급 가능합니다.`);
      }

      console.log(`\n황금동물 지급 설정: 전체 11종 x 각 ${count}마리 (총 ${count * GOLDEN_BEAST_IDS.length}마리)`);
      if (!parsed.yes && !await confirm(rl, `황금동물 11종을 각각 ${count}마리씩 (총 ${count * GOLDEN_BEAST_IDS.length}마리) 코인 보관함에 추가할까요?`)) return;
      const result = writeGoldenBeasts(savePath, save, count);
      console.log('\n[성공] 황금동물 보관함 지급이 성공적으로 완료되었습니다!');
      console.log(`- 지급 수량: 황금동물 전체 11종 x 각 ${formatNumber(count)}마리 (총 ${formatNumber(result.addedCount)}마리)`);
      console.log(`- 동물 목록: ${formatNumber(result.previousBeastCount)} → ${formatNumber(result.currentBeastCount)}마리 (+${formatNumber(result.addedCount)})`);
      console.log(`- 보관함 빈칸: ${formatNumber(result.previousEmptySlots)} → ${formatNumber(result.currentEmptySlots)}개 (-${formatNumber(result.addedCount)})`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'grant-limited-recipes') {
      printStatus(savePath, save);
      const state = getLimitedRecipeState(save);
      if (state.missingIds.length === 0) {
        console.log('Steam용 기간 한정 레시피가 이미 모두 해금돼 있습니다.');
        return;
      }
      if (!parsed.yes && !await confirm(rl, `없는 기간 한정 레시피 ${formatNumber(state.missingIds.length)}종을 설계도 습득 상태로 추가할까요?`)) return;
      const result = writeLimitedRecipes(savePath, save);
      console.log('\n[성공] Steam용 기간 한정 레시피 해금이 성공적으로 완료되었습니다.');
      console.log(`- 추가된 레시피: ${formatNumber(result.addedCount)}종`);
      console.log(`- 해금 목록: ${formatNumber(result.previousOwnedCount)} → ${formatNumber(result.currentOwnedCount)}종`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'grant-all-recipes') {
      printStatus(savePath, save);
      const definition = getAllRecipeDefinitions(savePath);
      const state = getRecipeUnlockState(save, definition.ids, 'Steam용 전체 레시피');
      console.log(`모든 레시피: ${formatNumber(state.ownedIds.length)}/${formatNumber(ALL_RECIPE_DEFINITION_COUNT)}종 해금`);
      if (state.missingIds.length === 0) {
        console.log('Steam용 모든 레시피가 이미 해금돼 있습니다.');
        return;
      }
      if (!parsed.yes && !await confirm(rl, `없는 전체 레시피 ${formatNumber(state.missingIds.length)}종을 설계도 습득 상태로 추가할까요?`)) return;
      const result = writeAllRecipes(savePath, save);
      console.log('\n[성공] Steam용 모든 레시피 해금이 성공적으로 완료되었습니다.');
      console.log(`- 추가된 레시피: ${formatNumber(result.addedCount)}종`);
      console.log(`- 해금 목록: ${formatNumber(result.previousOwnedCount)} → ${formatNumber(result.currentOwnedCount)}종`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'collision-30m' || command === 'collision-restore') {
      const status = getCollisionMushroomStatus(savePath);
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`현재 지속시간: 일반 ${formatNumber(status.rows[0].tmmin)}초 / 구운 것 ${formatNumber(status.rows[1].tmmin)}초`);
      const is30m = status.rows.every((row) =>
        row.tmmin === COLLISION_MUSHROOM_DURATION_SECONDS &&
        row.tmmax === COLLISION_MUSHROOM_DURATION_SECONDS);

      if (command === 'collision-restore' || is30m) {
        if (!is30m) {
          console.log('이미 기본 상태(일반 30초 / 구운 것 40초)입니다.');
          return;
        }
        console.log('이미 30분(1,800초) 지속시간이 적용돼 있습니다.');
        if (!parsed.yes && !await confirm(rl, '기본 상태(일반 30초 / 구운 것 40초)로 복구(토글)할까요?')) return;
        const result = restoreCollisionMushroomDefault(savePath);
        console.log('\n[성공] 충돌버섯·구운 충돌버섯 기본 지속시간 복구가 성공적으로 완료되었습니다.');
        console.log('- 지속시간: 30분 (1,800초) → 일반 30초 / 구운 것 40초 (기본값 복구)');
        console.log(`- 마스터 DB 백업: ${result.backupPath}`);
      } else {
        if (!parsed.yes && !await confirm(rl, '두 효과를 모두 1,800초(30분)로 변경할까요?')) return;
        const result = setCollisionMushroomThirtyMinutes(savePath);
        console.log('\n[성공] 충돌버섯·구운 충돌버섯 지속시간 변경이 성공적으로 완료되었습니다.');
        console.log(`- 지속시간: 일반 ${formatNumber(status.rows[0].tmmin)}초 / 구운 것 ${formatNumber(status.rows[1].tmmin)}초 → 30분 (1,800초)`);
        console.log(`- 마스터 DB 백업: ${result.backupPath}`);
      }
      return;
    }
    if (command === 'ultimate-fighter' || command === 'ultimate-fighter-5x' || command === 'ultimate-fighter-restore') {
      const status = getUltimateFighterReturnStatus(savePath);
      const currentPercent = status.row.val0;
      const currentRatio = (currentPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`현재 효과: 모든 기본 능력치 +${formatNumber(currentPercent)}% (기본 20% 대비 ${currentRatio}배)`);

      let targetPercent;
      let modeDesc = '';

      if (command === 'ultimate-fighter-restore') {
        targetPercent = ULTIMATE_FIGHTER_RETURN_BASE_PERCENT;
        modeDesc = '기본값(+20%) 복구';
      } else if (command === 'ultimate-fighter-5x') {
        targetPercent = ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT;
        modeDesc = '5배(+100%) 적용';
      } else {
        const arg = parsed.args[1];
        if (!arg) {
          fail('사용법: node lid-kc.js ultimate-fighter <퍼센트(%) | 배율(예: 5x, 10배) | restore>');
        }
        if (arg.toLowerCase() === 'restore' || arg.toLowerCase() === 'default') {
          targetPercent = ULTIMATE_FIGHTER_RETURN_BASE_PERCENT;
          modeDesc = '기본값(+20%) 복구';
        } else if (/[x배X]$/i.test(arg)) {
          const mult = Number(arg.replace(/[x배X]/gi, ''));
          if (isNaN(mult) || mult <= 0 || mult > 50000) {
            fail('오류: 배율은 0보다 크고 50,000 이하의 숫자여야 합니다 (예: 5x, 10배).');
          }
          targetPercent = Math.round(ULTIMATE_FIGHTER_RETURN_BASE_PERCENT * mult);
          modeDesc = `${mult}배(+${formatNumber(targetPercent)}%) 설정`;
        } else {
          const raw = Number(arg.replace(/[%]/g, ''));
          if (!Number.isInteger(raw) || raw < 1 || raw > 1_000_000) {
            fail('오류: 퍼센트는 1 ~ 1,000,000 사이의 정수여야 합니다 (예: 50, 100%, 500).');
          }
          targetPercent = raw;
          const ratio = (targetPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
          modeDesc = `+${formatNumber(targetPercent)}% (${ratio}배) 설정`;
        }
      }

      if (currentPercent === targetPercent) {
        console.log(`이미 요청하신 수치(+${formatNumber(targetPercent)}%)가 적용되어 있습니다.`);
        return;
      }

      const ratio = (targetPercent / ULTIMATE_FIGHTER_RETURN_BASE_PERCENT).toFixed(1).replace(/\.0$/, '');
      if (!parsed.yes && !await confirm(rl, `궁극 파이터의 귀환 효과를 +${formatNumber(targetPercent)}% (${ratio}배)로 변경할까요?`)) return;

      const result = setUltimateFighterReturnPercent(savePath, targetPercent);
      console.log('\n[성공] 궁극 파이터의 귀환 효과 변경이 성공적으로 완료되었습니다!');
      console.log(`- 설정 모드: [${modeDesc}]`);
      console.log(`- 모든 기본 능력치 증가: +${formatNumber(currentPercent)}% → +${formatNumber(result.row.val0)}% (${ratio}배)`);
      console.log(`- 마스터 DB 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'kamas-re-max') {
      const definition = getKamasResearchDefinition(savePath);
      const state = getKamasResearchState(
        save,
        definition.maximumInternalLevel,
        definition.limitBreakStart,
      );
      console.log(`KAMAS-A1 어설트 라이플 RE: +${state.completedDisplayLevel} 완료`);
      if (state.currentDisplayLevel > state.completedDisplayLevel) {
        console.log(`현재 연구 중: +${state.currentDisplayLevel}`);
      }
      console.log(`DB 최대 강화: +${definition.maximumDisplayLevel}`);
      if (!parsed.yes && !await confirm(rl, `연구를 최대 +${definition.maximumDisplayLevel} 완료 상태로 변경할까요?`)) return;
      const result = writeKamasResearchMaximum(savePath, save);
      if (!result.changed) {
        console.log(`이미 KAMAS RE 연구가 최대 +${definition.maximumDisplayLevel}입니다.`);
      } else {
        console.log('\n[성공] KAMAS-A1 어설트 라이플 RE 최대 연구가 성공적으로 완료되었습니다.');
        console.log(`- 연구 완료 등급: +${result.maximumDisplayLevel}`);
        console.log(`- 세이브 백업: ${result.backupPath}`);
      }
      return;
    }
    if (command === 'queen-spades' || command === 'queen-spades-extreme' || command === 'queen-spades-restore') {
      const status = getQueenOfSpadesStatus(savePath);
      const currentPercent = status.row.val0;
      const currentRatio = (currentPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`현재 효과: 공격력 +${formatNumber(currentPercent)}% (기본 30% 대비 ${currentRatio}배) / 치명타 +${formatNumber(status.row.val1)}% / 피해 무효화 ${formatNumber(status.row.val2)}%`);

      let targetPercent;
      let modeDesc = '';

      if (command === 'queen-spades-restore') {
        targetPercent = QUEEN_OF_SPADES_BASE_ATTACK_PERCENT;
        modeDesc = `기본값(+${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}%) 복구`;
      } else if (command === 'queen-spades-extreme') {
        targetPercent = QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT;
        modeDesc = `극단화(+${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%) 적용`;
      } else {
        const arg = parsed.args[1];
        if (!arg) {
          fail('사용법: node lid-kc.js queen-spades <퍼센트(%) | 배율(예: 5x, 10배) | extreme | restore>');
        }
        if (arg.toLowerCase() === 'restore' || arg.toLowerCase() === 'default') {
          targetPercent = QUEEN_OF_SPADES_BASE_ATTACK_PERCENT;
          modeDesc = `기본값(+${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}%) 복구`;
        } else if (arg.toLowerCase() === 'extreme') {
          targetPercent = QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT;
          modeDesc = `극단화(+${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%) 적용`;
        } else if (/[x배X]$/i.test(arg)) {
          const mult = Number(arg.replace(/[x배X]/gi, ''));
          if (isNaN(mult) || mult <= 0 || mult > 166) {
            fail('오류: 배율은 0보다 크고 166 이하의 숫자여야 합니다 (예: 5x, 10배).');
          }
          targetPercent = Math.round(QUEEN_OF_SPADES_BASE_ATTACK_PERCENT * mult);
          modeDesc = `${mult}배(+${formatNumber(targetPercent)}%) 설정`;
        } else {
          const raw = Number(arg.replace(/[%]/g, ''));
          if (!Number.isInteger(raw) || raw < 1 || raw > 5_000) {
            fail('오류: 퍼센트는 1 ~ 5,000 사이의 정수여야 합니다 (32비트 연산 오버플로 방지 안전 한도).');
          }
          targetPercent = raw;
          const ratio = (targetPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
          modeDesc = `+${formatNumber(targetPercent)}% (${ratio}배) 설정`;
        }
      }

      if (currentPercent === targetPercent) {
        console.log(`이미 요청하신 수치(+${formatNumber(targetPercent)}%)가 적용되어 있습니다.`);
        return;
      }

      const ratio = (targetPercent / QUEEN_OF_SPADES_BASE_ATTACK_PERCENT).toFixed(1).replace(/\.0$/, '');
      if (!parsed.yes && !await confirm(rl, `스페이드 여왕 공격력을 +${formatNumber(targetPercent)}% (${ratio}배)로 변경할까요?`)) return;

      const result = setQueenOfSpadesPercent(savePath, targetPercent);
      console.log('\n[성공] 스페이드 여왕 공격력 변경이 성공적으로 완료되었습니다!');
      console.log(`- 설정 모드: [${modeDesc}]`);
      console.log(`- 공격력 증가: +${formatNumber(currentPercent)}% → +${formatNumber(result.row.val0)}% (${ratio}배)`);
      console.log(`- 마스터 DB 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'wolf-rage' || command === 'wolf-rage-restore') {
      const status = getWolfRageStatus(savePath);
      const superPercent = status.superWolf.val0;
      const madPercent = status.madWolf.val0;
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`현재 효과: 슈퍼 울프 +${formatNumber(superPercent)}% (기본값: +80%) / 매드 울프 +${formatNumber(madPercent)}% (기본값: +120%)`);

      if (command === 'wolf-rage-restore') {
        if (superPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P &&
            madPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P) {
          console.log('이미 울프 계열 데칼의 레이지 축적 속도가 기본값(80% / 120%)입니다.');
          return;
        }
        if (!parsed.yes && !await confirm(rl, '울프 계열 데칼의 레이지 축적 속도를 기본값(80% / 120%)으로 복구할까요?')) return;
        const result = restoreWolfRageDefault(savePath);
        console.log('\n[성공] 울프 계열 레이지 축적 속도 기본값 복구가 성공적으로 완료되었습니다!');
        console.log(`- 슈퍼 울프: +${formatNumber(superPercent)}% → +${formatNumber(result.superWolf.val0)}% (기본값: +80%)`);
        console.log(`- 매드 울프: +${formatNumber(madPercent)}% → +${formatNumber(result.madWolf.val0)}% (기본값: +120%)`);
        console.log(`- 마스터 DB 백업: ${result.backupPath}`);
        return;
      }

      const arg = parsed.args[1];
      let targetPercent = WOLF_RAGE_TARGET_PERCENT;
      let modeDesc = `+${formatNumber(WOLF_RAGE_TARGET_PERCENT)}% 적용 (스치기만 해도 게이지 즉시 충전)`;

      if (arg) {
        if (arg.toLowerCase() === 'restore' || arg.toLowerCase() === 'default') {
          if (superPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPDUP_02_P &&
              madPercent === WOLF_RAGE_DEFAULT_VALUES.SKL_RGSPUP_RDURDOWN_01_P) {
            console.log('이미 울프 계열 데칼의 레이지 축적 속도가 기본값(80% / 120%)입니다.');
            return;
          }
          if (!parsed.yes && !await confirm(rl, '울프 계열 데칼의 레이지 축적 속도를 기본값(80% / 120%)으로 복구할까요?')) return;
          const result = restoreWolfRageDefault(savePath);
          console.log('\n[성공] 울프 계열 레이지 축적 속도 기본값 복구가 성공적으로 완료되었습니다!');
          console.log(`- 슈퍼 울프: +${formatNumber(superPercent)}% → +${formatNumber(result.superWolf.val0)}% (기본값: +80%)`);
          console.log(`- 매드 울프: +${formatNumber(madPercent)}% → +${formatNumber(result.madWolf.val0)}% (기본값: +120%)`);
          console.log(`- 마스터 DB 백업: ${result.backupPath}`);
          return;
        }
        const raw = Number(arg.replace(/[%]/g, ''));
        if (!Number.isInteger(raw) || raw < 1 || raw > 50_000) {
          fail('오류: 퍼센트는 1 ~ 50,000 사이의 정수여야 합니다 (예: 1000, 1000%).');
        }
        targetPercent = raw;
        modeDesc = `+${formatNumber(targetPercent)}% 적용`;
      }

      if (superPercent === targetPercent && madPercent === targetPercent) {
        console.log(`이미 두 울프 데칼 모두 +${formatNumber(targetPercent)}%가 적용되어 있습니다.`);
        return;
      }

      if (!parsed.yes && !await confirm(rl, `슈퍼 울프와 매드 울프의 레이지 축적 속도를 +${formatNumber(targetPercent)}%로 변경할까요?`)) return;

      const result = setWolfRagePercent(savePath, targetPercent);
      console.log('\n[성공] 울프 계열 레이지 축적 속도 변경이 성공적으로 완료되었습니다!');
      console.log(`- 설정 모드: [${modeDesc}]`);
      console.log(`- 슈퍼 울프: +${formatNumber(superPercent)}% → +${formatNumber(result.superWolf.val0)}%`);
      console.log(`- 매드 울프: +${formatNumber(madPercent)}% → +${formatNumber(result.madWolf.val0)}%`);
      console.log(`- 마스터 DB 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'equipment-materials-free') {
      const status = getEquipmentMaterialStatus(savePath);
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`재료가 필요한 장비 정의: ${formatNumber(status.nonZeroRows)}종 / 수량 항목 ${formatNumber(status.nonZeroCells)}개`);
      if (!parsed.yes && !await confirm(rl, '모든 장비의 개발·강화 재료 수량을 0으로 변경할까요?')) return;
      const result = setEquipmentMaterialsFree(savePath);
      if (!result.changed) {
        console.log('이미 모든 장비 개발·강화 재료 수량이 0입니다.');
      } else {
        console.log('\n[성공] 장비 개발·강화 재료 무료화가 성공적으로 완료되었습니다.');
        console.log(`- 장비 ${formatNumber(result.rowCount)}종의 개발·강화 재료 비용 제거`);
        console.log('- 킬코인·스피리튬 비용과 연구 시간은 유지됩니다.');
        console.log(`- 마스터 DB 백업: ${result.backupPath}`);
      }
      return;
    }
    if (command === 'equipment-materials-restore') {
      const backups = listEquipmentMaterialBackups();
      const backupPath = parsed.args[1] ? path.resolve(parsed.args[1]) : backups[0];
      if (!backupPath) fail('복원할 장비 재료 비용 전용 백업이 없습니다.');
      const summary = summarizeEquipmentMaterialRows(readEquipmentMaterialRows(backupPath));
      console.log(`복원 대상: ${backupPath}`);
      console.log(`백업의 재료 필요 정의: ${formatNumber(summary.nonZeroRows)}종 / 수량 항목 ${formatNumber(summary.nonZeroCells)}개`);
      if (!parsed.yes && !await confirm(rl, '이 백업의 장비 재료 수량만 복원할까요?')) return;
      const result = restoreEquipmentMaterials(savePath, backupPath);
      console.log('\n[성공] 장비 재료 비용 복원이 성공적으로 완료되었습니다.');
      console.log(`- 복원 완료: 장비 재료 비용 ${formatNumber(result.nonZeroRows)}종`);
      console.log(`- 복원 전 안전 백업: ${result.safetyBackup}`);
      return;
    }
    if (command === 'max-facility') {
      printStatus(savePath, save);
      const facilityState = getFacilityState(save);
      console.log(`금고 레벨: Lv.${facilityState.safeLevel} / 스피리튬 탱크 레벨: Lv.${facilityState.tankLevel} (최대 99)`);
      if (facilityState.isMaxed) {
        console.log('시설 레벨이 이미 모두 최대치(99)입니다.');
        return;
      }
      if (!parsed.yes && !await confirm(rl, '금고와 스피리튬 탱크 레벨을 모두 99로 업그레이드할까요?')) return;
      const result = writeFacilityUpgradesMaximum(savePath, save);
      console.log('\n[성공] 시설 레벨 최대 업그레이드가 성공적으로 완료되었습니다.');
      console.log(`- 금고: Lv.${result.previousSafeLevel} → Lv.${result.currentSafeLevel}, 스피리튬 탱크: Lv.${result.previousTankLevel} → Lv.${result.currentTankLevel} (한도 2,560,000)`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'max-mastery') {
      printStatus(savePath, save);
      const masteryState = getWeaponMasteryState(save);
      console.log(`무기 숙련도(Lv.20): ${formatNumber(masteryState.maxLevelCount)} / ${formatNumber(masteryState.totalCount)}종`);
      if (masteryState.isMaxed) {
        console.log('모든 무기 숙련도가 이미 최대(Lv.20)입니다.');
        return;
      }
      if (!parsed.yes && !await confirm(rl, `모든 무기 숙련도(${formatNumber(masteryState.totalCount)}종)를 최대 Lv.20으로 업그레이드할까요?`)) return;
      const result = writeWeaponMasteriesMaximum(savePath, save);
      console.log('\n[성공] 모든 무기 숙련도 최대 업그레이드가 성공적으로 완료되었습니다.');
      console.log(`- 무기 숙련도 ${formatNumber(result.upgradedCount)}종 Lv.20 최대치 적용 (전체 57종 달성)`);
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'max-equipment' || command === 'max-upgrades') {
      printStatus(savePath, save);
      const researchState = getEquipmentResearchState(save, savePath);
      console.log(`장비 연구 완료: ${formatNumber(researchState.existingCount)}개 항목 등록됨 (전체 356개 계보 / 1,262종 장비)`);
      if (researchState.isMaxed) {
        console.log('모든 장비 연구·개발(R&D)이 이미 최대치까지 완료돼 있습니다.');
        return;
      }
      if (!parsed.yes && !await confirm(rl, '모든 장비(1,262종)의 연구·개발(R&D) 및 최종 한계돌파 강화를 최대치로 완료할까요?')) return;
      const result = writeEquipmentResearchMaximum(savePath, save);
      console.log('\n[성공] 모든 장비 연구·개발(R&D) 최대 업그레이드가 성공적으로 완료되었습니다.');
      console.log(`- 대상 장비: 총 ${formatNumber(result.totalPartCount)}종 (356개 계보 전체)`);
      console.log(`- 등록된 연구 단계: 총 ${formatNumber(result.totalEntries)}개 (신규 추가/갱신 ${formatNumber(result.addedCount)}개)`);
      console.log('- 최종 한계돌파(최대 +24강) 및 각 티어 최대 강화 완료');
      console.log(`- 세이브 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'restore') {
      const backups = listBackups(savePath);
      if (backups.length === 0) fail('복원할 백업이 없습니다.');
      const backupPath = parsed.args[1] ? path.resolve(parsed.args[1]) : backups[0];
      const backupSave = readSave(backupPath);
      console.log(`복원 대상: ${backupPath}`);
      printResourceValues(backupSave, '백업 ');
      if (!parsed.yes && !await confirm(rl, '이 백업으로 복원할까요?')) return;
      const result = restoreBackup(savePath, backupPath);
      console.log('\n[성공] 세이브 복원이 성공적으로 완료되었습니다.');
      for (const [resourceKey, value] of Object.entries(result.restoredResources)) {
        console.log(`- ${RESOURCES[resourceKey].label}: ${formatNumber(value)}`);
      }
      console.log(`- 복원 전 안전 백업: ${result.safetyBackup}`);
      return;
    }
    if (command === 'fighters' || command === 'fighter-status') {
      printStatus(savePath, save);
      const fighters = getFighterList(save);
      console.log(`\n[캐릭터(파이터) 목록] 총 ${fighters.length}명 (주 능력치 기준: 순정 최대치 Lv.45 / DB 최대치 Lv.50)`);
      fighters.forEach((f, idx) => {
        const s = f.stats;
        console.log(`\n[#${idx + 1}] ${f.name} (${f.typeName}) | ${f.grade}성 LB${f.limitBreak} | ${f.state}`);
        console.log(`  총 레벨: Lv.${s.lvl}`);
        console.log(`  HP: ${s.hp}/45(순정) [50(DB)](+${s.hp_bonus || 0}) | STR: ${s.str}/45[50](+${s.str_bonus || 0}) | DEX: ${s.dex}/45[50](+${s.dex_bonus || 0})`);
        console.log(`  VIT: ${s.vit}/45(순정) [50(DB)](+${s.vit_bonus || 0}) | STM: ${s.stm}/45[50](+${s.stm_bonus || 0}) | LUK: ${s.luk}/45[50](+${s.luk_bonus || 0})`);
        console.log(`  데칼 슬롯: +${s.skill} (총 ${Math.min(9, 5 + s.skill)}칸, 순정최대 9칸) | 가방: ${s.bag} | 분노 게이지: ${s.rage}/5`);
      });
      return;
    }
    if (command === 'set-fighter-stat') {
      const targetArg = parsed.args[1];
      const statKeyArg = parsed.args[2]?.toLowerCase();
      const valArg = parsed.args[3];
      if (!targetArg || !statKeyArg) {
        fail('사용법: node lid-kc.js set-fighter-stat <파이터번호또는이름> <max-legit | max-db | all 수치 | hp|str|dex|vit|stm|luk|skill|bag|rage 수치>');
      }
      const fighters = getFighterList(save);
      let fIdx = -1;
      if (/^\d+$/.test(targetArg)) {
        fIdx = Number(targetArg) - 1;
      } else {
        fIdx = fighters.findIndex((f) => f.name.toLowerCase() === targetArg.toLowerCase());
      }
      if (fIdx < 0 || fIdx >= fighters.length) {
        fail(`대상 파이터 '${targetArg}'을(를) 찾지 못했습니다. 1~${fighters.length} 범위의 번호나 정확한 이름을 입력하세요.`);
      }

      const targetFighter = fighters[fIdx];
      let updates = {};
      let modeDesc = '';

      if (['legit', 'max-legit'].includes(statKeyArg)) {
        updates = { hp: 45, str: 45, dex: 45, vit: 45, stm: 45, luk: 45 };
        modeDesc = '순정 최대치(45)';
      } else if (['db', 'max-db'].includes(statKeyArg)) {
        updates = { hp: 50, str: 50, dex: 50, vit: 50, stm: 50, luk: 50 };
        modeDesc = 'DB 최대치(50)';
      } else if (['max-bonus', 'bonus-max'].includes(statKeyArg)) {
        updates = { hp_bonus: 5, str_bonus: 5, dex_bonus: 5, vit_bonus: 5, stm_bonus: 5, luk_bonus: 5 };
        modeDesc = '보너스 순정 최대치(+5)';
      } else if (statKeyArg === 'bonus') {
        if (valArg === undefined) fail('bonus 옵션 뒤에 설정할 수치(0~50, 순정 최대:5)를 입력해야 합니다.');
        const val = Number(valArg);
        if (!Number.isInteger(val) || val < 0 || val > 50) fail('보너스 수치(bonus)는 0~50 범위여야 합니다.');
        updates = { hp_bonus: val, str_bonus: val, dex_bonus: val, vit_bonus: val, stm_bonus: val, luk_bonus: val };
        modeDesc = `보너스 확장 일괄 +${val}`;
      } else if (['max-slots', 'slots-max'].includes(statKeyArg)) {
        updates = { skill: 4, bag: 12 };
        modeDesc = '슬롯·가방 순정 최대(+4/+12)';
      } else if (['expand-slots', 'slots-expand'].includes(statKeyArg)) {
        updates = { skill: 4, bag: 50 };
        modeDesc = '슬롯 9칸(UI최대) + 가방 확장(+50)';
      } else if (statKeyArg === 'all') {
        if (valArg === undefined) fail('all 옵션 뒤에 설정할 수치(1~50)를 입력해야 합니다.');
        const val = Number(valArg);
        if (!Number.isInteger(val) || val < 1 || val > 50) fail('6대 주 능력치(all)는 1~50 범위(순정최대:45 / DB최대:50)여야 합니다.');
        updates = { hp: val, str: val, dex: val, vit: val, stm: val, luk: val };
        modeDesc = `일괄 ${val}`;
      } else {
        if (valArg === undefined) fail(`${statKeyArg} 뒤에 설정할 수치를 입력해야 합니다.`);
        const val = Number(valArg);
        if (!Number.isInteger(val) || val < 0) {
          fail('수치는 0 이상의 정수여야 합니다.');
        }

        const allowedKeys = {
          hp: { min: 1, legitMax: 45, max: 50 },
          str: { min: 1, legitMax: 45, max: 50 },
          dex: { min: 1, legitMax: 45, max: 50 },
          vit: { min: 1, legitMax: 45, max: 50 },
          stm: { min: 1, legitMax: 45, max: 50 },
          luk: { min: 1, legitMax: 45, max: 50 },
          skill: { min: 0, legitMax: 4, max: 4 },
          bag: { min: 0, legitMax: 45, max: 50 },
          rage: { min: 0, legitMax: 5, max: 5 },
          hp_bonus: { min: 0, legitMax: 5, max: 50 },
          str_bonus: { min: 0, legitMax: 5, max: 50 },
          dex_bonus: { min: 0, legitMax: 5, max: 50 },
          vit_bonus: { min: 0, legitMax: 5, max: 50 },
          stm_bonus: { min: 0, legitMax: 5, max: 50 },
          luk_bonus: { min: 0, legitMax: 5, max: 50 },
        };
        const meta = allowedKeys[statKeyArg];
        if (!meta) {
          fail(`지원하지 않는 능력치 키 '${statKeyArg}'입니다. (가능한 키: max-legit, max-db, all, hp, str, dex, vit, stm, luk, skill, bag, rage)`);
        }
        if (val < meta.min || val > meta.max) {
          fail(`${statKeyArg.toUpperCase()} 수치는 ${meta.min}~${meta.max}(순정최대:${meta.legitMax}) 범위여야 합니다.`);
        }
        updates = { [statKeyArg]: val };
        modeDesc = `${statKeyArg.toUpperCase()} ${val}`;
      }

      console.log(`대상 파이터: [#${fIdx + 1}] ${targetFighter.name} (${targetFighter.typeName}) [${modeDesc}]`);
      console.log('설정할 변경 사항:', updates);
      if (!await promptFighterWarningIfNeeded(rl, updates, savePath, parsed.yes)) return;
      if (!parsed.yes && !await confirm(rl, '이 파이터 능력치를 변경할까요?')) return;
      const result = writeFighterStats(savePath, save, fIdx, updates);
      printFighterChangeSummary(result, modeDesc);
      return;
    }
    if (command === 'expand-fighter-limits') {
      const status = getFighterLimitStatus(savePath);
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`현재 DB 주 능력치 한도: Lv.${status.statMaxLevel} / 총 레벨 경험치 한도: Lv.${status.expMaxLevel}`);
      if (status.statMaxLevel >= 50 && status.expMaxLevel >= 500 && status.skillSlotsCount >= 15) {
        console.log('파이터 스탯(Lv.50), 경험치(Lv.500), 슬롯(15개) 상한 해제가 이미 DB에 적용돼 있습니다.');
        return;
      }
      console.log('\n' + '='.repeat(72));
      console.log('[경고] 게임 데이터베이스(masters.db) 변조 알림');
      console.log('-'.repeat(72));
      console.log('- 본 기능은 게임 클라이언트의 원본 마스터 DB를 직접 패치합니다.');
      console.log('- 6성 8개 파이터 클래스의 주 능력치를 Lv.50까지 확장하고,');
      console.log('  경험치 테이블을 Lv.500까지 확장하여 스탯 롤백 및 레벨 오류를 방지합니다.');
      console.log('- Steam 무결성 검사 시 순정으로 초기화될 수 있습니다.');
      console.log('- 패치 전 원본 DB는 backups 폴더에 자동 백업됩니다.');
      console.log('='.repeat(72));
      if (!parsed.yes && !await confirm(rl, '파이터 스탯 및 경험치 상한 해제 DB 패치를 진행할까요?')) return;
      const result = expandFighterLimits(savePath, 50, 500);
      console.log('\n[성공] 파이터 상한 해제 DB 패치가 성공적으로 완료되었습니다.');
      console.log(`- 6성 파이터 주 능력치 상한: Lv.${status.statMaxLevel} → Lv.${result.statMaxLevel} (추가 ${result.addedStatusRows}행)`);
      console.log(`- 6성 경험치/총 레벨 상한: Lv.${status.expMaxLevel} → Lv.${result.expMaxLevel} (추가 ${result.addedExpRows}행)`);
      console.log(`- 마스터 DB 백업: ${result.backupPath}`);
      return;
    }
    if (command === 'restore-fighter-limits') {
      const backups = listFighterLimitBackups();
      if (backups.length === 0) fail('복원할 파이터 상한 해제 DB 백업이 없습니다.');
      const sourceBackup = parsed.args[1] ? path.resolve(parsed.args[1]) : backups[0];
      console.log(`복원 대상 백업: ${sourceBackup}`);
      if (!parsed.yes && !await confirm(rl, '이 백업을 사용하여 순정 DB로 복원할까요?')) return;
      const result = restoreFighterLimits(savePath, sourceBackup);
      console.log('\n[성공] 파이터 상한 순정 DB 복원이 성공적으로 완료되었습니다.');
      console.log(`- 주 능력치 상한: Lv.${result.statMaxLevel} / 경험치 상한: Lv.${result.expMaxLevel}`);
      console.log(`- 복원 전 안전 백업: ${result.safetyBackup}`);
      return;
    }

    fail('사용법: node lid-kc.js [status | backup | reset-shop | grant-all-decals | grant-golden-beasts [마리수] | grant-limited-recipes | grant-all-recipes | max-facility | max-mastery | max-equipment | fighters | set-fighter-stat <번호/이름> <max-legit | max-db | max-bonus | bonus 수치 | max-slots | expand-slots | all 수치 | stat 수치> | expand-fighter-limits | restore-fighter-limits | collision-30m | collision-restore | ultimate-fighter <수치|배율|restore> | ultimate-fighter-5x | ultimate-fighter-restore | kamas-re-max | queen-spades <수치|배율|extreme|restore> | queen-spades-extreme | queen-spades-restore | wolf-rage [수치|restore] | wolf-rage-restore | equipment-materials-free | equipment-materials-restore [백업] | set [kc|sp|blood] 숫자 | max [kc|sp|blood] | restore] [--save 경로] [--game 설치폴더 | --master DB경로] [--yes]');
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
    console.error(`\n오류: ${error.message}`);
    if (logFile) console.error(`오류 로그 저장됨: ${logFile}`);
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
  setUltimateFighterReturnFiveTimes,
  setUltimateFighterReturnPercent,
  setWolfRagePercent,
  getWolfRageStatus,
  WOLF_RAGE_DECAL_IDS,
  WOLF_RAGE_DEFAULT_VALUES,
  WOLF_RAGE_TARGET_PERCENT,
  calculateFighterTotalLevel,
  FIGHTER_TYPES,
  getFighterList,
  replaceFighterStats,
  writeEquipmentResearchMaximum,
  writeErrorLog,
  writeFacilityUpgradesMaximum,
  writeFighterStats,
  writeWeaponMasteriesMaximum,
  expandFighterLimits,
  restoreFighterLimits,
  getFighterLimitStatus,
};
