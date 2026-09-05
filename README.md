# LET IT DIE 세이브 멀티툴

Steam판 LET IT DIE 오프라인 세이브와 로컬 마스터 DB를 안전하게 백업·수정·복원하는 Windows용 멀티툴입니다. 자원 조정, 시설 업그레이드 최대화, 무기 숙련도 최대화, 모든 장비 R&D 연구 최대화(1,262종 한계돌파 완료), 블러드늄 상점 재고 복구, 전체 데칼·황금동물 지급, 기간 한정 또는 모든 장비 레시피 해금, 버섯·데칼 효과 변경, KAMAS RE 연구 완료, 장비 개발·강화 재료 제거 및 캐릭터(파이터) 능력치 레벨 조회·세부 설정을 제공합니다.

> Windows 전용 · LET IT DIE 오프라인판 5.0.1.0 전용 · Node.js 22.5 이상 필요

## 안전 장치

- 게임 실행 중에는 수정을 거부합니다.
- 수정 전에 원본 세이브를 `backups` 폴더에 자동 보관합니다.
- 값을 변경하지 않고 현재 세이브만 즉시 백업할 수 있습니다.
- BRG/ZLIB 구조, 블록 크기, JSON, 수정 결과를 모두 검증합니다.
- JSON 전체를 다시 직렬화하지 않고 선택한 자원의 숫자 토큰 하나만 교체합니다.
- 시설 레벨(금고·스피리튬 탱크)을 마스터 DB 최대치인 99로 올리고 한도(2,560,000)를 즉시 활성화합니다.
- 무기 숙련도 전체(57종 카테고리)를 최대 Lv.20으로 올리고 요구치에 맞게 ABP를 갱신합니다.
- 모든 장비 연구·개발(R&D 1,262종) 최대치 업그레이드: Steam판 356개 계보의 1,262종 전체 장비에 대해 각 티어별 최대 강화 및 최종 한계돌파(최대 +24강)까지 총 10,600개 연구 단계를 즉시 완료 상태로 적용합니다.
- 캐릭터(파이터) 능력치 레벨 현황 조회 및 세부 설정: 모든 파이터의 6대 주 능력치(HP, STR, DEX, VIT, STM, LUK), 스킬 슬롯, 데스백 가방 용량, 분노 게이지, 언캡 보너스 현황을 조회하고 인게임 순정 최대치(Lv.45) 일괄 적용, DB 엔진 최대치(Lv.50) 일괄 적용, 직접 지정(1~50), 개별 능력치 세부 설정을 지원하며, 변경 시 총 레벨(`lvl`)을 공식에 맞춰 자동 재계산하여 세이브 무결성을 유지합니다.
- 블러드늄 상점 재고 복구 시 구매 가능/구매 완료 목록 두 필드만 변경합니다.
- 전체 데칼 지급 시 마스터 DB에서 검증한 Steam용 데칼 329종을 소유 목록에 각각 한 장씩 추가합니다. 콘솔 전용 중복 데이터 39종은 제외합니다.
- 황금동물 지급 시 마스터 DB에 정의된 11종을 각각 한 마리씩 코인 보관함에 추가하고, 동물별 보상 버섯 연결까지 함께 생성합니다.
- 황금동물 11종을 넣을 빈 보관함 칸이 부족하면 세이브를 수정하지 않고 중단합니다.
- 과거 이벤트·콜라보·시즌 보상으로 배포된 Steam용 기간 한정 레시피 25종을 설계도 습득 상태로 해금합니다. 이미 가진 레시피는 중복 추가하지 않습니다.
- 기간 한정 레시피는 설치된 `masters.db`에서 Steam 호환 여부와 R&D 정의를 다시 검증합니다. 콘솔 전용 데이터와 R&D 정의가 없는 장비는 제외합니다.
- 별도 옵션으로 `masters.db`의 Steam용 R&D 계보 시작점 356종을 모두 설계도 습득 상태로 해금할 수 있습니다. 후속 강화 단계는 레시피로 잘못 추가하지 않습니다.
- 모든 레시피 해금도 기존 보유 항목은 유지하고 없는 항목만 추가하며, 콘솔 전용·비활성 정의는 제외합니다.
- 충돌버섯과 구운 충돌버섯의 지속시간을 30분(1,800초)으로 변경하거나 기본값(일반 30초 / 구운 것 40초)으로 토글 복구할 수 있습니다.
- 버섯 효과 변경 전 `masters.db`를 자동 백업하고 SQLite 무결성을 검사합니다.
- 궁극 파이터의 귀환 데칼의 모든 기본 능력치 증가를 +100%(5배)로 변경하거나 기본값(+20%)으로 토글 복구할 수 있습니다.
- KAMAS-A1 어설트 라이플 RE 연구를 DB상 최대 강화인 +24로 완료할 수 있습니다.
- 스페이드 여왕 데칼의 공격력을 안전 극대치(+1,000%, 11배 대미지)로 변경하거나 기본값(+30%)으로 토글 복구할 수 있으며, 32비트 연산 오버플로 방지를 위해 최대 5,000%(166배)로 입력을 제한합니다.
- 슈퍼 울프(SKL_RGSPDUP_02_P) 및 매드 울프(SKL_RGSPUP_RDURDOWN_01_P) 데칼의 레이지 축적 속도를 +1,000%로 변경하여, 적을 스치기만 해도 분노 게이지가 1~2칸 즉시 충전되도록 강화하거나 기본값(80% / 120%)으로 복구할 수 있습니다.
- 모든 장비의 개발·제작·강화 기본 재료와 단계별 추가 수량을 0으로 만들 수 있습니다. 재료 ID, 킬코인·스피리튬 비용과 연구 시간은 유지합니다.
- 장비 재료 변경 전 전용 `masters.db` 백업을 만들며, 복원 시 다른 DB 변경은 유지하고 재료 수량 열만 되돌립니다.
- 쓰기 실패 시 기존 세이브를 원래 위치로 되돌립니다.
- 최신 백업을 복원하는 메뉴를 제공합니다.
- 모든 옵션 실행(대화형 메뉴 및 CLI 명령어) 중 오류 발생 시 `logs/` 폴더에 타임스탬프, 실행 환경, 원인, 상세 스택 트레이스를 포함한 오류 로그 파일(`error-*.log`)을 자동으로 저장합니다.

