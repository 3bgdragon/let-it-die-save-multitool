'use strict';
const { message: tr } = require('./language');

const model = require('./fighter-model');
const STAT_LABELS = { hp: tr(755), str: tr(756), dex: tr(757), vit: tr(758), stm: tr(759), luk: tr(760) };
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
      return [key, row?.[key] > 0 ? row[key] : tr(761)];
    } catch { return [key, tr(761)]; }
  }));
}

function overviewLines(fighter, limits) {
  const current = capacities(limits, fighter.stats);
  const maximum = capacities(limits, { ...limits.maxima, ...limits.extraMaxima });
  const levels = KEYS.map(key => fighter.stats[key]);
  return [
    tr(762, fighter.name, fighter.grade, fighter.typeName || fighter.type, fighter.state || tr(763)),
    tr(764, fighter.stats.lvl ?? totalLevel(fighter.stats)),
    tr(765, KEYS.map(key => `${key.toUpperCase()} ${fighter.stats[key]}`).join(' / ')),
    tr(766, KEYS.map(key => `${key.toUpperCase()} +${fighter.stats[`${key}_bonus`] ?? 0}`).join(' / ')),
    tr(767, current.skill, current.bag, current.rage),
    '',
    tr(768, new Set(Object.values(limits.maxima)).size === 1 ? tr(769, limits.maxima.hp) : KEYS.map(key => `${key.toUpperCase()} ${limits.maxima[key]}`).join(' / '), maximum.skill, maximum.bag),
    tr(770),
    tr(771, limits.bonusValues.map(value => `+${value}`).join(', ')),
    ...(fighter.grade === 6 && limits.maxima.hp < 50 ? [tr(772)] : []),
    ...(String(limits.details.at(-1).skill_slots).split(',').length > 9 ? [tr(773)] : []),
    ...(levels.some(value => !Number.isInteger(value)) || current.bag === tr(761) ? [tr(774)] : []),
  ];
}

function previewLines(fighter, limits, updates, modeDesc) {
  const before = fighter.stats, after = { ...before, ...updates };
  const oldCapacity = capacities(limits, before), newCapacity = capacities(limits, after);
  const lines = [tr(775, fighter.name, modeDesc), tr(776)];
  for (const key of KEYS) lines.push(tr(777, STAT_LABELS[key], before[key], after[key]));
  for (const [key, label] of [['skill', tr(778)], ['bag', tr(779)], ['rage', tr(780)]]) lines.push(tr(781, label, oldCapacity[key], newCapacity[key]));
  lines.push(tr(782, before.lvl ?? totalLevel(before), totalLevel(after)));
  const changedBonuses = KEYS.filter(key => (before[`${key}_bonus`] ?? 0) !== (after[`${key}_bonus`] ?? 0));
  for (const key of changedBonuses) lines.push(tr(783, key.toUpperCase(), before[`${key}_bonus`] ?? 0, after[`${key}_bonus`] ?? 0));
  if (!changedBonuses.length) lines.push(tr(784));
  lines.push(tr(785));
  return lines;
}

