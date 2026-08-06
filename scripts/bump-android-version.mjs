// Bump the Android version on every APK build.
//
// Every build shipped so far was versionCode 1 / versionName "1.0", so
// Android could not distinguish one APK from the next and neither could
// anyone installing it. versionCode increments per build; versionName tracks
// package.json plus the build number, so the value shown in Settings maps to
// exactly one artifact.

import { readFileSync, writeFileSync } from 'node:fs'

const GRADLE = 'android/app/build.gradle'

const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
let gradle = readFileSync(GRADLE, 'utf8')

const current = /versionCode\s+(\d+)/.exec(gradle)
if (!current) {
  console.error(`bump-android-version: no versionCode found in ${GRADLE}`)
  process.exit(1)
}

const next = Number(current[1]) + 1
const versionName = `${pkgVersion} (${next})`

gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${next}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`)

writeFileSync(GRADLE, gradle)

// Handed to Vite so the running app can display the same string.
writeFileSync(
  'src/build-info.json',
  `${JSON.stringify({ versionName, versionCode: next, builtAt: new Date().toISOString() }, null, 2)}\n`,
)

console.log(`android version -> ${versionName}`)