## 사용법

1. LET IT DIE를 완전히 종료합니다.
2. [`run.bat`](./run.bat)을 더블클릭합니다.
3. 원하는 작업 번호를 선택합니다:
   - **[1. 캐릭터(파이터) 육성 & DB 상한 해제]**: 1 (스탯/슬롯/가방 현황 및 변경), 2 (상한 해제 DB 패치), 3 (순정 DB 복구)
   - **[2. 보유 자원 및 시설 관리]**: 4 (KC 충전), 5 (SP 충전), 6 (Blood 충전), 7 (자원 직접 입력), 8 (시설 Lv.99)
   - **[3. 장비 R&D, 무기 숙련도 및 레시피 해금]**: 9 (모든 장비 R&D 최대), 10 (KAMAS RE +24), 11 (무기 숙련도 57종 Lv.20), 12 (기간 한정 레시피 25종), 13 (모든 레시피 356종)
   - **[4. 데칼, 아이템 및 상점 관리]**: 14 (전체 데칼 329종 지급), 15 (황금동물 11종 수량 지정 지급), 16 (블러드늄 상점 재고 복구)
   - **[5. 마스터 DB 게임 편의 / 특수 강화 모드]**: 17 (충돌버섯 30분 토글), 18 (궁극 파이터 배율 직접 입력), 19 (스페이드 여왕 안전 배율 직접 입력), 20 (슈퍼·매드 울프 레이지 속도 +1,000% 모드), 21 (장비 재료비 0), 22 (장비 재료비 복원)
   - **[6. 세이브 백업 및 복원]**: 23 (현재 세이브 백업), 24 (최신 백업 복원), 0 (종료)

