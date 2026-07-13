# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-07-13

### Added

- `/vid-history` command showing last 10 played videos per channel
- Per-channel queue history in QueueManager (max 10, FIFO, survives `/stop`)

### Fixed

- Removed dead UI components from `src/ui/components/`
- Resolved TS6059 rootDir lint error via `tsconfig.check.json`
- Added `jsx` compiler option and `@types/react-dom` devDependency
- Fixed false narrowing TypeScript bug in `streaming.ts`
- Added missing `sweepOrphanedTempFiles()` method in stream-manager
