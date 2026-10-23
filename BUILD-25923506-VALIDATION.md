# Steam build 25923506 — save-tool file compatibility

Validated 2026-10-23 against save multitool 5.9.2-rc.1. No production-code change was required by the observed new-build tests. This is not live-gameplay certification.

## Inputs and isolation

- Updated installation's `masters.db`: SHA-256 `3b4cbda81b883ab2f8fce2af85ef7f7559951d7b6c335645c10d8f58a7ddc11d`.
- A read-only acquisition of the local packed save was copied to an isolated workspace. All transformations, DB updates, backups, renames and restores used disposable copies. The original save and input DB hashes remained unchanged.
- The save tool still modifies only its scoped save/DB data. No EXE or UPK modification was added.

## Completed checks

- Syntax checks passed. Unit tests: 50 passed, 0 failed, 0 skipped. The initial sandbox-only rename denial was retested with the same suite outside that restriction and passed; no product workaround was introduced.
- Current-data production probes: 21 passed. They cover all ten local fighters' class/grade DB-maximum presets, material and SPLithium requirement edits/restoration, bag expansion for all eight classes, jackal timer/blueprint weights, M2G DB compensation, decals, golden beasts, limited/all recipes, facility/mastery/research maxima and six skill options.
- Stock 6-star stat maximum remained 45 in this DB; the scoped DB extension reached 50 with EXP conversion through 500 and nine decal slots, then restored the DB exactly. Bag expansion added 50 to each class's own capacity rather than using one shared capacity.
- Packed-save writer checks: 9 passed, including two already-maximum no-ops. Seven actual write cases exercised killcoins, fighter maximum, decals, golden beasts, limited/all recipes and equipment research. Each actual write preserved the packed block count/trailer, produced an exact preimage backup and restored the original bytes. Temporary/rollback files were not left behind.
- SQLite integrity checks passed for the input and DB probe copies. Production DB setters were reapplied as no-ops and restored either their targeted rows or full backup as appropriate to the existing implementation.

## Boundaries

The sampled save is one local account, not every possible save. The unit suite also tests malformed/conflicting data and old layout fixtures, but does not exhaust every save/mod combination. Two packed-writer cases were genuine no-ops because facilities/masteries were already maximum; their mutation paths have separate synthetic/in-memory coverage, not a new-build actual save write in this run.

No game session was used to validate computed fighter HP/damage, damage caps, real purchases, reload persistence or interactions with every external mod. Valid files and DB integrity do not establish runtime safety for arbitrary extreme values. Keep independent save backups.

## 한국어 요약

빌드 25923506의 실제 DB와 세이브 복사본으로 기존 세이브툴을 검증했습니다. 단위 테스트 50개, 실제 데이터 처리 21개, 압축 세이브 쓰기/무변경 9개가 통과했습니다. 확인된 새 빌드 결함이 없어 실행 코드는 변경하지 않았습니다. 실게임 능력치 계산·저장 재접속까지 검증했다는 뜻은 아닙니다. 원본 게임·세이브에는 쓰지 않았습니다.
