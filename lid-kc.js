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
const ULTIMATE_FIGHTER_RETURN_ID = 'SKL_FIGHTER_STUP_02_P';
const ULTIMATE_FIGHTER_RETURN_BASE_PERCENT = 20;
const ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT =
  ULTIMATE_FIGHTER_RETURN_BASE_PERCENT * 5;
const QUEEN_OF_SPADES_ID = 'SKL_SYLVIA_NMH_02_P';
const QUEEN_OF_SPADES_BASE_ATTACK_PERCENT = 30;
const QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT = 10_000;
const KAMAS_RE_FINAL_PART_ID = 'PT_ARM_WP031_0B5';
const FIVE_STAR_DECAL_IDS = [
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
  if (!Array.isArray(history) || history.some((id) => typeof id !== 'string')) {
    fail('세이브에서 프리미엄 데칼 뽑기 이력을 찾지 못했습니다.');
  }
  return history;
}

function getPremiumDecalStock(save) {
  const stock = save.data?.soul?.skl?.psskl;
  if (!Array.isArray(stock)) fail('세이브에서 프리미엄 데칼 소유 목록을 찾지 못했습니다.');
  const ids = new Set();
  for (const entry of stock) {
    if (!entry || typeof entry !== 'object' || typeof entry.sklid !== 'string' ||
        !Number.isSafeInteger(entry.cnt) || entry.cnt < 0 ||
        !Number.isSafeInteger(entry.updated) || ![0, 1].includes(entry.is_checked)) {
      fail('프리미엄 데칼 소유 목록의 항목 형식이 올바르지 않습니다.');
    }
    if (ids.has(entry.sklid)) fail(`프리미엄 데칼 소유 목록에 ${entry.sklid}가 중복되어 있습니다.`);
    ids.add(entry.sklid);
  }
  return stock;
}

function arrayEndsWith(array, suffix) {
  if (array.length < suffix.length) return false;
  const offset = array.length - suffix.length;
  return suffix.every((value, index) => array[offset + index] === value);
}

