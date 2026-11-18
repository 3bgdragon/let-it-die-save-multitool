# LET IT DIE 5.0.6 / Steam build 26639365 — save-tool validation

2026-11-19. The save multitool was tested against the acquired clean updated DB and a private copy of the local packed save. Normal editing remained compatible, but a legacy whole-DB fighter-limit restoration defect was reproduced and fixed. This is not in-game or save-transfer certification.

## Observed format/data changes

- New stock DB SHA-256: `db9a81a1eb05036eb7171a993958d17a048889491fb2326cd5d686e8e010fd7a` (59,523,072 bytes; no sibling WAL in the acquired snapshot).
- REA SQLite inventory `ev_33318ebeb75d371a232d50d4dc8c5baddded935627c41c7fde2f08c23c81d4c4` observed 222 tables, the same count as the previous stock snapshot. The `master_item` schema adds `sell_spirit INTEGER NOT NULL DEFAULT '0'`; selected-table evidence: `ev_b028fadfde19cbbf8134a58e764db37177f2e010adc4a0f2f76e9bbc1c5e4aa2`.
- Read-only full-row comparison found six Deathroid rows `ITMT_STEROID_1`–`6` with new killcoin prices 2,000 / 4,000 / 8,000 / 12,000 / 18,000 / 24,000 and SPLithium values 4,000 / 8,000 / 16,000 / 24,000 / 36,000 / 48,000. The save tool must leave these new vanilla values and the item schema intact.
- Fighter/stat, skill, research, jackal and M2G target tables were logically unchanged from build 25923506. Broader DB changes also include strings/text, credits, terms, word filtering and monitoring data. These are not replaced with old data.
- The sampled save remains `BRG\0`, version 2, `ZLIB`, four blocks and a four-zero-byte trailer. Its top-level and user key sets matched the older local save. Existing shop ID fields remain strings; the weekly field remains the existing `"{}"` JSON-object representation, not a CSV list. JSON field names/types do not establish native class memory offsets.

## Verification

- Syntax and the final full unit suite passed with the acquired actual-DB fixture: 59 passed, 0 failed, 0 skipped (`unit-results-GvHICp/results.json`). This includes seven restoration-safety cases and two new-build DB cases, with the final WAL-race and Node 22.5 statement-API regressions.
- Actual updated DB/save-copy production probes: 21 passed. Fighters, valid DB maxima, expanded level/EXP tables, bag +50 across eight classes, equipment material/SPLithium requirements, recipes, decals, beasts, mastery/research, jackal settings, M2G DB compensation and six skill options were exercised.
- Packed-save checks: 23 passed. Three currencies, ten fighters' DB-maximum presets, maximum valid bonuses, existing purchased-Bloodnium-stock refill, decals/beasts/recipes/research and invalid-bonus refusal were checked. Facilities/masteries were already maximum, so those two cases were genuine no-ops. The other 20 cases wrote disposable copies and verified exact original backups/restoration; invalid bonuses caused no write. The existing stock-refill case changed only its two Bloodnium history fields and preserved other shop fields.
- The DB probes verified that `master_item` (including `sell_spirit`) and both vanilla automatic-shop tables retained their schemas and all rows in every probe DB/backup. SQLite integrity checks passed.
- New opt-in tests in `tests/build-26639365.test.js` specifically protect the new Deathroid data during DB option application/restoration. Run with `LID_SAVE_BUILD26639365_DB` pointing to an offline clean snapshot; absent fixtures are explicit skips, not executed passes.

## Fixed: old whole-DB fighter-limit restoration

Before the fix, selecting a build-25923506 DB backup for fighter-limit restoration copied it over the new DB and passed SQLite integrity verification, silently removing `sell_spirit` and reverting the new sale prices. This was reproduced only on a disposable new DB.

Whole-DB fighter-limit restoration now checks both DBs' integrity, exact non-internal schema and all non-fighter table content before creating or copying any game data. A schema change or unrelated table difference is refused without modifying the installed DB or the older backup. Read-only checks also reject DB sidecars. Input bytes are checked again before restoration; a concurrent change after the safety backup causes refusal instead of a rollback that overwrites that external change. Valid matching current-build fighter backups still restore exactly. New shop functionality is not added.

Table comparisons preserve exact 64-bit integers, distinguish SQL integers from text and compare row multisets independently of physical row order. Actual matching-new-build restoration was repeated after this change and returned the exact stock DB hash while retaining an exact pre-operation safety backup.

The comparison uses the Node 22.5 SQLite statement API (`all` and `setReadBigInts`). A regression runs the actual comparison module through statements without the later `iterate` method.

This is deliberately conservative: if another mod or the game changed unrelated DB data after that backup, whole-DB fighter restoration stops. Use a matching current-build backup rather than forcing an old whole image over newer data.

DB sidecar checks are repeated before creating the safety backup and immediately before installing the captured backup bytes. A WAL appearing during that interval is preserved and causes refusal, even when the main DB file hash has not changed. These are bounded pre-write checks, not an atomic lock against a new external writer starting after the last check.

A bounded production-source audit covered every `copyFileSync`, `writeFileSync` and `renameSync` site outside tests/dev. Fighter-limit restoration was the only path selecting an external whole-DB backup for installation. Other DB copybacks use snapshots created from the current DB in the same operation after a failed verification; material/SPLithium, bag, jackal and M2G restoration normally updates only scoped SQL data. Packed-save backup restoration does not write `masters.db`. This audit does not certify arbitrary concurrent external writers.

## Boundaries / 한국어

실제 게임·원본 세이브는 수정하지 않았습니다. 새 DB의 데스로이드 판매·스피리튬 값과 기존 상점 데이터는 그대로 보존합니다. 상점 기능을 새로 추가하거나 EXE/UPK를 수정하지 않습니다. 파일 처리 검증은 실게임 스탯 계산·데스로이드 분해/판매 UI·저장 재접속·다른 PC 세이브 이식 성공을 의미하지 않습니다. 세이브는 별도로 백업하세요.
