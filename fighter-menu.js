'use strict';
const model = require('./fighter-model');
const STAT_LABELS = { hp: 'HP 체력', str: 'STR 공격력', dex: 'DEX 기교', vit: 'VIT 방어', stm: 'STM 스태미나', luk: 'LUK 행운' };
const KEYS = Object.keys(STAT_LABELS);
const totalLevel = stats => KEYS.reduce((sum, key) => sum + stats[key], -5) + ['skill', 'bag', 'rage'].reduce((sum, key) => sum + (stats[key] ?? 0), 0);

function capacityChoices(limits, key) {
  const choices = [];
  for (let count = 0; count <= limits.extraMaxima[key]; count++) {
    const row = limits.rows.find(row => row.lvl === model.paramLevel(limits.details, key, count));
    if (row?.[key] > 0) choices.push({ value: row[key], count });
  }
  return choices;
}

function capacities(limits, stats) {
  return Object.fromEntries(['skill', 'bag', 'rage'].map(key => {
    try {
      const row = limits.rows.find(row => row.lvl === model.paramLevel(limits.details, key, stats[key] ?? 0));
      return [key, row?.[key] > 0 ? row[key] : '확인 불가'];
    } catch { return [key, '확인 불가']; }
  }));
}

function overviewLines(fighter, limits) {
  const current = capacities(limits, fighter.stats);
  const maximum = capacities(limits, { ...limits.maxima, ...limits.extraMaxima });
  const levels = KEYS.map(key => fighter.stats[key]);
  return [
    `\n── ${fighter.name} · ${fighter.grade}성 ${fighter.typeName || fighter.type} · ${fighter.state || '파이터'} ──`,
    `현재 총 레벨: Lv.${fighter.stats.lvl ?? totalLevel(fighter.stats)}`,
    `능력치 레벨: ${KEYS.map(key => `${key.toUpperCase()} ${fighter.stats[key]}`).join(' / ')}`,
    `데칼 ${current.skill}칸 · 가방 ${current.bag}칸 · 분노 ${current.rage}칸`,
    '',
    `DB 최대 강화: ${new Set(Object.values(limits.maxima)).size === 1 ? `능력치 각각 Lv.${limits.maxima.hp}` : KEYS.map(key => `${key.toUpperCase()} ${limits.maxima[key]}`).join(' / ')} · 데칼 ${maximum.skill}칸 · 가방 ${maximum.bag}칸`,
    '능력치 레벨은 성장 단계입니다. 실제 HP·공격력 수치와는 다릅니다.',
    ...(fighter.grade === 6 && limits.maxima.hp < 50 ? ['Lv.50까지 강화하려면 메인 메뉴의 «Lv.50 강화 준비»를 먼저 적용하세요.'] : []),
    ...(String(limits.details.at(-1).skill_slots).split(',').length > 9 ? ['게임에 슬롯 15칸 등 이전 설정이 남아 있습니다. 메인 메뉴 «Lv.50 강화 준비 / 슬롯 상한 정리»로 정리하세요.'] : []),
    ...(levels.some(value => !Number.isInteger(value)) || current.bag === '확인 불가' ? ['현재 설정에 확인할 수 없는 값이 있습니다. «DB 최대 강화»에서 정리 내용을 확인하세요.'] : []),
  ];
}

function previewLines(fighter, limits, updates, modeDesc) {
  const before = fighter.stats, after = { ...before, ...updates };
  const oldCapacity = capacities(limits, before), newCapacity = capacities(limits, after);
  const lines = [`\n── 적용 미리보기: ${fighter.name} / ${modeDesc} ──`, '항목: 현재 → 적용 후'];
  for (const key of KEYS) lines.push(`${STAT_LABELS[key]} 레벨: ${before[key]} → ${after[key]}`);
  for (const [key, label] of [['skill', '데칼'], ['bag', '가방'], ['rage', '분노']]) lines.push(`${label}: ${oldCapacity[key]}칸 → ${newCapacity[key]}칸`);
  lines.push(`총 레벨: ${before.lvl ?? totalLevel(before)} → ${totalLevel(after)}`);
  const changedBonuses = KEYS.filter(key => (before[`${key}_bonus`] ?? 0) !== (after[`${key}_bonus`] ?? 0));
  for (const key of changedBonuses) lines.push(`${key.toUpperCase()} 생성 보너스: +${before[`${key}_bonus`] ?? 0} → +${after[`${key}_bonus`] ?? 0}`);
  if (!changedBonuses.length) lines.push('생성 보너스: 현재 값 유지');
  lines.push('적용하면 세이브를 자동 백업한 뒤 이 파이터를 저장합니다.');
  return lines;
}

