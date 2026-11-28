# Building

Everything starts from the web build. The Windows and Android apps are thin wrappers that load those same files, so they work fully offline.

## Website

Requirements: [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm run dev      # development server with live reload on http://127.0.0.1:5190
npm run build    # production build in Output/dist
```

Use `npm run build`, not `npx vite build`: the npm script sets the output folder to `Output/dist`, which the packaging steps below expect.

### Hosting on GitHub Pages

The live demo is served from the `gh-pages` branch, which holds only the built files.

1. `npm run build`
2. Replace the contents of the `gh-pages` branch with the contents of `Output/dist`, plus an empty `.nojekyll` file (it stops GitHub from ignoring folders that start with `_`).
3. Push `gh-pages`. GitHub Pages rebuilds the site within a minute or two.

The build uses relative paths (`base: './'` in `vite.config.js`), so it works from any sub-folder.

## Windows app (EXE)

The desktop app uses [Electron](https://www.electronjs.org/) and is packaged as a single portable EXE: no installer, nothing written outside the folder it runs from.

```bash
npm run build                 # in the repo root
cd packaging/desktop
npm install                   # Electron and electron-builder (about 250 MB)
npm start                     # run it without packaging
npm run dist                  # build release/CircuitBench-1.0.0-portable.exe
```

`npm start` and `npm run dist` copy `Output/dist` into `packaging/desktop/app` first. `main.js` opens the app in a window and sends any web links to the normal browser.

The EXE is not code-signed, so Windows SmartScreen may show "Windows protected your PC" the first time. Choose **More info**, then **Run anyway**. Signing needs a code-signing certificate configured for electron-builder.

## Android app (APK)

The Android app uses [Capacitor](https://capacitorjs.com/), which runs the web build inside an Android WebView.

### Requirements

- **JDK 21.** Newer JDKs are not supported by the Android Gradle plugin yet. Set `JAVA_HOME` to it.
- **Android SDK command-line tools** from https://developer.android.com/studio#command-tools. Set `ANDROID_HOME` to the SDK folder, then install the packages (this asks you to accept the Android SDK licences):

  ```bash
  sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
  ```

  On Windows, `sdkmanager.bat` splits arguments at `;`, so put the package names in a text file, one per line, and run `sdkmanager --package_file=packages.txt` instead.
- **Python with Pillow** (`pip install pillow`), only to write the launcher icons.

### Build

```bash
npm run build                      # in the repo root
cd packaging/android
npm install
npm run web                        # copy Output/dist into www
npx cap add android                # first time only: creates the android/ project
python android-icons.py            # first time only: Circuit Bench launcher icons
npx cap sync android
cd android
./gradlew assembleDebug            # Windows: gradlew.bat assembleDebug
```

The APK is written to `packaging/android/android/app/build/outputs/apk/debug/app-debug.apk`. The first Gradle run downloads Gradle itself (about 200 MB).

After changing the app, run `npm run build` in the root, then `npm run sync` in `packaging/android`, then `assembleDebug` again.

A debug APK is signed with the Android debug key. That is fine for installing on your own devices. Publishing on Google Play needs a release build (`assembleRelease` or `bundleRelease`) signed with your own key.

### Installing and testing

- **Phone:** copy the APK to the phone and open it (allow installs from that source), or connect it with USB debugging on and run `adb install -r app-debug.apk`.
- **Windows Subsystem for Android:** turn on **Developer mode** in WSA Settings, then `adb connect 127.0.0.1:58526` and `adb install -r app-debug.apk`.
- **Debugging the WebView:** debug builds can be inspected from Chrome on a computer at `chrome://inspect`.

## Icon

`packaging/icon/make_icon.py` draws the app icon (a glowing resistor on a black, chamfered tile) and writes `icon.png` and `icon.ico`. Run it with Python and Pillow after changing the design.