도구는 Windows 레지스트리, Steam의 `libraryfolders.vdf`, C~Z 드라이브의 일반적인 Steam 설치 위치를 확인하여 다음 위치의 숫자 이름 `.sav` 파일을 자동 탐색합니다. Steam 본체와 게임 라이브러리가 서로 다른 드라이브에 있어도 찾을 수 있습니다.

```text
<SteamLibrary>\steamapps\common\LET IT DIE\Savedata\<SteamID64>.sav
```

자동 탐색이 실패해도 창이 바로 종료되지 않습니다. 표시되는 입력란에 `.sav` 파일을 끌어놓거나 세이브 파일, `Savedata`, `LET IT DIE`, Steam 라이브러리 폴더 중 하나의 경로를 붙여넣으면 됩니다.

세이브 파일을 바탕 화면, 문서, 사진 폴더처럼 게임 밖의 임의 위치로 복사해 사용해도 됩니다. 이 경우 세이브는 입력한 위치에서 읽고 쓰며, 효과·장비 재료 기능에 필요한 `masters.db`는 실제 Steam 게임 설치 경로에서 별도로 찾습니다. 게임 설치 경로까지 자동으로 찾지 못하면 게임 설치 폴더나 `masters.db` 위치를 입력하는 안내가 표시됩니다.

현재 금고와 스피리튬 탱크 레벨이 1~99이면 게임의 `masters.db`에 정의된 정상 보관 한도를 표시합니다. 블러드늄의 알려진 한도는 999,999입니다. 알려진 한도를 넘는 사용자 지정 값은 게임이 잘라내거나 거부할 수 있습니다.

명령줄에서도 사용할 수 있습니다.

```powershell
node .\lid-kc.js status
node .\lid-kc.js backup
node .\lid-kc.js reset-shop
node .\lid-kc.js grant-all-decals
node .\lid-kc.js grant-golden-beasts
node .\lid-kc.js grant-golden-beasts 5
node .\lid-kc.js grant-limited-recipes
node .\lid-kc.js grant-all-recipes
node .\lid-kc.js max-facility
node .\lid-kc.js max-mastery
node .\lid-kc.js max-equipment
node .\lid-kc.js fighters
node .\lid-kc.js set-fighter-stat 1 max-legit
node .\lid-kc.js set-fighter-stat 1 max-db
node .\lid-kc.js set-fighter-stat 1 max-bonus
node .\lid-kc.js set-fighter-stat 1 bonus 10
node .\lid-kc.js set-fighter-stat 1 max-slots
node .\lid-kc.js set-fighter-stat 1 expand-slots
node .\lid-kc.js set-fighter-stat 1 all 45
node .\lid-kc.js set-fighter-stat Jamie hp 50
node .\lid-kc.js collision-30m
node .\lid-kc.js collision-restore
node .\lid-kc.js ultimate-fighter 10x
node .\lid-kc.js ultimate-fighter 100%
node .\lid-kc.js ultimate-fighter 5x
node .\lid-kc.js ultimate-fighter restore
node .\lid-kc.js kamas-re-max
node .\lid-kc.js queen-spades 10x
node .\lid-kc.js queen-spades 500%
node .\lid-kc.js queen-spades extreme
node .\lid-kc.js queen-spades restore
node .\lid-kc.js wolf-rage
node .\lid-kc.js wolf-rage 1000%
node .\lid-kc.js wolf-rage restore
node .\lid-kc.js rich-family
node .\lid-kc.js rich-family max
node .\lid-kc.js rich-family dur-only
node .\lid-kc.js rich-family 500 100
node .\lid-kc.js rich-family restore
node .\lid-kc.js equipment-materials-free
node .\lid-kc.js equipment-materials-restore
node .\lid-kc.js max kc
node .\lid-kc.js max sp
node .\lid-kc.js max blood
node .\lid-kc.js set kc 1280000
node .\lid-kc.js set sp 1280000
node .\lid-kc.js set blood 999999
node .\lid-kc.js restore
```