function replaceFiveStarDecals(save) {
  if (FIVE_STAR_DECAL_IDS.length !== 41 || new Set(FIVE_STAR_DECAL_IDS).size !== 41) {
    fail('내장된 ★5 데칼 목록 검증에 실패했습니다.');
  }
  const history = getGachaHistory(save);
  const stock = getPremiumDecalStock(save);
  let changedText = save.jsonText;

  // Earlier tool builds incorrectly appended grants to the draw history.
  // Remove only exact trailing 41-item sets written by those builds.
  const cleanedHistory = [...history];
  let removedHistoryCount = 0;
  while (arrayEndsWith(cleanedHistory, FIVE_STAR_DECAL_IDS)) {
    cleanedHistory.splice(-FIVE_STAR_DECAL_IDS.length);
    removedHistoryCount += FIVE_STAR_DECAL_IDS.length;
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
    fail('세이브의 프리미엄 데칼 소유 목록을 읽지 못했습니다.');
  }
  if (JSON.stringify(rawStock) !== JSON.stringify(stock)) {
    fail('프리미엄 데칼 소유 목록 교차 검증에 실패했습니다.');
  }

  const now = Math.floor(Date.now() / 1000);
  const changedStock = stock.map((entry) => ({ ...entry }));
  const stockIndex = new Map(changedStock.map((entry, index) => [entry.sklid, index]));
  let newTypes = 0;
  let incrementedTypes = 0;
  for (const id of FIVE_STAR_DECAL_IDS) {
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
  if (!Array.isArray(verifiedHistory) || verifiedHistory.length !== cleanedHistory.length ||
      !Array.isArray(verifiedStock) || verifiedStock.length !== changedStock.length) {
    fail('수정된 ★5 데칼 데이터 검증에 실패했습니다.');
  }
  const previousCounts = new Map(stock.map((entry) => [entry.sklid, entry.cnt]));
  const verifiedCounts = new Map(verifiedStock.map((entry) => [entry.sklid, entry.cnt]));
  for (const id of FIVE_STAR_DECAL_IDS) {
    if (verifiedCounts.get(id) !== (previousCounts.get(id) ?? 0) + 1) {
      fail(`수정된 ★5 데칼 ${id} 수량 검증에 실패했습니다.`);
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

function getKamasResearchState(save, maximumInternalLevel, limitBreakStart) {
  const research = save.data?.soul?.partresearch?.user;
  if (!Array.isArray(research)) {
    fail('세이브에서 장비 연구 목록을 찾지 못했습니다.');
  }
  const entries = research.filter((entry) => entry?.ptid === KAMAS_RE_FINAL_PART_ID);
  if (entries.length === 0) {
    fail('KAMAS-A1 어설트 라이플 RE 최종 티어 연구 데이터가 없습니다.');
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

function findSteamRoots() {
  const roots = new Set();
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ].filter(Boolean);

  for (const steamRoot of candidates) {
    if (!fs.existsSync(steamRoot)) continue;
    roots.add(steamRoot);
    const libraryFile = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraryFile)) continue;
    const vdf = fs.readFileSync(libraryFile, 'utf8');
    for (const match of vdf.matchAll(/\"path\"\s+\"([^\"]+)\"/g)) {
      roots.add(match[1].replace(/\\\\/g, '\\'));
    }
  }
  return [...roots];
}

function discoverSaves() {
  const saves = [];
  for (const root of findSteamRoots()) {
    const installDirectory = path.join(root, 'steamapps', 'common', 'LET IT DIE');
    const executable = path.join(installDirectory, 'Binaries', 'Win64', 'BrgGame-Steam.exe');
    if (!fs.existsSync(executable)) continue;
    const saveDirectory = path.join(installDirectory, 'Savedata');
    if (!fs.existsSync(saveDirectory)) continue;
    for (const name of fs.readdirSync(saveDirectory)) {
      if (/^\d+\.sav$/i.test(name)) saves.push(path.join(saveDirectory, name));
    }
  }
  return [...new Set(saves)];
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

function createBackup(savePath, packed) {
  const directory = backupDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const name = `${path.basename(savePath)}.${timestamp()}.${sha256(packed).slice(0, 12)}.bak`;
  const destination = path.join(directory, name);
  fs.writeFileSync(destination, packed, { flag: 'wx' });
  return destination;
}

function getMasterDatabasePath(savePath) {
  const installDirectory = path.dirname(path.dirname(savePath));
  const databasePath = path.join(installDirectory, 'BrgGame', 'Content', 'masters.db');
  if (!fs.existsSync(databasePath)) {
    fail(`마스터 DB를 찾지 못했습니다: ${databasePath}`);
  }
  return databasePath;
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

function createMasterDatabaseBackup(original) {
  const directory = backupDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const name = `masters.db.${timestamp()}.${sha256(original).slice(0, 12)}.bak`;
  const destination = path.join(directory, name);
  fs.writeFileSync(destination, original, { flag: 'wx' });
  return destination;
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

function setUltimateFighterReturnFiveTimes(savePath) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const status = getUltimateFighterReturnStatus(savePath);
  if (status.row.val0 === ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT) {
    return { ...status, changed: false, backupPath: undefined };
  }
  if (status.row.val0 !== ULTIMATE_FIGHTER_RETURN_BASE_PERCENT) {
    fail(`현재 효과가 예상한 ${ULTIMATE_FIGHTER_RETURN_BASE_PERCENT}%가 아닙니다: ${status.row.val0}%`);
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
      'UPDATE master_skill SET val0 = ? WHERE id = ? AND val0 = ?',
    ).run(
      ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT,
      ULTIMATE_FIGHTER_RETURN_ID,
      ULTIMATE_FIGHTER_RETURN_BASE_PERCENT,
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
  if (verified.row.val0 !== ULTIMATE_FIGHTER_RETURN_TARGET_PERCENT) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail('수정 결과 검증에 실패해 원본 DB를 복구했습니다.');
  }

  return { ...verified, changed: true, backupPath };
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

function setQueenOfSpadesExtremeDamage(savePath) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }

  const status = getQueenOfSpadesStatus(savePath);
  if (status.row.val0 === QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT) {
    return { ...status, changed: false, backupPath: undefined };
  }
  if (status.row.val0 !== QUEEN_OF_SPADES_BASE_ATTACK_PERCENT) {
    fail(`현재 스페이드 여왕 공격력 효과가 예상한 +${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}%가 아닙니다: +${status.row.val0}%`);
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
      'UPDATE master_skill SET val0 = ? WHERE id = ? AND val0 = ?',
    ).run(
      QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT,
      QUEEN_OF_SPADES_ID,
      QUEEN_OF_SPADES_BASE_ATTACK_PERCENT,
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
  if (verified.row.val0 !== QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT) {
    fs.copyFileSync(backupPath, status.databasePath);
    fail('수정 결과 검증에 실패해 원본 DB를 복구했습니다.');
  }

  return { ...verified, changed: true, backupPath };
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

function writeFiveStarDecals(savePath, save) {
  if (isGameRunning()) {
    fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  }
  if (!fs.readFileSync(savePath).equals(save.packed)) {
    fail('세이브를 읽은 뒤 파일이 변경됐습니다. 게임을 종료하고 다시 시도하세요.');
  }

  const mutation = replaceFiveStarDecals(save);
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
    const checkStock = getPremiumDecalStock(check);
    if (checkStock.length !== mutation.changedStock.length) {
      fail('임시 세이브의 ★5 데칼 검증에 실패했습니다.');
    }
    const checkCounts = new Map(checkStock.map((entry) => [entry.sklid, entry.cnt]));
    const expectedCounts = new Map(mutation.changedStock.map((entry) => [entry.sklid, entry.cnt]));
    for (const id of FIVE_STAR_DECAL_IDS) {
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
    addedCount: FIVE_STAR_DECAL_IDS.length,
    previousStockCount: mutation.previousStockCount,
    currentStockCount: mutation.changedStock.length,
    newTypes: mutation.newTypes,
    incrementedTypes: mutation.incrementedTypes,
    removedHistoryCount: mutation.removedHistoryCount,
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
  let yes = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === '--save') {
      if (!args[index + 1]) fail('--save 뒤에 세이브 경로가 필요합니다.');
      savePath = path.resolve(args[index + 1]);
      args.splice(index, 2);
    } else if (args[index] === '--yes') {
      yes = true;
      args.splice(index, 1);
    } else {
      index += 1;
    }
  }
  return { args, savePath, yes };
}

async function chooseSave(rl, explicitPath) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) fail(`세이브 파일이 없습니다: ${explicitPath}`);
    return explicitPath;
  }
  const saves = discoverSaves();
  if (saves.length === 0) {
    fail('Steam LET IT DIE 세이브를 자동으로 찾지 못했습니다. --save 경로를 지정하세요.');
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
  const premiumStock = getPremiumDecalStock(save);
  const ownedPremiumIds = new Set(premiumStock.map((entry) => entry.sklid));
  const ownedFiveStarTypes = FIVE_STAR_DECAL_IDS.filter((id) => ownedPremiumIds.has(id)).length;
  console.log(`★5 프리미엄 데칼: ${formatNumber(ownedFiveStarTypes)} / ${formatNumber(FIVE_STAR_DECAL_IDS.length)}종 보유`);
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

async function interactive(rl, savePath) {
  while (true) {
    const save = readSave(savePath);
    printStatus(savePath, save);
    console.log('\n1. 킬코인을 알려진 한도로 채우기');
    console.log('2. 스피리튬을 알려진 한도로 채우기');
    console.log('3. 블러드늄을 알려진 한도로 채우기');
    console.log('4. 자원 값을 직접 입력');
    console.log('5. 블러드늄 상점 구매 재고 복구');
    console.log('6. ★5 프리미엄 데칼 전체 41종 지급');
    console.log('7. 현재 세이브 백업하기');
    console.log('8. 최신 백업 복원');
    console.log('9. 충돌버섯·구운 충돌버섯 효과를 30분으로 변경');
    console.log('10. 궁극 파이터의 귀환 데칼 효과를 5배로 변경');
    console.log('11. KAMAS-A1 어설트 라이플 RE를 최대 +24로 강화');
    console.log('12. 스페이드 여왕 공격력을 극단적으로 강화');
    console.log('0. 종료');
    const choice = (await rl.question('선택: ')).trim();

    if (choice === '0') return;
    if (['1', '2', '3'].includes(choice)) {
      const resourceKey = ['killcoins', 'splithium', 'bloodnium'][Number(choice) - 1];
      const resource = RESOURCES[resourceKey];
      const capacity = getKnownCapacity(save, resourceKey);
      if (!capacity) {
        console.log(`\n현재 ${resource.label} 시설 레벨의 한도 정보가 없어 자동 설정할 수 없습니다.`);
        continue;
      }
      if (!await confirm(rl, `${resource.label}을 ${formatNumber(capacity)}(으)로 변경할까요?`)) continue;
      const result = writeChangedSave(savePath, save, resourceKey, capacity);
      console.log(`\n완료: ${resource.label} ${formatNumber(capacity)}`);
      console.log(`백업: ${result.backupPath}`);
    } else if (choice === '4') {
      console.log('\n1. 킬코인');
      console.log('2. 스피리튬');
      console.log('3. 블러드늄');
      const resourceChoice = (await rl.question('자원 선택: ')).trim();
      if (!['1', '2', '3'].includes(resourceChoice)) {
        console.log('\n잘못된 선택입니다.');
        continue;
      }
      const resourceKey = ['killcoins', 'splithium', 'bloodnium'][Number(resourceChoice) - 1];
      const resource = RESOURCES[resourceKey];
      const capacity = getKnownCapacity(save, resourceKey);
      const amount = parseAmount(await rl.question(`새 ${resource.label} 값: `));
      if (capacity && amount > capacity) {
        console.log(`주의: 알려진 한도 ${formatNumber(capacity)}을 초과합니다.`);
      }
      if (!await confirm(rl, `${resource.label}을 ${formatNumber(amount)}(으)로 변경할까요?`)) continue;
      const result = writeChangedSave(savePath, save, resourceKey, amount);
      console.log(`\n완료: ${resource.label} ${formatNumber(amount)}`);
      console.log(`백업: ${result.backupPath}`);
    } else if (choice === '5') {
      const shop = getBloodniumShopState(save);
      if (shop.bought.length === 0) {
        console.log('\n복구할 블러드늄 상점 구매 완료 재고가 없습니다.');
        continue;
      }
      if (!await confirm(rl, `구매 완료 ${formatNumber(shop.bought.length)}개를 구매 가능 상태로 되돌릴까요?`)) continue;
      const result = writeBloodniumShopReset(savePath, save);
      console.log(`\n완료: 블러드늄 상점 재고 ${formatNumber(result.restoredCount)}개 복구`);
      console.log(`현재 구매 가능: ${formatNumber(result.availableCount)}개`);
      console.log(`백업: ${result.backupPath}`);
    } else if (choice === '6') {
      if (!await confirm(rl, '★5 프리미엄 데칼 41종을 각각 한 장씩 추가할까요?')) continue;
      const result = writeFiveStarDecals(savePath, save);
      console.log(`\n완료: ★5 프리미엄 데칼 ${formatNumber(result.addedCount)}장 지급`);
      console.log(`새 종류: ${formatNumber(result.newTypes)} / 기존 종류 수량 증가: ${formatNumber(result.incrementedTypes)}`);
      console.log(`프리미엄 데칼 목록: ${formatNumber(result.previousStockCount)} → ${formatNumber(result.currentStockCount)}종`);
      if (result.removedHistoryCount > 0) console.log(`잘못 추가됐던 뽑기 이력 ${formatNumber(result.removedHistoryCount)}개 정리`);
      console.log(`백업: ${result.backupPath}`);
    } else if (choice === '7') {
      if (isGameRunning()) {
        console.log('\nLET IT DIE를 완전히 종료한 뒤 백업하세요.');
        continue;
      }
      const backupPath = createBackup(savePath, save.packed);
      console.log(`\n백업 완료: ${backupPath}`);
    } else if (choice === '8') {
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
      console.log('\n복원 완료');
      for (const [resourceKey, value] of Object.entries(result.restoredResources)) {
        console.log(`${RESOURCES[resourceKey].label}: ${formatNumber(value)}`);
      }
      console.log(`복원 전 안전 백업: ${result.safetyBackup}`);
    } else if (choice === '9') {
      const status = getCollisionMushroomStatus(savePath);
      console.log(`\n마스터 DB: ${status.databasePath}`);
      console.log(`충돌버섯: ${formatNumber(status.rows[0].tmmin)}초`);
      console.log(`구운 충돌버섯: ${formatNumber(status.rows[1].tmmin)}초`);
      if (!await confirm(rl, '두 효과를 모두 1,800초(30분)로 변경할까요?')) continue;
      const result = setCollisionMushroomThirtyMinutes(savePath);
      if (!result.changed) {
        console.log('\n이미 두 효과가 30분으로 설정돼 있습니다.');
      } else {
        console.log('\n완료: 충돌버섯·구운 충돌버섯 지속시간 30분');
        console.log(`마스터 DB 백업: ${result.backupPath}`);
      }
    } else if (choice === '10') {
      const status = getUltimateFighterReturnStatus(savePath);
      console.log(`\n마스터 DB: ${status.databasePath}`);
      console.log(`궁극 파이터의 귀환: 모든 기본 능력치 +${formatNumber(status.row.val0)}%`);
      if (!await confirm(rl, '효과를 5배인 +100%로 변경할까요?')) continue;
      const result = setUltimateFighterReturnFiveTimes(savePath);
      if (!result.changed) {
        console.log('\n이미 효과가 +100%로 설정돼 있습니다.');
      } else {
        console.log('\n완료: 궁극 파이터의 귀환 효과 +20% → +100%');
        console.log(`마스터 DB 백업: ${result.backupPath}`);
      }
    } else if (choice === '11') {
      const definition = getKamasResearchDefinition(savePath);
      const state = getKamasResearchState(
        save,
        definition.maximumInternalLevel,
        definition.limitBreakStart,
      );
      console.log(`\nKAMAS-A1 어설트 라이플 RE: +${state.completedDisplayLevel} 완료`);
      if (state.currentDisplayLevel > state.completedDisplayLevel) {
        console.log(`현재 연구 중: +${state.currentDisplayLevel}`);
      }
      console.log(`DB 최대 강화: +${definition.maximumDisplayLevel}`);
      if (!await confirm(rl, `연구를 최대 +${definition.maximumDisplayLevel} 완료 상태로 변경할까요?`)) continue;
      const result = writeKamasResearchMaximum(savePath, save);
      if (!result.changed) {
        console.log(`\n이미 KAMAS RE 연구가 최대 +${definition.maximumDisplayLevel}입니다.`);
      } else {
        console.log(`\n완료: KAMAS-A1 어설트 라이플 RE +${result.maximumDisplayLevel}`);
        console.log(`세이브 백업: ${result.backupPath}`);
      }
    } else if (choice === '12') {
      const status = getQueenOfSpadesStatus(savePath);
      console.log(`\n마스터 DB: ${status.databasePath}`);
      console.log(`스페이드 여왕 공격력: +${formatNumber(status.row.val0)}%`);
      console.log(`치명타 확률: +${formatNumber(status.row.val1)}% / 피해 무효화: ${formatNumber(status.row.val2)}%`);
      if (!await confirm(rl, `공격력만 +${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%로 변경할까요?`)) continue;
      const result = setQueenOfSpadesExtremeDamage(savePath);
      if (!result.changed) {
        console.log(`\n이미 공격력이 +${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%로 설정돼 있습니다.`);
      } else {
        console.log(`\n완료: 스페이드 여왕 공격력 +${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}% → +${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%`);
        console.log(`마스터 DB 백업: ${result.backupPath}`);
      }
    } else {
      console.log('\n잘못된 선택입니다.');
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
      console.log(`완료: ${resource.label} ${formatNumber(amount)}`);
      console.log(`백업: ${result.backupPath}`);
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
      console.log(`완료: ${resource.label} ${formatNumber(amount)}`);
      console.log(`백업: ${result.backupPath}`);
      return;
    }
    if (command === 'backup') {
      if (isGameRunning()) fail('LET IT DIE를 완전히 종료한 뒤 백업하세요.');
      printStatus(savePath, save);
      const backupPath = createBackup(savePath, save.packed);
      console.log(`백업 완료: ${backupPath}`);
      return;
    }
    if (command === 'reset-shop') {
      const shop = getBloodniumShopState(save);
      printStatus(savePath, save);
      if (shop.bought.length === 0) fail('복구할 블러드늄 상점 구매 완료 재고가 없습니다.');
      if (!parsed.yes && !await confirm(rl, `구매 완료 ${formatNumber(shop.bought.length)}개를 구매 가능 상태로 되돌릴까요?`)) return;
      const result = writeBloodniumShopReset(savePath, save);
      console.log(`완료: 블러드늄 상점 재고 ${formatNumber(result.restoredCount)}개 복구`);
      console.log(`현재 구매 가능: ${formatNumber(result.availableCount)}개`);
      console.log(`백업: ${result.backupPath}`);
      return;
    }
    if (command === 'grant-five-star-all') {
      printStatus(savePath, save);
      if (!parsed.yes && !await confirm(rl, '★5 프리미엄 데칼 41종을 각각 한 장씩 추가할까요?')) return;
      const result = writeFiveStarDecals(savePath, save);
      console.log(`완료: ★5 프리미엄 데칼 ${formatNumber(result.addedCount)}장 지급`);
      console.log(`새 종류: ${formatNumber(result.newTypes)} / 기존 종류 수량 증가: ${formatNumber(result.incrementedTypes)}`);
      console.log(`프리미엄 데칼 목록: ${formatNumber(result.previousStockCount)} → ${formatNumber(result.currentStockCount)}종`);
      if (result.removedHistoryCount > 0) console.log(`잘못 추가됐던 뽑기 이력 ${formatNumber(result.removedHistoryCount)}개 정리`);
      console.log(`백업: ${result.backupPath}`);
      return;
    }
    if (command === 'collision-30m') {
      const status = getCollisionMushroomStatus(savePath);
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`현재 지속시간: 일반 ${formatNumber(status.rows[0].tmmin)}초 / 구운 것 ${formatNumber(status.rows[1].tmmin)}초`);
      if (!parsed.yes && !await confirm(rl, '두 효과를 모두 1,800초(30분)로 변경할까요?')) return;
      const result = setCollisionMushroomThirtyMinutes(savePath);
      if (!result.changed) {
        console.log('이미 두 효과가 30분으로 설정돼 있습니다.');
      } else {
        console.log('완료: 충돌버섯·구운 충돌버섯 지속시간 30분');
        console.log(`마스터 DB 백업: ${result.backupPath}`);
      }
      return;
    }
    if (command === 'ultimate-fighter-5x') {
      const status = getUltimateFighterReturnStatus(savePath);
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`현재 효과: 모든 기본 능력치 +${formatNumber(status.row.val0)}%`);
      if (!parsed.yes && !await confirm(rl, '효과를 5배인 +100%로 변경할까요?')) return;
      const result = setUltimateFighterReturnFiveTimes(savePath);
      if (!result.changed) {
        console.log('이미 효과가 +100%로 설정돼 있습니다.');
      } else {
        console.log('완료: 궁극 파이터의 귀환 효과 +20% → +100%');
        console.log(`마스터 DB 백업: ${result.backupPath}`);
      }
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
        console.log(`완료: KAMAS-A1 어설트 라이플 RE +${result.maximumDisplayLevel}`);
        console.log(`세이브 백업: ${result.backupPath}`);
      }
      return;
    }
    if (command === 'queen-spades-extreme') {
      const status = getQueenOfSpadesStatus(savePath);
      console.log(`마스터 DB: ${status.databasePath}`);
      console.log(`현재 효과: 공격력 +${formatNumber(status.row.val0)}% / 치명타 +${formatNumber(status.row.val1)}% / 피해 무효화 ${formatNumber(status.row.val2)}%`);
      if (!parsed.yes && !await confirm(rl, `공격력만 +${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%로 변경할까요?`)) return;
      const result = setQueenOfSpadesExtremeDamage(savePath);
      if (!result.changed) {
        console.log(`이미 공격력이 +${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%로 설정돼 있습니다.`);
      } else {
        console.log(`완료: 스페이드 여왕 공격력 +${QUEEN_OF_SPADES_BASE_ATTACK_PERCENT}% → +${formatNumber(QUEEN_OF_SPADES_EXTREME_ATTACK_PERCENT)}%`);
        console.log(`마스터 DB 백업: ${result.backupPath}`);
      }
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
      console.log('복원 완료');
      for (const [resourceKey, value] of Object.entries(result.restoredResources)) {
        console.log(`${RESOURCES[resourceKey].label}: ${formatNumber(value)}`);
      }
      console.log(`복원 전 안전 백업: ${result.safetyBackup}`);
      return;
    }

    fail('사용법: node lid-kc.js [status | backup | reset-shop | grant-five-star-all | collision-30m | ultimate-fighter-5x | kamas-re-max | queen-spades-extreme | set [kc|sp|blood] 숫자 | max [kc|sp|blood] | restore] [--save 경로] [--yes]');
  } finally {
    if (rl) rl.close();
  }
}

main().catch((error) => {
  console.error(`\n오류: ${error.message}`);
  if (!error.userFacing && process.env.LID_KC_DEBUG === '1') console.error(error.stack);
  process.exitCode = 1;
});