async function chooseFighterUpdate({ rl, fighter, databasePath, confirm, print = console.log }) {
  const limits = model.readFighterLimits(databasePath, fighter);
  const ask = async prompt => (await rl.question(prompt)).trim();
  const show = lines => lines.forEach(line => print(line));
  const inputValue = async (label, allowed) => {
    const contiguous = allowed.length > 2 && allowed.every((value, i) => value === allowed[0] + i);
    const hint = contiguous ? `${allowed[0]}~${allowed.at(-1)}` : allowed.join(', ');
    const input = await ask(`${label} (${hint} / 빈칸=취소): `);
    if (!input) return null;
    const value = Number(input);
    if (!Number.isInteger(value) || !allowed.includes(value)) throw new Error('표시된 값 중 하나를 입력하세요.');
    return value;
  };
  while (true) {
    show(overviewLines(fighter, limits));
    show(['', '1. DB 최대 강화 (가장 강하게)', '2. 순정 최대 설정 (6성 능력치는 최대 45)', '3. 직접 설정', '4. 상세 정보 보기', '0. 파이터 설정 나가기']);
    const choice = await ask('선택: ');
    if (!choice || choice === '0') return null;
    try {
      let updates, modeDesc;
      if (choice === '1' || choice === '2') {
        updates = model.buildFighterMaximum(databasePath, fighter, choice === '2');
        modeDesc = choice === '1' ? 'DB 최대 강화' : '순정 최대 설정';
        print('능력치·데칼·가방·분노를 함께 맞춥니다. 잘못된 생성 보너스가 있으면 정리합니다.');
      } else if (choice === '4') {
        let state;
        try { state = model.inspectFighter(limits, fighter.stats); } catch {}
        print(`현재 DB: ${databasePath}`);
        print(`한계돌파 계산: ${state?.limitBreak ?? '확인 불가'} / 세이브 기록: ${fighter.limitBreak}`);
        print(`생성 보너스 허용값: ${limits.bonusValues.join(', ')}`);
        for (const key of KEYS) print(`${STAT_LABELS[key]}: 레벨 ${fighter.stats[key]} / DB 최대 ${limits.maxima[key]} / 생성 보너스 +${fighter.stats[`${key}_bonus`] ?? 0}`);
        for (const key of ['skill', 'bag', 'rage']) print(`${key} 저장값: +${fighter.stats[key] ?? 0} / DB 환산 레벨 ${state?.converted[key] ?? '확인 불가'}`);
        await ask('Enter를 누르면 파이터 메뉴로 돌아갑니다.');
        continue;
      } else if (choice === '3') {
        show(['\n── 직접 설정 ──', '1. 6개 능력치 레벨을 같은 값으로', '2. 능력치 하나만 변경', '3. 데칼 칸 수', '4. 가방 칸 수', '5. 생성 보너스 (고급)', '6. 분노 칸 수', '0. 돌아가기']);
        const custom = await ask('선택: ');
        if (!custom || custom === '0') continue;
        if (custom === '1') {
          const allowed = limits.levels.hp.filter(value => KEYS.every(key => limits.levels[key].includes(value)));
          const value = await inputValue('능력치 레벨', allowed);
          if (value === null) continue;
          updates = Object.fromEntries(KEYS.map(key => [key, value]));
          modeDesc = '6개 능력치 레벨 변경';
        } else if (custom === '2') {
          show(KEYS.map((key, i) => `${i + 1}. ${STAT_LABELS[key]}`));
          const index = await ask('번호 (빈칸 또는 0=취소): ');
          if (!index || index === '0') continue;
          const key = KEYS[Number(index) - 1];
          if (!key) throw new Error('능력치 번호를 확인하세요.');
          const value = await inputValue(`${STAT_LABELS[key]} 레벨`, limits.levels[key]);
          if (value === null) continue;
          updates = { [key]: value }; modeDesc = `${STAT_LABELS[key]} 변경`;
        } else if (['3', '4', '6'].includes(custom)) {
          const key = { '3': 'skill', '4': 'bag', '6': 'rage' }[custom];
          const label = { skill: '데칼', bag: '가방', rage: '분노' }[key];
          const choices = capacityChoices(limits, key);
          const value = await inputValue(`${label} 최종 칸 수`, [...new Set(choices.map(item => item.value))]);
          if (value === null) continue;
          const existing = choices.find(item => item.value === value && item.count === (fighter.stats[key] ?? 0));
          updates = { [key]: (existing || choices.find(item => item.value === value)).count };
          modeDesc = `${label} ${value}칸 설정`;
        } else if (custom === '5') {
          print('생성 보너스는 파이터 생성 시 정해지는 별도 값입니다. 보너스 +50은 지원하지 않습니다.');
          print('m. 6개 보너스를 등급별 최대값으로 / a. 6개를 같은 값으로 / 1~6. HP·STR·DEX·VIT·STM·LUK 중 하나');
          const bonus = await ask('선택 (빈칸 또는 0=취소): ');
          if (!bonus || bonus === '0') continue;
          const key = KEYS[Number(bonus) - 1];
          if (!['m', 'a'].includes(bonus) && !key) throw new Error('보너스 항목을 확인하세요.');
          const value = bonus === 'm' ? limits.bonusMax : await inputValue('생성 보너스', limits.bonusValues);
          if (value === null) continue;
          updates = Object.fromEntries((key ? [key] : KEYS).map(k => [`${k}_bonus`, value]));
          modeDesc = '생성 보너스 설정';
        } else { throw new Error('메뉴 번호를 확인하세요.'); }
      } else { throw new Error('메뉴 번호를 확인하세요.'); }
      model.validateFighterStatUpdates(databasePath, fighter, updates);
      show(previewLines(fighter, limits, updates, modeDesc));
      if (await confirm(rl, '위 내용으로 적용할까요?')) return { updates, modeDesc };
      print('취소했습니다. 파이터 메뉴로 돌아갑니다.');
    } catch (error) { print(`\n설정할 수 없습니다: ${error.message}`); }
  }
}
module.exports = { chooseFighterUpdate, overviewLines, previewLines, capacityChoices };