async function chooseFighterUpdate({ rl, fighter, databasePath, confirm, manageBag, print = console.log }) {
  const ask = async prompt => (await rl.question(prompt)).trim();
  const show = lines => lines.forEach(line => print(line));
  const inputValue = async (label, allowed) => {
    const contiguous = allowed.length > 2 && allowed.every((value, i) => value === allowed[0] + i);
    const hint = contiguous ? `${allowed[0]}~${allowed.at(-1)}` : allowed.join(', ');
    const input = await ask(tr(786, label, hint));
    if (!input) return null;
    const value = Number(input);
    if (!Number.isInteger(value) || !allowed.includes(value)) throw new Error(tr(787));
    return value;
  };
  while (true) {
    const limits = model.readFighterLimits(databasePath, fighter);
    show(overviewLines(fighter, limits));
    show(['', tr(788), tr(789), tr(790), tr(791), ...(manageBag && fighter.grade===6 ? [tr(792)] : []), tr(793)]);
    const choice = await ask(tr(794));
    if (!choice || choice === '0') return null;
    try {
      let updates, modeDesc;
      if (choice === '5' && manageBag && fighter.grade === 6) {
        await manageBag(fighter);
        continue;
      } else if (choice === '1' || choice === '2') {
        updates = model.buildFighterMaximum(databasePath, fighter, choice === '2');
        modeDesc = choice === '1' ? tr(795) : tr(796);
        print(tr(797));
      } else if (choice === '4') {
        let state;
        try { state = model.inspectFighter(limits, fighter.stats); } catch {}
        print(tr(798, databasePath));
        print(tr(799, state?.limitBreak ?? tr(761), fighter.limitBreak));
        print(tr(800, limits.bonusValues.join(', ')));
        for (const key of KEYS) print(tr(801, STAT_LABELS[key], fighter.stats[key], limits.maxima[key], fighter.stats[`${key}_bonus`] ?? 0));
        for (const key of ['skill', 'bag', 'rage']) print(tr(802, key, fighter.stats[key] ?? 0, state?.converted[key] ?? tr(761)));
        await ask(tr(803));
        continue;
      } else if (choice === '3') {
        show([tr(804), tr(805), tr(806), tr(807), tr(808), tr(809), tr(810), tr(811)]);
        const custom = await ask(tr(794));
        if (!custom || custom === '0') continue;
        if (custom === '1') {
          const allowed = limits.levels.hp.filter(value => KEYS.every(key => limits.levels[key].includes(value)));
          const value = await inputValue(tr(812), allowed);
          if (value === null) continue;
          updates = Object.fromEntries(KEYS.map(key => [key, value]));
          modeDesc = tr(813);
        } else if (custom === '2') {
          show(KEYS.map((key, i) => `${i + 1}. ${STAT_LABELS[key]}`));
          const index = await ask(tr(814));
          if (!index || index === '0') continue;
          const key = KEYS[Number(index) - 1];
          if (!key) throw new Error(tr(815));
          const value = await inputValue(tr(816, STAT_LABELS[key]), limits.levels[key]);
          if (value === null) continue;
          updates = { [key]: value }; modeDesc = tr(817, STAT_LABELS[key]);
        } else if (['3', '4', '6'].includes(custom)) {
          const key = { '3': 'skill', '4': 'bag', '6': 'rage' }[custom];
          const label = { skill: tr(778), bag: tr(779), rage: tr(780) }[key];
          const choices = capacityChoices(limits, key);
          const value = await inputValue(tr(818, label), [...new Set(choices.map(item => item.value))]);
          if (value === null) continue;
          const existing = choices.find(item => item.value === value && item.count === (fighter.stats[key] ?? 0));
          updates = { [key]: (existing || choices.find(item => item.value === value)).count };
          modeDesc = tr(819, label, value);
        } else if (custom === '5') {
          print(tr(820));
          print(tr(821));
          print(tr(822));
          const bonus = await ask(tr(823));
          if (!bonus || bonus === '0') continue;
          const key = KEYS[Number(bonus) - 1];
          if (!['m', 'a'].includes(bonus) && !key) throw new Error(tr(824));
          const value = bonus === 'm' ? limits.bonusMax : await inputValue(tr(825), limits.bonusValues);
          if (value === null) continue;
          updates = Object.fromEntries((key ? [key] : KEYS).map(k => [`${k}_bonus`, value]));
          modeDesc = tr(826);
        } else { throw new Error(tr(827)); }
      } else { throw new Error(tr(827)); }
      model.validateFighterStatUpdates(databasePath, fighter, updates);
      show(previewLines(fighter, limits, updates, modeDesc));
      if (await confirm(rl, tr(828))) return { updates, modeDesc };
      print(tr(829));
    } catch (error) { print(tr(830, error.message)); }
  }
}
module.exports = { chooseFighterUpdate, overviewLines, previewLines, capacityChoices };