자동 탐색이 실패하면 `--save`로 경로를 지정합니다.

```powershell
node .\lid-kc.js status --save "D:\SteamLibrary\steamapps\common\LET IT DIE\Savedata\123456789.sav"
```

게임 설치 폴더도 Steam이 인식하지 못하는 임의 위치에 있다면 `--game`으로 `LET IT DIE` 폴더를, 또는 `--master`로 DB 파일을 직접 지정할 수 있습니다.

```powershell
node .\lid-kc.js collision-30m --save "C:\My Saves\123456789.sav" --game "E:\My Games\LET IT DIE"
node .\lid-kc.js equipment-materials-free --save "C:\My Saves\123456789.sav" --master "E:\My Games\LET IT DIE\BrgGame\Content\masters.db"
```

## 업데이트 이력 및 공지

### v5.4.0 (최신 릴리스)
- **「부유한 가족」(Rich Family) 데칼 수치 조절 및 장비 무한 내구도 지원**:
  - **기능 개요**: ★5 프리미엄 데칼 「부유한 가족」(`SKL_RESUP_DECDOWN_P`, Steam No.296)의 자원 획득량 증가 배율과 장비 내구도 감소 완화율을 마스터 DB(`masters.db`)에서 직접 조절할 수 있는 기능을 추가했습니다.
  - **무한 내구도 구현**: 게임 엔진 내부 정의에 따라 내구도 손실 완화율(`val3`~`val5`)을 100%로 설정하면, 타격 시 무기 내구도 소모 및 피격 시 머리/상의/하의 방어구 내구도 소모가 100% 방지되어 인게임에서 **완전한 무한 내구도** 상태가 적용됩니다.
  - **자원 수집량 대폭 상향**: 킬코인(KC), 스피리튬(SP), 경험치(EXP), 무기 숙련도(ABP), 체력 회복량, 보물상자 보상 증가율(`val0`~`val2`)을 기본 +20%에서 사용자가 원하는 수치(추천 +500%, 극대 +1,000%)로 자유롭게 증폭할 수 있습니다.
  - **대화형 메뉴(21번) 및 CLI 지원**:
    - `node .\lid-kc.js rich-family`: [추천] 자원 +500% + 무한 내구도(100%) 원클릭 적용
    - `node .\lid-kc.js rich-family max`: [극대] 자원 +1,000% + 무한 내구도(100%) 적용
    - `node .\lid-kc.js rich-family dur-only`: 자원 기본(+20%) 유지 + 무한 내구도(100%) 적용
    - `node .\lid-kc.js rich-family <자원수치> [내구도수치]`: 수치 직접 지정 (예: `rich-family 500 100`)
    - `node .\lid-kc.js rich-family restore` (또는 `rich-family-restore`): 기본값(자원 +20% / 내구도 20%) 원상 복구
  - **대화형 메뉴 25개 옵션 체계화**:
    - 21번: 부유한 가족 효과 조절 및 무한 내구도
    - 22번: 모든 장비 R&D 개발·강화 재료 무료화
    - 23번: 장비 재료 비용 복원
    - 24번: 현재 세이브 백업
    - 25번: 최신 세이브 복원

