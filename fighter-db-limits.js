'use strict';
const { DatabaseSync } = require('node:sqlite');
const STAT_KEYS = ['hp', 'str', 'dex', 'vit', 'stm', 'luk'];

function readFighterLimits(databasePath, fighter) {
  if (!fighter || typeof fighter.type !== 'string' || !Number.isInteger(fighter.grade) ||
      !Number.isInteger(fighter.limitBreak) || fighter.grade < 1 || fighter.limitBreak < 0) {
    throw new Error('파이터 클래스·등급·한계돌파 정보를 확인할 수 없습니다.');
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const detail = db.prepare('SELECT param_lv_max FROM master_body_detail WHERE type = ? AND grade = ? AND limit_break = ?')
      .get(fighter.type, fighter.grade, fighter.limitBreak);
    if (!detail || !Number.isInteger(detail.param_lv_max) || detail.param_lv_max < 1) {
      throw new Error('선택한 파이터의 DB 능력치 상한 정보가 없습니다. 저장하지 않습니다.');
    }
    const rows = db.prepare(`SELECT lvl, hp, str, dex, vit, stm, luk FROM master_bodylvl_status_value
      WHERE type = ? AND grade = ? AND limit_break <= ? AND lvl BETWEEN 1 AND ? ORDER BY lvl`)
      .all(fighter.type, fighter.grade, fighter.limitBreak, detail.param_lv_max);
    const levels = {}, maxima = {};
    for (const key of STAT_KEYS) {
      // A declared cap or a placeholder row alone is not a usable stat value.
      levels[key] = [...new Set(rows.filter((r) => Number.isInteger(r.lvl) && Number.isFinite(r[key]) && r[key] > 0).map((r) => r.lvl))];
      if (!levels[key].length) throw new Error(`${key.toUpperCase()}의 유효한 DB 능력치 데이터가 없습니다.`);
      maxima[key] = Math.max(...levels[key]);
    }
    const totalLevels = db.prepare('SELECT lvl FROM master_bodylvl_exp WHERE grade = ?').all(fighter.grade).map((r) => r.lvl);
    return { levels, maxima, totalLevels, declaredMax: detail.param_lv_max };
  } finally { db.close(); }
}

function validateFighterStatUpdates(databasePath, fighter, updates) {
  if (!STAT_KEYS.some((key) => updates[key] !== undefined && updates[key] !== null)) return;
  const limits = readFighterLimits(databasePath, fighter);
  const next = { ...fighter.stats, ...updates };
  for (const key of STAT_KEYS) {
    if (!Number.isInteger(next[key]) || !limits.levels[key].includes(next[key])) {
      throw new Error(`${key.toUpperCase()} 레벨 ${next[key]}은(는) 선택한 파이터의 현재 DB에 유효한 데이터가 없습니다 (유효 최대 ${limits.maxima[key]}). 세이브는 변경하지 않았습니다. DB 최대 설정으로 유효한 값에 맞추세요.`);
    }
  }
  const total = STAT_KEYS.reduce((sum, key) => sum + next[key], -5) + (next.skill ?? 0) + (next.bag ?? 0) + (next.rage ?? 0);
  if (!Number.isSafeInteger(total) || !limits.totalLevels.includes(total)) {
    throw new Error(`변경 후 총 레벨 ${total}의 경험치 데이터가 현재 DB에 없습니다. 세이브는 변경하지 않았습니다. 가방·슬롯·레이지 확장값 또는 DB 상한 설정을 확인하세요.`);
  }
}
module.exports = { readFighterLimits, validateFighterStatUpdates };
