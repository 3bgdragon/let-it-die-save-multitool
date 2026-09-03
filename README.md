# LET IT DIE 세이브 멀티툴

Steam판 LET IT DIE 오프라인 세이브와 로컬 마스터 DB를 안전하게 백업·수정·복원하는 Windows용 멀티툴입니다. 자원 조정, 블러드늄 상점 재고 복구, 전체 데칼·황금동물 지급, 기간 한정 또는 모든 장비 레시피 해금, 버섯·데칼 효과 변경, KAMAS RE 연구 완료 및 장비 개발·강화 재료 제거 기능을 제공합니다.

> Windows 전용 · LET IT DIE 오프라인판 5.0.1.0 전용 · Node.js 22.5 이상 필요

## 안전 장치

- 게임 실행 중에는 수정을 거부합니다.
- 수정 전에 원본 세이브를 `backups` 폴더에 자동 보관합니다.
- 값을 변경하지 않고 현재 세이브만 즉시 백업할 수 있습니다.
- BRG/ZLIB 구조, 블록 크기, JSON, 수정 결과를 모두 검증합니다.
- JSON 전체를 다시 직렬화하지 않고 선택한 자원의 숫자 토큰 하나만 교체합니다.
- 블러드늄 상점 재고 복구 시 구매 가능/구매 완료 목록 두 필드만 변경합니다.
- 전체 데칼 지급 시 마스터 DB에서 검증한 Steam용 데칼 329종을 소유 목록에 각각 한 장씩 추가합니다. 콘솔 전용 중복 데이터 39종은 제외합니다.
- 황금동물 지급 시 마스터 DB에 정의된 11종을 각각 한 마리씩 코인 보관함에 추가하고, 동물별 보상 버섯 연결까지 함께 생성합니다.
- 황금동물 11종을 넣을 빈 보관함 칸이 부족하면 세이브를 수정하지 않고 중단합니다.
- 과거 이벤트·콜라보·시즌 보상으로 배포된 Steam용 기간 한정 레시피 25종을 설계도 습득 상태로 해금합니다. 이미 가진 레시피는 중복 추가하지 않습니다.
- 기간 한정 레시피는 설치된 `masters.db`에서 Steam 호환 여부와 R&D 정의를 다시 검증합니다. 콘솔 전용 데이터와 R&D 정의가 없는 장비는 제외합니다.
- 별도 옵션으로 `masters.db`의 Steam용 R&D 계보 시작점 356종을 모두 설계도 습득 상태로 해금할 수 있습니다. 후속 강화 단계는 레시피로 잘못 추가하지 않습니다.
- 모든 레시피 해금도 기존 보유 항목은 유지하고 없는 항목만 추가하며, 콘솔 전용·비활성 정의는 제외합니다.
- 충돌버섯과 구운 충돌버섯의 지속시간을 모두 30분으로 변경할 수 있습니다.
- 버섯 효과 변경 전 `masters.db`를 자동 백업하고 SQLite 무결성을 검사합니다.
- 궁극 파이터의 귀환 데칼의 모든 기본 능력치 증가를 +20%에서 +100%로 변경할 수 있습니다.
- KAMAS-A1 어설트 라이플 RE 연구를 DB상 최대 강화인 +24로 완료할 수 있습니다.
- 스페이드 여왕 데칼의 공격력만 +30%에서 +10,000%로 변경할 수 있습니다.
- 모든 장비의 개발·제작·강화 기본 재료와 단계별 추가 수량을 0으로 만들 수 있습니다. 재료 ID, 킬코인·스피리튬 비용과 연구 시간은 유지합니다.
- 장비 재료 변경 전 전용 `masters.db` 백업을 만들며, 복원 시 다른 DB 변경은 유지하고 재료 수량 열만 되돌립니다.
- 쓰기 실패 시 기존 세이브를 원래 위치로 되돌립니다.
- 최신 백업을 복원하는 메뉴를 제공합니다.

## 사용법

1. LET IT DIE를 완전히 종료합니다.
2. [`run.bat`](./run.bat)을 더블클릭합니다.
3. 자원 조정 또는 `블러드늄 상점 구매 재고 복구`를 선택합니다.

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
node .\lid-kc.js grant-limited-recipes
node .\lid-kc.js grant-all-recipes
node .\lid-kc.js collision-30m
node .\lid-kc.js ultimate-fighter-5x
node .\lid-kc.js kamas-re-max
node .\lid-kc.js queen-spades-extreme
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

## 주의

이 도구는 LET IT DIE 오프라인판 버전 5.0.1.0에서 확인된 세이브 형식만 지원합니다. 게임 업데이트 후 형식이 달라지면 안전하게 중단하도록 만들었습니다. 로컬 싱글플레이 세이브 수정이라도 게임 이용약관상 데이터 변조로 간주될 수 있습니다.

## 공개 배포 및 권리 고지

이 프로젝트는 비공식 팬 제작 도구이며 GungHo Online Entertainment 및 LET IT DIE 제작·배급사와 관련이 없습니다. 게임 파일, 마스터 DB, 세이브 파일 및 사용자 백업은 저장소에 포함하지 않습니다.

소스 코드는 [MIT License](./LICENSE)로 배포됩니다. 게임명, 상표 및 게임 데이터에 대한 권리는 각 권리자에게 있습니다.
