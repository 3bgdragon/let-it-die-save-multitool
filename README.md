# LET IT DIE Save Multitool

[English](README.md) | [한국어](README.ko.md)

Offline save and master-database editor: resources, fighter configuration, decals, recipes, research costs, Jackal options and M2G knife damage compensation.

## Requirements

- Steam offline edition of LET IT DIE on Windows.
- Node.js 22.5 or newer. No npm install is needed for normal use.
- Support is determined by file/schema checks, not just the displayed game version. Never bypass an unsupported-file error.

## Installation

1. Use **Code → Download ZIP**, then extract the archive.
2. Back up your save separately and close the game completely.
3. Run `run-en.bat` for English, or use `run.bat --lang ko` for Korean. If Windows denies Steam-folder write access, run the launcher as administrator.
4. Read confirmations carefully and keep every backup created by the tool.

Command-line entry: `node --no-warnings lid-kc.js --lang en`. Use `--lang ko` for Korean. Language options do not change save fields or DB values.

## Important behavior

Edits saves and selected masters.db settings. Fighter DB limits depend on class, grade and limit break; stat levels are not direct HP/attack values. Material-free and Splithium-free research are separate options. This tool does not implement M2G knife-only firing.

## Backups and compatibility

Do not delete an older tool folder until its backups have been preserved. Backups are local files, not stored on GitHub. Restoring game files does not undo purchased items, spent currency or subsequent save changes. Compatibility with every other mod or installation order is not guaranteed.

## Translation status

All 34 main-menu options, fighter submenus, confirmations and tool-generated runtime errors support English and Korean (884 translated messages). Paths, item IDs and player-entered names are preserved. The tool does not translate the game itself. Historical release notes remain in the [Korean guide](README.ko.md). Translation does not add support for new game builds.

For support, include tool version, game build, exact error and relevant logs. Avoid publishing your entire save or unnecessary account identifiers.

## Menu groups

- **1–3:** fighter settings, valid DB maximum upgrades, level-50 preparation and DB restoration. The preview shows actual decal/bag capacities and creation bonuses; bonuses are not the same as stat levels.
- **4–8:** Kill Coins, SPLithium, Bloodnium and facility levels.
- **9–13:** equipment R&D, KAMAS RE, weapon mastery and blueprint unlocks.
- **14–16:** decals, golden animals and purchased Bloodnium shop stock restoration.
- **17–24, 27–34:** mushroom/decal effects, independently removable material/SPLithium costs, Jackal timing/blueprint weights and M2G knife damage compensation.
- **25–26:** save backup and restoration. **0:** exit.

If discovery fails, enter or drag in a save file/folder. Both numeric `.sav` files and `Savedata/<SteamID>/brggame.sav` are supported. For a save stored outside the game folder, specify the installation or `masters.db` separately with `--game` or `--master`.