### v5.3.2
- **대화형 메뉴 데칼 지급(14번) 및 자원 관리(6·7번) ReferenceError 긴급 수정**:
  - **원인**: 대화형 메뉴 14번(Steam용 전체 데칼 지급) 실행 시 내부 함수명이 `getSteamDecalDefinitions` 및 `getDecalStockSummary`로 잘못 호출되어 `ReferenceError: getSteamDecalDefinitions is not defined` 예외가 발생하던 문제를 수정했습니다.
  - **조치**: 실제 구현된 정규 함수 `getAllDecalDefinitions(savePath)` 및 `getDecalStock(save)`로 바인딩을 교정하고, 정적 호출 검사를 통해 자원 직접 수정 메뉴에서 잠재적 오류를 유발할 수 있던 `getResourceAmount` 헬퍼 함수를 신규 구현하여 안정성을 확보했습니다.

### v5.3.1
- **파이터 등급별 데칼 슬롯 동적 계산 및 안내 개선**:
  - **원인 및 배경**: 파이터의 기본 데칼 슬롯은 등급(1성: 1칸 ~ 5/6성: 5칸, 스킬 마스터: 최대 9칸)에 따라 결정되며, 한계돌파(언캡)로 추가되는 슬롯은 최대 +4칸입니다. 이전 버전에서는 파이터 등급과 무관하게 '총 9칸'으로 고정 표기되어 있어, 1성 파이터(기본 1칸 + 언캡 4칸 = 총 5칸) 적용 시 인게임 3×3 UI의 나머지 4개 슬롯이 미해금(X 표시) 상태로 잠겨 있는 것을 버그로 오인하는 문제가 있었습니다.
  - **등급별 동적 계산 적용**: 선택한 파이터의 등급(Grade)과 타입(Type)을 자동으로 감지하여 기본 슬롯 수와 최대 확장 슬롯 수를 정확히 계산하도록 전면 개선했습니다.
    - 일반 파이터: 1성(기본1 + 최대4 = 총5칸), 2성(총6칸), 3성(총7칸), 4성(총8칸), 5/6성(총9칸)
    - 스킬 마스터: 1성(총6칸), 2성(총7칸), 3성(총8칸), 4~6성(총9칸)
  - **인게임 X 표시 안내 추가**: 1~4성 파이터의 경우 게임 엔진 한계로 인해 총 슬롯이 9칸 미만이며, 3×3 데칼 UI의 나머지 공간은 인게임에서 정상적으로 X 표시된다는 사전 안내 및 주의 문구를 보강했습니다.
  - **CLI 및 대화형 UI 일치**: `fighters`, `set-fighter-stat`, 상세 현황 및 변경 완료 요약 화면에서 해당 파이터의 기본 칸수와 총 칸수가 정확히 표시되도록 수정했습니다.

### v5.3.0
- **레이지 게이지 32비트 연산 오버플로 방지 및 안전 극대치 적용**:
  - **원인 분석**: 스페이드 여왕 극단화(+10,000%) 등으로 단일 타격 수치가 수십만을 초과할 경우, 언리얼 엔진 내부 게이지 획득 공식 `(Damage * GaugeRate / Factor)` 연산 과정에서 부호 있는 32비트 정수(Int32: 2,147,483,647) 한계를 초과하여 음수 래핑(Wrap-around) 및 엔진 안전 코드에 의한 0 클램핑(Clamp to 0)이 발생해 게이지가 전혀 충전되지 않던 현상을 해결했습니다.
  - **스페이드 여왕 안전 극대치 조정**: 극단 공격력을 안전 극대치인 `+1,000%` (11배 대미지)로 조정하고, 직접 입력 상한을 5,000%(166배)로 제한하여 오버플로를 사전 차단했습니다.
  - **슈퍼 울프 / 매드 울프 레이지 축적 속도 +1,000% 특수 모드 추가**:
    - 마스터 DB(`masters.db`)의 슈퍼 울프(`SKL_RGSPDUP_02_P`, 기본 +80%) 및 매드 울프(`SKL_RGSPUP_RDURDOWN_01_P`, 기본 +120%) 레이지 축적 속도를 `+1,000%`로 상향하여, 적을 스치기만 해도 분노 게이지가 1~2칸씩 즉시 충전되도록 조치했습니다.
    - 대화형 메뉴 20번 및 CLI(`wolf-rage`, `wolf-rage-restore`)를 통해 원클릭 적용, 직접 수치 입력, 기본값(80% / 120%) 복구를 지원합니다.
