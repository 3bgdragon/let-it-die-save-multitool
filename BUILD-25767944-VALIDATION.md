# Steam build 25767944 — file compatibility validation

Release candidate, 2026-10-09. This is NOT new-build live-gameplay certification.

## What changed

- Warp EXE hooks, continuations, relative calls, RIP-relative data and the key-state import were rederived from uniquely matched full functions, not a uniform address shift. Reversible deltas and a separate PE/site profile are included.
- Vending uses a separate build profile for its selector, bootstrap, game service calls and saved shop object. The previous reviewed build remains supported.
- TFC checks native compatibility BEFORE preparing UPK packages. Unsupported layouts, overlays and changed native dependencies fail closed.
- Guard and M2G use reviewed owned-instruction matching on the new UPKs. Bundled native composition code stays synchronized across the four tools. This does not enable other mods.
- Standalone and TFC remain separate downloads. Never mix their active receipts or manually delete state files.

## Validation scope

- New installation snapshot: EXE SHA-256 `1689bccc827f359f82c25cd477f1d22116575681cf1e7009ea0fd75ea4ba16df`.
- Both installation orders (guard → warp → M2G → vending and reverse): function states, checksum links, identical reapplication, selective removal preserving the other features. Standalone reverse transaction restores return all six scoped files byte-for-byte.
- Actual TFC Installer 2.5.6.0 engine: game-specific preparation, installation, finish, repeated finish, native conflict rejection, selective reverse PackagePatch removal, native disable and metadata detach. Table-growing entry-map removal uses its original backup, not a shrinking PackagePatch.
- Actual Nico 0.10.1 Instant Drops: tested with four standalone patches and with four TFC patches. Preserve independent drops edits and file-check OFF links during removal.
- Installed Mod Manager 1.3.20 rejects this new game build without changing files. Its new-build combination is NOT certified; do not bypass its checks.
- Native emulation: 24 warp flag/reservation/arrow/Enter/Escape cases; 12 material-selector cases; 15 first-stock/history/bootstrap cases. Engine/API services are stubs. These do not prove gameplay, daily real-clock rollover or level streaming.
- Save tool: current save/DB probes for fighters, equipment requirements, recipes, materials, decals, currencies, jackals and skills; file round trips. No EXE/UPK patch was added to the save tool.
- Optional old/private-fixture unit tests may skip. Do not interpret skips as executed passes. Extracted release ZIPs are tested separately.

## Still requires actual gameplay

Guard boss/elemental attacks and crashes; M2G variants; actual 51/101/201/301 travel and input lock; vending purchases, real daily restock, ammo price/durability and persistence; fighter computed stats/slots/bag after reload. Old-build player confirmations do not certify these on the new build.

Unknown same-object edits, altered native dependencies, changed PE sections/overlays or old cached manager originals are not universally mergeable. Report the complete diagnostic log. Back up saves independently; restoring patched files does not undo purchases or save changes.

## 한국어 요약

빌드 25767944 대응 RC입니다. 일반판·TFC판을 분리했고 새 EXE 주소와 의존 명령어를 재검증했습니다. 복사본의 설치·재적용·선택 제거·복원, 실제 TFC/Nico 처리 엔진과 네 모드 조합을 검증했습니다. 보유한 Mod Manager 1.3.20은 새 빌드를 자체 거부하므로 해당 조합을 호환 완료라고 표시하지 않습니다.

실게임 전투·층 이동·일일 재입고·저장 유지 검증은 아직 완료되지 않았습니다. 세이브를 따로 백업하고, 기존판과 TFC판을 혼용하거나 상태 파일을 지우지 마세요.

