# Changelog

All notable changes to OpenMeets. Versions follow [Semantic Versioning](https://semver.org).

## [1.0.0] - 2026-11-23

First public release.

### Two ways to run it
- **Windows app, no internet needed.** `OpenMeets-Setup.exe` installs OpenMeets without administrator rights, adds Start menu and optional desktop shortcuts, and uninstalls from Windows Apps with an option to delete your data. The server is a single Rust executable with the web app inside, and data stays in `%LOCALAPPDATA%\OpenMeets\datos`.
- **Online at [openmeets.web.app](https://openmeets.web.app).** Firebase Hosting, Firestore and Google sign-in, with no server of your own. Each account runs only the meets it created (up to 50), the account is never shown on public pages, and spectators and judges never need one. Firestore rules are the security, and you can host it on your own Firebase project.
- A Node.js development server (`npm start`) for any operating system, which the test suite runs against. The Rust server passes the same tests (`OPENMEETS_SERVIDOR=rust npm test`).

### Running a meet
- Table control with clock, bar weight and plate loading, running order, results, and Undo on every action.
- Judges vote from a phone or from Bluetooth/USB remotes, and the three lights reveal together. Judge approval can be open, by the table, or with a 6-digit code.
- Stage screen with large lights and a transparent HUD strip for OBS. The broadcast desk chooses what the HUD shows and exports social images with the meet's branding.

### Before and after the meet
- Registration and weigh-in inside OpenMeets, with no spreadsheet or CSV.
- A profile for each lifter with every meet on the server, and a record table that keeps who holds each record and who held it before.
- Federation mode: a PIN per staff member, a panel with every platform, an announcer sheet, a change log, and official exports (OpenPowerlifting CSV and results sheet).

### For the audience
- A LiftingCast-style list of live, upcoming and past meets, rankings by category, division and club, personal bests, records, and applause for each lifter.
- Follow your lifters in a public LiftingCast meet.

### Platform
- Works with no internet on a local network: real-time updates over SSE, data in plain JSON files, and a service worker for offline use.
- Spanish and English in the app. READMEs in English, Spanish and Simplified Chinese.

[1.0.0]: https://github.com/eyversao/openmeets/releases/tag/v1.0.0