- **레시피 해금(12·13번) 상태 헤더 및 메뉴 일시정지(`pause`) 보강**:
  - Steam용 기간 한정 레시피 및 전체 레시피 메뉴 진입 시 보유 현황을 상단 헤더 표로 명확히 표시하고, 작업 완료 후 Enter 확인 대기(`pause`) 프롬프트를 전면 적용했습니다.
- **대화형 메뉴 24개 옵션 재정렬**:
  - 신규 울프 레이지 옵션(20번) 편입에 따라 재료비 무료화(21번), 재료비 복원(22번), 세이브 백업(23번), 최신 백업 복원(24번)으로 번호를 단정하게 재정렬했습니다.

### v5.2.0
- **대화형 메뉴 6대 카테고리 체계화**:
  - 기능 확장으로 인해 흩어져 있던 대화형 옵션들을 [파이터 육성 & 상한 해제], [자원 및 시설 관리], [장비 R&D 및 레시피], [데칼 및 상점], [마스터 DB 특수 모드], [세이브 백업/복원]의 6대 카테고리로 논리적 재정렬했습니다.
- **작업 완료 확인 대기 (`pause`) 적용**:
  - 모든 옵션 실행 완료 시 작업 결과 및 백업 경로를 출력한 후, 사용자가 Enter 키를 누를 때까지 화면이 유지되도록 하여 작업 성공 여부와 수치 변동을 명확히 인지할 수 있도록 개선했습니다. (취소 시에는 즉시 메뉴 복귀)
- **파이터 스탯/경험치 상한 해제 및 실적용 지원**:
  - 6성 파이터 6대 주 능력치(HP/STR/DEX/VIT/STM/LUK) Lv.50 및 가방 50칸 확장 실적용 지원.
  - 마스터 DB(masters.db) 주 능력치 테이블(Lv.50) 및 경험치 테이블(Lv.500) 상한 해제 패치 및 순정 DB 복원 기능 추가.
  - 데칼 슬롯은 파이터 등급별 기본 슬롯(1성: 1칸 ~ 5/6성: 5칸, 스킬마스터는 최대 9칸)에 언캡 최대치(+4)를 더한 총 슬롯 수로 적용 (6성 파이터 기준 총 9칸).
- **궁극 파이터의 귀환 및 스페이드 여왕 데칼 효과 사용자 입력 지원**:
  - 대화형 메뉴 및 CLI에서 퍼센트(%) 및 배율(배) 직접 입력, 원클릭 적용, 기본값 복구 지원.
- **황금동물 전체 11종 보관함 수량 지정 지급**:
  - 코인 보관함 빈칸 내에서 원하는 마리수를 직접 입력하여 11종을 일괄 지급받을 수 있도록 개선.

## 주의

이 도구는 LET IT DIE 오프라인판 버전 5.0.1.0에서 확인된 세이브 형식만 지원합니다. 게임 업데이트 후 형식이 달라지면 안전하게 중단하도록 만들었습니다. 로컬 싱글플레이 세이브 수정이라도 게임 이용약관상 데이터 변조로 간주될 수 있습니다.

## 공개 배포 및 권리 고지

이 프로젝트는 비공식 팬 제작 도구이며 GungHo Online Entertainment 및 LET IT DIE 제작·배급사와 관련이 없습니다. 게임 파일, 마스터 DB, 세이브 파일 및 사용자 백업은 저장소에 포함하지 않습니다.

소스 코드는 [MIT License](./LICENSE)로 배포됩니다. 게임명, 상표 및 게임 데이터에 대한 권리는 각 권리자에게 있습니다.
