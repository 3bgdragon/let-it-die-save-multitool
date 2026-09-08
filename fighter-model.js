'use strict';
const { DatabaseSync } = require('node:sqlite');
const STAT_KEYS = ['hp', 'str', 'dex', 'vit', 'stm', 'luk'];
const EXTRA_KEYS = ['skill', 'bag', 'rage'];
const BONUS_KEYS = STAT_KEYS.map(key => `${key}_bonus`);
const capacity = (row, key) => key === 'skill' ? String(row.skill_slots || '').split(',').filter(Boolean).length : row[`${key}_capacity`];

// Matches BrgDatabase._Get{Skill,Bag,Rage}ParamLevel: upgrade count -> DB row.
function paramLevel(details, key, count) {
  if (!Number.isInteger(count) || count < 0) throw new Error(`${key}: 추가 레벨은 0 이상의 정수여야 합니다.`);
  if (count === 0) return details[0].param_lv_max;
  for (let i = 1; i < details.length; i++) {
    const range = capacity(details[i], key) - capacity(details[i - 1], key);
    if (range < 0) throw new Error(`${key}: DB 단계별 용량이 감소합니다.`);
    if (count <= range) return details[i - 1].param_lv_max + count;
    count -= range;
  }
  return details.at(-1).param_lv_max + count;
}

function readFighterLimits(databasePath, fighter) {
  if (!fighter || typeof fighter.type !== 'string' || !Number.isInteger(fighter.grade) || fighter.grade < 1) throw new Error('파이터 클래스·등급 정보를 확인할 수 없습니다.');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const details = db.prepare('SELECT * FROM master_body_detail WHERE type=? AND grade=? ORDER BY limit_break').all(fighter.type, fighter.grade);
    if (!details.length || details.some((row, i) => row.limit_break !== i || !Number.isInteger(row.param_lv_max) || row.param_lv_max < 1)) throw new Error('선택한 파이터의 연속된 DB 상한 정보가 없습니다.');
    const declaredMax = details.at(-1).param_lv_max;
    const rows = db.prepare('SELECT * FROM master_bodylvl_status_value WHERE type=? AND grade=? AND lvl BETWEEN 1 AND ? ORDER BY lvl').all(fighter.type, fighter.grade, declaredMax);
    const levels = {}, maxima = {};
    for (const key of STAT_KEYS) {
      levels[key] = rows.filter(row => Number.isInteger(row.lvl) && Number.isFinite(row[key]) && row[key] > 0 && details[row.limit_break]).map(row => row.lvl);
      if (!levels[key].length) throw new Error(`${key.toUpperCase()}의 유효한 DB 능력치 데이터가 없습니다.`);
      maxima[key] = Math.max(...levels[key]);
    }
    const bonusValues = [...new Set([0, 5, 10, 15, 20].map(rate => Math.floor(details[0].param_lv_max * rate / 100)))];
    const extraMaxima = {};
    for (const key of EXTRA_KEYS) {
      const cap = Math.max(0, capacity(details.at(-1), key) - capacity(details[0], key));
      if (!Number.isSafeInteger(cap) || cap > 1000) throw new Error(`${key}: DB 용량 정보가 올바르지 않습니다.`);
      extraMaxima[key] = 0;
      for (let count = 1; count <= cap; count++) {
        const row = rows.find(row => row.lvl === paramLevel(details, key, count));
        if (!row || !(row[key] > 0) || (key === 'skill' && row[key] > 9)) break;
        extraMaxima[key] = count;
      }
    }
    const totalLevels = db.prepare('SELECT lvl FROM master_bodylvl_exp WHERE grade=?').all(fighter.grade).map(row => row.lvl);
    return { levels, maxima, totalLevels, declaredMax, bonusValues, bonusMax: Math.max(...bonusValues), details, rows, extraMaxima };
  } finally { db.close(); }
}

function inspectFighter(limits, stats) {
  const converted = Object.fromEntries(EXTRA_KEYS.map(key => [key, paramLevel(limits.details, key, stats[key] ?? 0)]));
  let maximum = Math.max(...STAT_KEYS.map(key => stats[key]), ...Object.values(converted));
  if (limits.details[1] && maximum <= limits.details[1].param_lv_max) maximum = Math.max(...STAT_KEYS.map(key => stats[key] - (stats[`${key}_bonus`] ?? 0)), ...Object.values(converted));
  const row = limits.rows.find(row => row.lvl === maximum);
  return { converted, maximum, limitBreak: row?.limit_break,
    slots: limits.rows.find(row => row.lvl === converted.skill)?.skill,
    bag: limits.rows.find(row => row.lvl === converted.bag)?.bag };
}

function validateFighterStatUpdates(databasePath, fighter, updates) {
  const limits = readFighterLimits(databasePath, fighter);
  const next = { ...fighter.stats };
  for (const [key, value] of Object.entries(updates)) if (value != null) next[key] = value;
  for (const key of BONUS_KEYS) if (!limits.bonusValues.includes(next[key] ?? 0)) throw new Error(`${key.toUpperCase()} 값 ${next[key]}은(는) 순정 보너스 범위(${limits.bonusValues.join(', ')})에 없습니다. DB 최대 설정으로 함께 정리하세요.`);
  for (const key of STAT_KEYS) if (!limits.levels[key].includes(next[key])) throw new Error(`${key.toUpperCase()} 레벨 ${next[key]}의 유효한 데이터가 없습니다 (DB 최대 ${limits.maxima[key]}).`);
  const state = inspectFighter(limits, next);
  for (const key of EXTRA_KEYS) {
    const value = next[key] ?? 0;
    const row = limits.rows.find(row => row.lvl === state.converted[key]);
    if (!row || !(row[key] > 0) || value > limits.extraMaxima[key]) throw new Error(`${key} +${value} → 판정 레벨 ${state.converted[key]}: 유효한 DB 용량 데이터가 없습니다 (추가 최대 +${limits.extraMaxima[key]}). DB 최대 설정으로 함께 정리하세요.`);
  }
  if (state.limitBreak === undefined) throw new Error(`한계돌파 판정 레벨 ${state.maximum}의 DB 데이터가 없습니다.`);
  const total = STAT_KEYS.reduce((sum, key) => sum + next[key], -5) + EXTRA_KEYS.reduce((sum, key) => sum + (next[key] ?? 0), 0);
  // The stock XP table ends one level before a fully completed fighter:
  // grade 6 BAL: 6*45-5+4+12 = 281, last payable XP row = 280.
  const completed = STAT_KEYS.every(key => next[key] === limits.maxima[key]) && EXTRA_KEYS.every(key => (next[key] ?? 0) === limits.extraMaxima[key]);
  const terminal = completed && total === Math.max(...limits.totalLevels) + 1;
  if (!Number.isSafeInteger(total) || (!limits.totalLevels.includes(total) && !terminal)) throw new Error(`변경 후 총 레벨 ${total}의 경험치 데이터가 현재 DB에 없습니다.`);
  return state;
}

function buildFighterMaximum(databasePath, fighter, stock = false) {
  const limits = readFighterLimits(databasePath, fighter);
  const updates = { ...limits.maxima, ...limits.extraMaxima };
  if (stock && fighter.grade === 6) for (const key of STAT_KEYS) updates[key] = Math.max(...limits.levels[key].filter(value => value <= 45));
  for (const key of BONUS_KEYS) {
    const value = fighter.stats[key] ?? 0;
    updates[key] = limits.bonusValues.includes(value) ? value : limits.bonusMax;
  }
  validateFighterStatUpdates(databasePath, fighter, updates);
  return updates;
}
module.exports = { readFighterLimits, validateFighterStatUpdates, buildFighterMaximum, inspectFighter, paramLevel };
