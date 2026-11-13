/**
 * Codemagic workflow template — mirrored at the repository root as
 * `codemagic.yaml` (a test keeps them identical). The build machine downloads
 * the project's files from a signed Petal link into ./petal-app. Defines two workflows:
 *
 *  - `petal-default`           — unsigned preview build (sideload .ipa /
 *    direct-install .apk). No signing materials needed.
 *  - `petal-default-signed`    — store-ready signed build. Reads
 *    APPLE_x / ANDROID_x / APP_STORE_CONNECT_x / PLAY_SERVICE_ACCOUNT_JSON
 *    env vars (set by startMobileBuild from the project's encrypted
 *    signing profile) and runs fastlane / gradle accordingly.
 *
 * The workflows wrap the source as a Capacitor shell so the same web app
 * the user is iterating on in Petal compiles to a native binary without
 * any project-side native code. Capacitor sync runs in `prepare`.
 *
 * Kept as a single string constant rather than a separate static file so
 * we never miss committing it (the snapshotter always overrides any
 * user-authored codemagic.yaml).
 */

/**
 * Per-app phone settings, read from the optional `petal.native.json` in the
 * project (features from a fixed store-safe list, web/app link handlers) and
 * the launch colour from `capacitor.config.json` `backgroundColor`.
 */
const APP_SETTINGS_STEP = String.raw`      - name: Apply app settings
        script: |
          python3 - <<'PY'
          import json, os, re, subprocess
          plat = os.environ['PETAL_PLATFORM']
          cfg = json.load(open('capacitor.config.json'))
          extra = json.load(open('petal.native.json')) if os.path.isfile('petal.native.json') else {}
          # Only these phone features can be switched on; tracking-type permissions are never added.
          FEATURES = {
              'microphone': (['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'], 'NSMicrophoneUsageDescription', 'Uses the microphone for voice calls.'),
              'camera': (['android.permission.CAMERA'], 'NSCameraUsageDescription', 'Uses the camera to take photos.'),
              'push': (['android.permission.POST_NOTIFICATIONS'], '', ''),
              'apple-signin': ([], '', ''),
              'google-signin': ([], '', ''),
          }
          feats = [f for f in extra.get('features', []) if f in FEATURES]
          hosts = [h for h in extra.get('linkHosts', []) if re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)+', h)]
          schemes = [s for s in extra.get('linkSchemes', []) if re.fullmatch(r'[a-z][a-z0-9+.-]*', s) and s not in ('http', 'https')]
          color = cfg.get('backgroundColor') or cfg.get('android', {}).get('backgroundColor') or ''
          color = color if re.fullmatch(r'#[0-9a-fA-F]{6}', color) else ''
          # Google sign-in client IDs are public values from the app's own settings; anything not shaped like one is ignored.
          gset = extra.get('google') if isinstance(extra.get('google'), dict) else {}
          gid = lambda k: (lambda v: v if re.fullmatch(r'[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com', v) else '')(str(gset.get(k, '')))
          if 'google-signin' in feats:
              web = gid('webClientId') or gid('serverClientId')
              g = {'scopes': ['profile', 'email'], 'forceCodeForRefreshToken': False}
              if gid('iosClientId'):
                  g['iosClientId'] = gid('iosClientId')
              if web or gid('androidClientId'):
                  g['androidClientId'] = web or gid('androidClientId')
              if web:
                  g['serverClientId'] = web
              for cf in ('capacitor.config.json', 'android/app/src/main/assets/capacitor.config.json', 'ios/App/App/capacitor.config.json'):
                  if os.path.isfile(cf):
                      c = json.load(open(cf)); c.setdefault('plugins', {})['GoogleAuth'] = g; json.dump(c, open(cf, 'w'), indent=2)
              if plat == 'ios' and 'iosClientId' in g:
                  schemes.append('com.googleusercontent.apps.' + g['iosClientId'][:-len('.apps.googleusercontent.com')])
              if plat == 'android' and not web:
                  print('Google sign-in on Android needs the Web client ID (google.webClientId) in petal.native.json.')
              if plat == 'android' and web:
                  # The Android add-on reads server_client_id from string resources and crashes without it.
                  sx = 'android/app/src/main/res/values/strings.xml'
                  if os.path.isfile(sx):
                      s = open(sx).read()
                      if 'server_client_id' not in s:
                          open(sx, 'w').write(s.replace('</resources>', '    <string name="server_client_id">' + web + '</string>\n</resources>'))
                  # Harden the Google add-on: create its client on load and never sign in with a missing one.
                  jf = 'node_modules/@codetrix-studio/capacitor-google-auth/android/src/main/java/com/codetrixstudio/capacitor/GoogleAuth/GoogleAuth.java'
                  if os.path.isfile(jf):
                      j = open(jf).read()
                      if 'PETAL_SAFE_GOOGLE' not in j:
                          safe = 'loadSignInClient(null, false, new String[] { "profile", "email" });'
                          j = j.replace('public void loadSignInClient (String clientId, boolean forceCodeForRefreshToken, String[] scopeArray) {', 'public void loadSignInClient (String clientId, boolean forceCodeForRefreshToken, String[] scopeArray) {\n    // PETAL_SAFE_GOOGLE\n    try { clientId = this.getContext().getString(R.string.server_client_id); } catch (Exception ignored) {}\n    if (scopeArray == null || scopeArray.length == 0 || scopeArray[0].isEmpty()) scopeArray = new String[] { "profile", "email" };')
                          j = j.replace('public void load() {}', 'public void load() {\n    try { ' + safe + ' } catch (Exception ignored) {}\n  }')
                          j = j.replace('public void signIn(PluginCall call) {\n', 'public void signIn(PluginCall call) {\n    if (googleSignInClient == null) { try { ' + safe + ' } catch (Exception e) { call.reject("Google sign-in is not set up", e); return; } }\n')
                          j = j.replace('public void signOut(final PluginCall call) {\n', 'public void signOut(final PluginCall call) {\n    if (googleSignInClient == null) { call.resolve(); return; }\n')
                          open(jf, 'w').write(j)
                          print('Google add-on hardened')
              print('Google sign-in set:', sorted(k for k in g if k.endswith('ClientId')))
          if plat == 'android':
              mf = 'android/app/src/main/AndroidManifest.xml'
              x = open(mf).read()
              for f in feats:
                  for p in FEATURES[f][0]:
                      if p not in x:
                          x = x.replace('</manifest>', '    <uses-permission android:name="' + p + '" />\n</manifest>')
              view = '<action android:name="android.intent.action.VIEW" /><category android:name="android.intent.category.DEFAULT" /><category android:name="android.intent.category.BROWSABLE" />'
              filters = ''.join('<intent-filter android:autoVerify="true">' + view + '<data android:scheme="https" android:host="' + h + '" /></intent-filter>\n' for h in hosts)
              filters += ''.join('<intent-filter>' + view + '<data android:scheme="' + s + '" /></intent-filter>\n' for s in schemes)
              if filters:
                  x = x.replace('</activity>', filters + '</activity>', 1)
              open(mf, 'w').write(x)
              if color:
                  res = 'android/app/src/main/res/values/'
                  open(res + 'petal_launch.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="petal_launch_bg">' + color + '</color></resources>\n')
                  st = open(res + 'styles.xml').read()
                  st = st.replace('<item name="android:background">@drawable/splash</item>', '<item name="android:background">@color/petal_launch_bg</item><item name="windowSplashScreenBackground">@color/petal_launch_bg</item>')
                  st = st.replace('<item name="android:background">@null</item>', '<item name="android:background">@null</item><item name="android:windowBackground">@color/petal_launch_bg</item>')
                  open(res + 'styles.xml', 'w').write(st)
          else:
              pl = 'ios/App/App/Info.plist'
              pb = lambda c: subprocess.run(['/usr/libexec/PlistBuddy', '-c', c, pl], capture_output=True)
              # Apple privacy manifest for the app itself: the bundled add-ons read app settings (UserDefaults, reason CA92.1), no tracking.
              # Apple refuses uploads whose required-reason API use is undeclared (ITMS-91053).
              open('ios/App/App/PrivacyInfo.xcprivacy', 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>NSPrivacyTracking</key><false/><key>NSPrivacyTrackingDomains</key><array/><key>NSPrivacyCollectedDataTypes</key><array/><key>NSPrivacyAccessedAPITypes</key><array><dict><key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryUserDefaults</string><key>NSPrivacyAccessedAPITypeReasons</key><array><string>CA92.1</string></array></dict></array></dict></plist>\n')
              rb = "require 'xcodeproj'; pr = Xcodeproj::Project.open('ios/App/App.xcodeproj'); t = pr.targets.find { |x| x.name == 'App' }; g = pr.main_group['App']; unless g.files.any? { |f| f.path == 'PrivacyInfo.xcprivacy' }; t.resources_build_phase.add_file_reference(g.new_reference('PrivacyInfo.xcprivacy')); pr.save; end"
              if subprocess.run(['ruby', '-e', rb]).returncode != 0:
                  raise SystemExit('Could not add the Apple privacy manifest to the iPhone project.')
              print('Apple privacy manifest added')
              for f in feats:
                  if FEATURES[f][1]:
                      pb('Add :' + FEATURES[f][1] + ' string ' + FEATURES[f][2])
              ents = ''
              if 'push' in feats:
                  pb('Add :UIBackgroundModes array'); pb('Add :UIBackgroundModes:0 string remote-notification')
                  ents += '<key>aps-environment</key><string>production</string>'
              if 'apple-signin' in feats:
                  ents += '<key>com.apple.developer.applesignin</key><array><string>Default</string></array>'
              if ents:
                  open('ios/App/App/App.entitlements', 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>' + ents + '</dict></plist>\n')
                  pj = 'ios/App/App.xcodeproj/project.pbxproj'
                  t = open(pj).read()
                  if 'CODE_SIGN_ENTITLEMENTS' not in t:
                      t = t.replace('INFOPLIST_FILE = App/Info.plist;', 'CODE_SIGN_ENTITLEMENTS = App/App.entitlements; INFOPLIST_FILE = App/Info.plist;')
                  open(pj, 'w').write(t)
              if schemes:
                  pb('Add :CFBundleURLTypes array'); pb('Add :CFBundleURLTypes:0 dict'); pb('Add :CFBundleURLTypes:0:CFBundleURLSchemes array')
                  for i, s in enumerate(schemes):
                      pb('Add :CFBundleURLTypes:0:CFBundleURLSchemes:' + str(i) + ' string ' + s)
              if hosts:
                  print('iPhone web links need the signed build (Associated Domains); app links work now.')
          print('App settings applied:', plat, feats, hosts, schemes, color)
          PY
`;

export const CODEMAGIC_YAML = String.raw`# Auto-generated by Petal — do not edit by hand.
# Must match src/server/mobile-codemagic-template.server.ts.
workflows:
  petal-default:
    name: Petal Preview (unsigned)
    instance_type: mac_mini_m2
    max_build_duration: 30
    environment:
      flutter: stable
      java: 21
      node: 22
      xcode: latest
      cocoapods: default
    working_directory: petal-app
    scripts:
      - name: Fetch Petal project
        working_directory: .
        script: |
          rm -rf petal-app && mkdir petal-app
          curl -fsS "$PETAL_SOURCE_URL" -o /tmp/petal-source.json
          python3 -c "import json,os;d=json.load(open('/tmp/petal-source.json'))
          for f in d['files']:
              p=os.path.normpath(os.path.join('petal-app',f['path']))
              assert p.startswith('petal-app'+os.sep)
              os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'w').write(f['content'])"
      - name: Install JS dependencies
        script: |
          npm install --no-audit --no-fund
      - name: Build web bundle
        script: |
          npm run build
      - name: Add Capacitor shell
        script: |
          npm install @capacitor/core@^8 @capacitor/cli@^8 @capacitor/ios@^8 @capacitor/android@^8 @capacitor/app@^8 @capacitor/haptics@^8 @capacitor/share@^8 @capacitor/browser@^8 @capacitor/preferences@^8 @aparajita/capacitor-biometric-auth@^10 --save
          if grep -q '"push"' petal.native.json 2>/dev/null && { [ "$PETAL_PLATFORM" = "ios" ] || [ -f google-services.json ]; }; then npm install @capacitor/push-notifications@^8 --save; fi
          if grep -q '"apple-signin"' petal.native.json 2>/dev/null; then npm install @capacitor-community/apple-sign-in@^7 --save; fi
          # Google sign-in add-on (GoogleAuth) predates Capacitor 8: allow its old peer range, swap its retired jcenter repo, and use CocoaPods on iPhone (it has no Swift package).
          if grep -q '"google-signin"' petal.native.json 2>/dev/null; then npm install @codetrix-studio/capacitor-google-auth@3.4.0-rc.4 --save --legacy-peer-deps && sed -i.bak 's/jcenter()/mavenCentral()/g' node_modules/@codetrix-studio/capacitor-google-auth/android/build.gradle; fi
          # Keep the app name from the project's own capacitor.config.json; cap init would otherwise rename the app to the project ID.
          APP_NAME=$(python3 -c "import json;print(json.load(open('capacitor.config.json')).get('appName',''))" 2>/dev/null || true); [ -n "$APP_NAME" ] || APP_NAME="$PETAL_PROJECT_ID"
          npx cap init "$APP_NAME" "$PETAL_BUNDLE_ID" --web-dir=dist
          python3 -c "import json,os,urllib.parse as u;f='capacitor.config.json';c=json.load(open(f));p=os.environ['PETAL_PLATFORM'];ua=c.get('appendUserAgent','');ua=ua if 'PetalNative' in ua else (ua+' PetalNative petal-'+p).strip();c['appendUserAgent']=ua;s=c.setdefault('server',{});h=u.urlparse(s.get('url','')).hostname;a=s.setdefault('allowNavigation',[]);[a.append(x) for x in ([h,'*.'+h] if h else []) if x not in a];json.dump(c,open(f,'w'),indent=2)"
          PM=""; if [ "$PETAL_PLATFORM" = "ios" ] && grep -q '"google-signin"' petal.native.json 2>/dev/null; then PM="--packagemanager CocoaPods"; fi
          npx cap add "$PETAL_PLATFORM" $PM
          if [ "$PETAL_PLATFORM" = "android" ] && [ -f google-services.json ]; then cp google-services.json android/app/; fi
          npx cap sync "$PETAL_PLATFORM"
          if [ "$PETAL_PLATFORM" = "ios" ] && [ -f ios/App/App/Info.plist ]; then
            /usr/libexec/PlistBuddy -c "Add :NSFaceIDUsageDescription string Use Face ID to unlock the app securely." ios/App/App/Info.plist || true
          fi
          if [ "$PETAL_PLATFORM" = "android" ]; then
            printf '\nconfigurations.all {\n    exclude group: "org.jetbrains.kotlin", module: "kotlin-stdlib-jdk7"\n    exclude group: "org.jetbrains.kotlin", module: "kotlin-stdlib-jdk8"\n}\n' >> android/app/build.gradle
          fi
      - name: Native scroll polish
        script: |
          python3 - <<'PY'
          import json, os, re
          plat = os.environ['PETAL_PLATFORM']
          if plat == 'android':
              for root, _, files in os.walk('android/app/src/main/java'):
                  if 'MainActivity.java' in files:
                      f = os.path.join(root, 'MainActivity.java'); s = open(f).read()
                      if 'OVER_SCROLL_NEVER' not in s:
                          body = ('{\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n'
                                  '        android.webkit.WebView w = this.bridge != null ? this.bridge.getWebView() : null;\n'
                                  '        if (w != null) {\n            w.setVerticalScrollBarEnabled(false);\n            w.setHorizontalScrollBarEnabled(false);\n'
                                  '            w.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);\n        }\n    }\n}\n')
                          s = re.sub(r'\{\s*\}\s*$', body, s.rstrip() + '\n')
                          open(f, 'w').write(s); print('patched', f)
          if plat == 'ios':
              f = 'ios/App/App/AppDelegate.swift'
              if os.path.isfile(f):
                  s = open(f).read()
                  if 'bounces = false' not in s:
                      hook = ('-> Bool {\n        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {\n'
                              '            if let vc = self.window?.rootViewController as? CAPBridgeViewController, let sv = vc.webView?.scrollView {\n'
                              '                sv.showsVerticalScrollIndicator = false\n                sv.showsHorizontalScrollIndicator = false\n                sv.bounces = false\n            }\n        }\n')
                      s = s.replace('-> Bool {\n', hook, 1)
                      if 'import Capacitor' not in s: s = 'import Capacitor\n' + s
                      open(f, 'w').write(s); print('patched', f)
                  # Push: forward Apple's device token to Capacitor, or iOS drops it and JS never gets 'registration'.
                  if os.path.isfile('petal.native.json') and 'push' in json.load(open('petal.native.json')).get('features', []):
                      s = open(f).read()
                      if 'capacitorDidRegisterForRemoteNotifications' not in s:
                          cb = ('    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {\n'
                                '        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)\n    }\n\n'
                                '    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {\n'
                                '        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)\n    }\n\n')
                          if '    func applicationWillResignActive' in s:
                              s = s.replace('    func applicationWillResignActive', cb + '    func applicationWillResignActive', 1)
                          else:
                              s = re.sub(r'\}\s*$', cb + '}\n', s.rstrip() + '\n')
                          if 'import Capacitor' not in s: s = 'import Capacitor\n' + s
                          open(f, 'w').write(s); print('push callbacks added', f)
          PY
      - name: Set app icon
        script: |
          python3 - <<'PY'
          import json, os, re, subprocess, urllib.request, urllib.parse
          out = '/tmp/petal-icon.png'
          src = next((p for p in ['public/icon.png','public/app-icon.png','public/apple-touch-icon.png','resources/icon.png','assets/icon.png','public/logo.png'] if os.path.isfile(p)), None)
          def fetch(u):
              req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 PetalBuild'})
              return urllib.request.urlopen(req, timeout=20).read()
          if not src:
              cands = [os.environ.get('PETAL_ICON_URL', '')]
              base = json.load(open('capacitor.config.json')).get('server', {}).get('url', '')
              if base:
                  try:
                      html = fetch(base).decode('utf-8', 'ignore')
                      for rel in ['apple-touch-icon', 'icon']:
                          for tag in re.findall(r'<link[^>]+>', html, re.I):
                              if re.search(r'rel=["\'][^"\']*' + rel, tag, re.I):
                                  m = re.search(r'href=["\']([^"\']+)', tag, re.I)
                                  if m and not m.group(1).endswith(('.svg', '.ico')):
                                      cands.append(urllib.parse.urljoin(base, m.group(1)))
                  except Exception as e:
                      print('icon page fetch failed', e)
              for u in [c for c in cands if c]:
                  try:
                      data = fetch(u)
                      if data[:8] == b'\x89PNG\r\n\x1a\n' or data[:3] == b'\xff\xd8\xff':
                          open('/tmp/petal-icon-src', 'wb').write(data); src = '/tmp/petal-icon-src'; print('icon from', u); break
                  except Exception as e:
                      print('icon fetch failed', u, e)
          if not src:
              print('No app icon found; keeping default'); raise SystemExit(0)
          def size(px, dest):
              os.makedirs(os.path.dirname(dest), exist_ok=True)
              subprocess.run(['sips', '-s', 'format', 'png', '-z', str(px), str(px), src, '--out', dest], check=True, capture_output=True)
          plat = os.environ['PETAL_PLATFORM']
          if plat == 'android':
              res = 'android/app/src/main/res'
              for d, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
                  for n in ['ic_launcher.png', 'ic_launcher_round.png']:
                      size(px, res + '/mipmap-' + d + '/' + n)
                  size(round(px * 2.25), res + '/mipmap-' + d + '/ic_launcher_foreground.png')
              # Adaptive icons crop the edges; use the full-bleed legacy icons instead.
              subprocess.run(['rm', '-rf', res + '/mipmap-anydpi-v26'])
          else:
              d = 'ios/App/App/Assets.xcassets/AppIcon.appiconset'
              for f in os.listdir(d):
                  if f.endswith('.png'):
                      size(1024, d + '/' + f)
          print('App icon applied for', plat)
          PY
${APP_SETTINGS_STEP}      - name: Build native artifact (unsigned)
        script: |
          if [ "$PETAL_PLATFORM" = "ios" ]; then
            cd ios/App
            if [ -d App.xcworkspace ]; then XC="-workspace App.xcworkspace"; else XC="-project App.xcodeproj"; fi
            xcodebuild $XC -scheme App -configuration Debug \
              -sdk iphoneos -derivedDataPath build CODE_SIGNING_ALLOWED=NO
            mkdir -p Payload
            cp -R build/Build/Products/Debug-iphoneos/App.app Payload/
            zip -r petal-preview.ipa Payload
            cp petal-preview.ipa $CM_BUILD_DIR/
            mv petal-preview.ipa ../../
          else
            cd android
            ./gradlew assembleDebug
            cp app/build/outputs/apk/debug/app-debug.apk $CM_BUILD_DIR/petal-preview.apk
            cp app/build/outputs/apk/debug/app-debug.apk ../petal-preview.apk
          fi
    artifacts:
      - "*.ipa"
      - "*.apk"
    publishing:
      scripts:
        - name: Notify Petal
          script: |
            STATUS="succeeded"
            if [ "$CM_BUILD_STEP_STATUS" != "success" ] && [ "$CM_BUILD_STEP_STATUS" != "" ]; then STATUS="failed"; fi
            ARTIFACT_URL=$(echo "$CM_ARTIFACT_LINKS" | python3 -c "import sys,json;d=json.load(sys.stdin) if sys.stdin.readable() else [];print((d[0].get('url','') if d else ''))" 2>/dev/null || echo "")
            BODY=$(printf '{"codemagicBuildId":"%s","status":"%s","artifactUrl":"%s"}' "$CM_BUILD_ID" "$STATUS" "$ARTIFACT_URL")
            TS=$(date +%s)
            SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$PETAL_WEBHOOK_SECRET" -hex | awk '{print $2}')
            curl -fsS -X POST "$PETAL_CALLBACK_URL" \
              -H "Content-Type: application/json" \
              -H "x-petal-timestamp: $TS" \
              -H "x-petal-signature: $SIG" \
              --data "$BODY" || true

  petal-default-signed:
    name: Petal Release (signed)
    instance_type: mac_mini_m2
    max_build_duration: 60
    environment:
      flutter: stable
      java: 21
      node: 22
      xcode: latest
      cocoapods: default
    working_directory: petal-app
    scripts:
      - name: Fetch Petal project
        working_directory: .
        script: |
          rm -rf petal-app && mkdir petal-app
          curl -fsS "$PETAL_SOURCE_URL" -o /tmp/petal-source.json
          python3 -c "import json,os;d=json.load(open('/tmp/petal-source.json'))
          for f in d['files']:
              p=os.path.normpath(os.path.join('petal-app',f['path']))
              assert p.startswith('petal-app'+os.sep)
              os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'w').write(f['content'])"
      - name: Install JS dependencies
        script: npm install --no-audit --no-fund
      - name: Build web bundle
        script: npm run build
      - name: Add Capacitor shell
        script: |
          npm install @capacitor/core@^8 @capacitor/cli@^8 @capacitor/ios@^8 @capacitor/android@^8 @capacitor/app@^8 @capacitor/haptics@^8 @capacitor/share@^8 @capacitor/browser@^8 @capacitor/preferences@^8 @aparajita/capacitor-biometric-auth@^10 --save
          if grep -q '"push"' petal.native.json 2>/dev/null && { [ "$PETAL_PLATFORM" = "ios" ] || [ -f google-services.json ]; }; then npm install @capacitor/push-notifications@^8 --save; fi
          if grep -q '"apple-signin"' petal.native.json 2>/dev/null; then npm install @capacitor-community/apple-sign-in@^7 --save; fi
          # Google sign-in add-on (GoogleAuth) predates Capacitor 8: allow its old peer range, swap its retired jcenter repo, and use CocoaPods on iPhone (it has no Swift package).
          if grep -q '"google-signin"' petal.native.json 2>/dev/null; then npm install @codetrix-studio/capacitor-google-auth@3.4.0-rc.4 --save --legacy-peer-deps && sed -i.bak 's/jcenter()/mavenCentral()/g' node_modules/@codetrix-studio/capacitor-google-auth/android/build.gradle; fi
          # Keep the app name from the project's own capacitor.config.json; cap init would otherwise rename the app to the project ID.
          APP_NAME=$(python3 -c "import json;print(json.load(open('capacitor.config.json')).get('appName',''))" 2>/dev/null || true); [ -n "$APP_NAME" ] || APP_NAME="$PETAL_PROJECT_ID"
          npx cap init "$APP_NAME" "$PETAL_BUNDLE_ID" --web-dir=dist
          python3 -c "import json,os,urllib.parse as u;f='capacitor.config.json';c=json.load(open(f));p=os.environ['PETAL_PLATFORM'];ua=c.get('appendUserAgent','');ua=ua if 'PetalNative' in ua else (ua+' PetalNative petal-'+p).strip();c['appendUserAgent']=ua;s=c.setdefault('server',{});h=u.urlparse(s.get('url','')).hostname;a=s.setdefault('allowNavigation',[]);[a.append(x) for x in ([h,'*.'+h] if h else []) if x not in a];json.dump(c,open(f,'w'),indent=2)"
          PM=""; if [ "$PETAL_PLATFORM" = "ios" ] && grep -q '"google-signin"' petal.native.json 2>/dev/null; then PM="--packagemanager CocoaPods"; fi
          npx cap add "$PETAL_PLATFORM" $PM
          if [ "$PETAL_PLATFORM" = "android" ] && [ -f google-services.json ]; then cp google-services.json android/app/; fi
          npx cap sync "$PETAL_PLATFORM"
          if [ "$PETAL_PLATFORM" = "ios" ] && [ -f ios/App/App/Info.plist ]; then
            /usr/libexec/PlistBuddy -c "Add :NSFaceIDUsageDescription string Use Face ID to unlock the app securely." ios/App/App/Info.plist || true
          fi
          if [ "$PETAL_PLATFORM" = "android" ]; then
            printf '\nconfigurations.all {\n    exclude group: "org.jetbrains.kotlin", module: "kotlin-stdlib-jdk7"\n    exclude group: "org.jetbrains.kotlin", module: "kotlin-stdlib-jdk8"\n}\n' >> android/app/build.gradle
          fi
      - name: Native scroll polish
        script: |
          python3 - <<'PY'
          import json, os, re
          plat = os.environ['PETAL_PLATFORM']
          if plat == 'android':
              for root, _, files in os.walk('android/app/src/main/java'):
                  if 'MainActivity.java' in files:
                      f = os.path.join(root, 'MainActivity.java'); s = open(f).read()
                      if 'OVER_SCROLL_NEVER' not in s:
                          body = ('{\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n'
                                  '        android.webkit.WebView w = this.bridge != null ? this.bridge.getWebView() : null;\n'
                                  '        if (w != null) {\n            w.setVerticalScrollBarEnabled(false);\n            w.setHorizontalScrollBarEnabled(false);\n'
                                  '            w.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);\n        }\n    }\n}\n')
                          s = re.sub(r'\{\s*\}\s*$', body, s.rstrip() + '\n')
                          open(f, 'w').write(s); print('patched', f)
          if plat == 'ios':
              f = 'ios/App/App/AppDelegate.swift'
              if os.path.isfile(f):
                  s = open(f).read()
                  if 'bounces = false' not in s:
                      hook = ('-> Bool {\n        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {\n'
                              '            if let vc = self.window?.rootViewController as? CAPBridgeViewController, let sv = vc.webView?.scrollView {\n'
                              '                sv.showsVerticalScrollIndicator = false\n                sv.showsHorizontalScrollIndicator = false\n                sv.bounces = false\n            }\n        }\n')
                      s = s.replace('-> Bool {\n', hook, 1)
                      if 'import Capacitor' not in s: s = 'import Capacitor\n' + s
                      open(f, 'w').write(s); print('patched', f)
                  # Push: forward Apple's device token to Capacitor, or iOS drops it and JS never gets 'registration'.
                  if os.path.isfile('petal.native.json') and 'push' in json.load(open('petal.native.json')).get('features', []):
                      s = open(f).read()
                      if 'capacitorDidRegisterForRemoteNotifications' not in s:
                          cb = ('    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {\n'
                                '        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)\n    }\n\n'
                                '    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {\n'
                                '        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)\n    }\n\n')
                          if '    func applicationWillResignActive' in s:
                              s = s.replace('    func applicationWillResignActive', cb + '    func applicationWillResignActive', 1)
                          else:
                              s = re.sub(r'\}\s*$', cb + '}\n', s.rstrip() + '\n')
                          if 'import Capacitor' not in s: s = 'import Capacitor\n' + s
                          open(f, 'w').write(s); print('push callbacks added', f)
          PY
      - name: Set app icon
        script: |
          python3 - <<'PY'
          import json, os, re, subprocess, urllib.request, urllib.parse
          out = '/tmp/petal-icon.png'
          src = next((p for p in ['public/icon.png','public/app-icon.png','public/apple-touch-icon.png','resources/icon.png','assets/icon.png','public/logo.png'] if os.path.isfile(p)), None)
          def fetch(u):
              req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 PetalBuild'})
              return urllib.request.urlopen(req, timeout=20).read()
          if not src:
              cands = [os.environ.get('PETAL_ICON_URL', '')]
              base = json.load(open('capacitor.config.json')).get('server', {}).get('url', '')
              if base:
                  try:
                      html = fetch(base).decode('utf-8', 'ignore')
                      for rel in ['apple-touch-icon', 'icon']:
                          for tag in re.findall(r'<link[^>]+>', html, re.I):
                              if re.search(r'rel=["\'][^"\']*' + rel, tag, re.I):
                                  m = re.search(r'href=["\']([^"\']+)', tag, re.I)
                                  if m and not m.group(1).endswith(('.svg', '.ico')):
                                      cands.append(urllib.parse.urljoin(base, m.group(1)))
                  except Exception as e:
                      print('icon page fetch failed', e)
              for u in [c for c in cands if c]:
                  try:
                      data = fetch(u)
                      if data[:8] == b'\x89PNG\r\n\x1a\n' or data[:3] == b'\xff\xd8\xff':
                          open('/tmp/petal-icon-src', 'wb').write(data); src = '/tmp/petal-icon-src'; print('icon from', u); break
                  except Exception as e:
                      print('icon fetch failed', u, e)
          if not src:
              print('No app icon found; keeping default'); raise SystemExit(0)
          def size(px, dest):
              os.makedirs(os.path.dirname(dest), exist_ok=True)
              subprocess.run(['sips', '-s', 'format', 'png', '-z', str(px), str(px), src, '--out', dest], check=True, capture_output=True)
          plat = os.environ['PETAL_PLATFORM']
          if plat == 'android':
              res = 'android/app/src/main/res'
              for d, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
                  for n in ['ic_launcher.png', 'ic_launcher_round.png']:
                      size(px, res + '/mipmap-' + d + '/' + n)
                  size(round(px * 2.25), res + '/mipmap-' + d + '/ic_launcher_foreground.png')
              # Adaptive icons crop the edges; use the full-bleed legacy icons instead.
              subprocess.run(['rm', '-rf', res + '/mipmap-anydpi-v26'])
          else:
              d = 'ios/App/App/Assets.xcassets/AppIcon.appiconset'
              for f in os.listdir(d):
                  if f.endswith('.png'):
                      size(1024, d + '/' + f)
          print('App icon applied for', plat)
          PY
${APP_SETTINGS_STEP}      - name: Decrypt signing materials
        script: |
          if [ "$PETAL_PLATFORM" = "ios" ]; then
            echo "$APPLE_P12_BASE64" | base64 --decode > /tmp/cert.p12
            echo "$APPLE_PROVISIONING_PROFILE_BASE64" | base64 --decode > /tmp/profile.mobileprovision
            keychain initialize
            keychain add-certificates --certificate /tmp/cert.p12 --certificate-password "$APPLE_P12_PASSWORD"
            mkdir -p ~/Library/MobileDevice/Provisioning\\ Profiles
            cp /tmp/profile.mobileprovision ~/Library/MobileDevice/Provisioning\\ Profiles/
          else
            echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > /tmp/release.keystore
          fi
      - name: Build signed artifact
        script: |
          if [ "$PETAL_PLATFORM" = "ios" ]; then
            cd ios/App
            xcode-project use-profiles
            if [ -d App.xcworkspace ]; then
              xcode-project build-ipa --workspace App.xcworkspace --scheme App
            else
              xcode-project build-ipa --project App.xcodeproj --scheme App
            fi
            cp build/ios/ipa/App.ipa $CM_BUILD_DIR/petal-release.ipa
            mv build/ios/ipa/App.ipa ../../petal-release.ipa
          else
            cd android
            ./gradlew bundleRelease \
              -Pandroid.injected.signing.store.file=/tmp/release.keystore \
              -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
              -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
              -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD"
            cp app/build/outputs/bundle/release/app-release.aab $CM_BUILD_DIR/petal-release.aab
            cp app/build/outputs/bundle/release/app-release.aab ../petal-release.aab
          fi
    artifacts:
      - "*.ipa"
      - "*.aab"
    publishing:
      scripts:
        - name: Notify Petal
          script: |
            STATUS="succeeded"
            if [ "$CM_BUILD_STEP_STATUS" != "success" ] && [ "$CM_BUILD_STEP_STATUS" != "" ]; then STATUS="failed"; fi
            ARTIFACT_URL=$(echo "$CM_ARTIFACT_LINKS" | python3 -c "import sys,json;d=json.load(sys.stdin) if sys.stdin.readable() else [];print((d[0].get('url','') if d else ''))" 2>/dev/null || echo "")
            BODY=$(printf '{"codemagicBuildId":"%s","status":"%s","artifactUrl":"%s"}' "$CM_BUILD_ID" "$STATUS" "$ARTIFACT_URL")
            TS=$(date +%s)
            SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$PETAL_WEBHOOK_SECRET" -hex | awk '{print $2}')
            curl -fsS -X POST "$PETAL_CALLBACK_URL" \
              -H "Content-Type: application/json" \
              -H "x-petal-timestamp: $TS" \
              -H "x-petal-signature: $SIG" \
              --data "$BODY" || true
  petal-ios-testflight:
    name: Petal iPhone (TestFlight)
    integrations:
      app_store_connect: Petal
    instance_type: mac_mini_m2
    max_build_duration: 60
    environment:
      groups:
        - apple_signing
      flutter: stable
      java: 21
      node: 22
      xcode: latest
      cocoapods: default
    working_directory: petal-app
    scripts:
      - name: Fetch Petal project
        working_directory: .
        script: |
          rm -rf petal-app && mkdir petal-app
          curl -fsS "$PETAL_SOURCE_URL" -o /tmp/petal-source.json
          python3 -c "import json,os;d=json.load(open('/tmp/petal-source.json'))
          for f in d['files']:
              p=os.path.normpath(os.path.join('petal-app',f['path']))
              assert p.startswith('petal-app'+os.sep)
              os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'w').write(f['content'])"
      - name: Install JS dependencies
        script: npm install --no-audit --no-fund
      - name: Build web bundle
        script: npm run build
      - name: Add Capacitor shell
        script: |
          npm install @capacitor/core@^8 @capacitor/cli@^8 @capacitor/ios@^8 @capacitor/android@^8 @capacitor/app@^8 @capacitor/haptics@^8 @capacitor/share@^8 @capacitor/browser@^8 @capacitor/preferences@^8 @aparajita/capacitor-biometric-auth@^10 --save
          if grep -q '"push"' petal.native.json 2>/dev/null && { [ "$PETAL_PLATFORM" = "ios" ] || [ -f google-services.json ]; }; then npm install @capacitor/push-notifications@^8 --save; fi
          if grep -q '"apple-signin"' petal.native.json 2>/dev/null; then npm install @capacitor-community/apple-sign-in@^7 --save; fi
          # Google sign-in add-on (GoogleAuth) predates Capacitor 8: allow its old peer range, swap its retired jcenter repo, and use CocoaPods on iPhone (it has no Swift package).
          if grep -q '"google-signin"' petal.native.json 2>/dev/null; then npm install @codetrix-studio/capacitor-google-auth@3.4.0-rc.4 --save --legacy-peer-deps && sed -i.bak 's/jcenter()/mavenCentral()/g' node_modules/@codetrix-studio/capacitor-google-auth/android/build.gradle; fi
          # Keep the app name from the project's own capacitor.config.json; cap init would otherwise rename the app to the project ID.
          APP_NAME=$(python3 -c "import json;print(json.load(open('capacitor.config.json')).get('appName',''))" 2>/dev/null || true); [ -n "$APP_NAME" ] || APP_NAME="$PETAL_PROJECT_ID"
          npx cap init "$APP_NAME" "$PETAL_BUNDLE_ID" --web-dir=dist
          python3 -c "import json,os,urllib.parse as u;f='capacitor.config.json';c=json.load(open(f));p=os.environ['PETAL_PLATFORM'];ua=c.get('appendUserAgent','');ua=ua if 'PetalNative' in ua else (ua+' PetalNative petal-'+p).strip();c['appendUserAgent']=ua;s=c.setdefault('server',{});h=u.urlparse(s.get('url','')).hostname;a=s.setdefault('allowNavigation',[]);[a.append(x) for x in ([h,'*.'+h] if h else []) if x not in a];json.dump(c,open(f,'w'),indent=2)"
          PM=""; if [ "$PETAL_PLATFORM" = "ios" ] && grep -q '"google-signin"' petal.native.json 2>/dev/null; then PM="--packagemanager CocoaPods"; fi
          npx cap add "$PETAL_PLATFORM" $PM
          if [ "$PETAL_PLATFORM" = "android" ] && [ -f google-services.json ]; then cp google-services.json android/app/; fi
          npx cap sync "$PETAL_PLATFORM"
          if [ "$PETAL_PLATFORM" = "ios" ] && [ -f ios/App/App/Info.plist ]; then
            /usr/libexec/PlistBuddy -c "Add :NSFaceIDUsageDescription string Use Face ID to unlock the app securely." ios/App/App/Info.plist || true
          fi
          if [ "$PETAL_PLATFORM" = "android" ]; then
            printf '\nconfigurations.all {\n    exclude group: "org.jetbrains.kotlin", module: "kotlin-stdlib-jdk7"\n    exclude group: "org.jetbrains.kotlin", module: "kotlin-stdlib-jdk8"\n}\n' >> android/app/build.gradle
          fi
      - name: Native scroll polish
        script: |
          python3 - <<'PY'
          import json, os, re
          plat = os.environ['PETAL_PLATFORM']
          if plat == 'android':
              for root, _, files in os.walk('android/app/src/main/java'):
                  if 'MainActivity.java' in files:
                      f = os.path.join(root, 'MainActivity.java'); s = open(f).read()
                      if 'OVER_SCROLL_NEVER' not in s:
                          body = ('{\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n'
                                  '        android.webkit.WebView w = this.bridge != null ? this.bridge.getWebView() : null;\n'
                                  '        if (w != null) {\n            w.setVerticalScrollBarEnabled(false);\n            w.setHorizontalScrollBarEnabled(false);\n'
                                  '            w.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);\n        }\n    }\n}\n')
                          s = re.sub(r'\{\s*\}\s*$', body, s.rstrip() + '\n')
                          open(f, 'w').write(s); print('patched', f)
          if plat == 'ios':
              f = 'ios/App/App/AppDelegate.swift'
              if os.path.isfile(f):
                  s = open(f).read()
                  if 'bounces = false' not in s:
                      hook = ('-> Bool {\n        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {\n'
                              '            if let vc = self.window?.rootViewController as? CAPBridgeViewController, let sv = vc.webView?.scrollView {\n'
                              '                sv.showsVerticalScrollIndicator = false\n                sv.showsHorizontalScrollIndicator = false\n                sv.bounces = false\n            }\n        }\n')
                      s = s.replace('-> Bool {\n', hook, 1)
                      if 'import Capacitor' not in s: s = 'import Capacitor\n' + s
                      open(f, 'w').write(s); print('patched', f)
                  # Push: forward Apple's device token to Capacitor, or iOS drops it and JS never gets 'registration'.
                  if os.path.isfile('petal.native.json') and 'push' in json.load(open('petal.native.json')).get('features', []):
                      s = open(f).read()
                      if 'capacitorDidRegisterForRemoteNotifications' not in s:
                          cb = ('    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {\n'
                                '        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)\n    }\n\n'
                                '    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {\n'
                                '        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)\n    }\n\n')
                          if '    func applicationWillResignActive' in s:
                              s = s.replace('    func applicationWillResignActive', cb + '    func applicationWillResignActive', 1)
                          else:
                              s = re.sub(r'\}\s*$', cb + '}\n', s.rstrip() + '\n')
                          if 'import Capacitor' not in s: s = 'import Capacitor\n' + s
                          open(f, 'w').write(s); print('push callbacks added', f)
          PY
      - name: Set app icon
        script: |
          python3 - <<'PY'
          import json, os, re, subprocess, urllib.request, urllib.parse
          out = '/tmp/petal-icon.png'
          src = next((p for p in ['public/icon.png','public/app-icon.png','public/apple-touch-icon.png','resources/icon.png','assets/icon.png','public/logo.png'] if os.path.isfile(p)), None)
          def fetch(u):
              req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 PetalBuild'})
              return urllib.request.urlopen(req, timeout=20).read()
          if not src:
              cands = [os.environ.get('PETAL_ICON_URL', '')]
              base = json.load(open('capacitor.config.json')).get('server', {}).get('url', '')
              if base:
                  try:
                      html = fetch(base).decode('utf-8', 'ignore')
                      for rel in ['apple-touch-icon', 'icon']:
                          for tag in re.findall(r'<link[^>]+>', html, re.I):
                              if re.search(r'rel=["\'][^"\']*' + rel, tag, re.I):
                                  m = re.search(r'href=["\']([^"\']+)', tag, re.I)
                                  if m and not m.group(1).endswith(('.svg', '.ico')):
                                      cands.append(urllib.parse.urljoin(base, m.group(1)))
                  except Exception as e:
                      print('icon page fetch failed', e)
              for u in [c for c in cands if c]:
                  try:
                      data = fetch(u)
                      if data[:8] == b'\x89PNG\r\n\x1a\n' or data[:3] == b'\xff\xd8\xff':
                          open('/tmp/petal-icon-src', 'wb').write(data); src = '/tmp/petal-icon-src'; print('icon from', u); break
                  except Exception as e:
                      print('icon fetch failed', u, e)
          if not src:
              print('No app icon found; keeping default'); raise SystemExit(0)
          def size(px, dest):
              os.makedirs(os.path.dirname(dest), exist_ok=True)
              subprocess.run(['sips', '-s', 'format', 'png', '-z', str(px), str(px), src, '--out', dest], check=True, capture_output=True)
          plat = os.environ['PETAL_PLATFORM']
          if plat == 'android':
              res = 'android/app/src/main/res'
              for d, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
                  for n in ['ic_launcher.png', 'ic_launcher_round.png']:
                      size(px, res + '/mipmap-' + d + '/' + n)
                  size(round(px * 2.25), res + '/mipmap-' + d + '/ic_launcher_foreground.png')
              # Adaptive icons crop the edges; use the full-bleed legacy icons instead.
              subprocess.run(['rm', '-rf', res + '/mipmap-anydpi-v26'])
          else:
              d = 'ios/App/App/Assets.xcassets/AppIcon.appiconset'
              for f in os.listdir(d):
                  if f.endswith('.png'):
                      size(1024, d + '/' + f)
          print('App icon applied for', plat)
          PY
${APP_SETTINGS_STEP}      - name: Set up Apple signing
        script: |
          keychain initialize
          CAPS=""
          if grep -q '"push"' petal.native.json 2>/dev/null; then CAPS="$CAPS PUSH_NOTIFICATIONS"; fi
          if grep -q '"apple-signin"' petal.native.json 2>/dev/null; then CAPS="$CAPS APPLE_ID_AUTH"; fi
          if [ -n "$CAPS" ]; then
            BID=$(app-store-connect bundle-ids list --bundle-id-identifier "$PETAL_BUNDLE_ID" --strict-match-identifier --json | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
            if [ -n "$BID" ]; then for C in $CAPS; do app-store-connect bundle-ids enable-capabilities "$BID" --capability "$C" || true; done; fi
          fi
          app-store-connect fetch-signing-files "$PETAL_BUNDLE_ID" --type IOS_APP_STORE --create
          keychain add-certificates
          xcode-project use-profiles
      - name: Build signed iPhone app
        script: |
          /usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" ios/App/App/Info.plist || true
          cd ios/App
          agvtool new-version -all $(date -u +%Y%m%d%H%M)
          if [ -d App.xcworkspace ]; then
            xcode-project build-ipa --workspace App.xcworkspace --scheme App
          else
            xcode-project build-ipa --project App.xcodeproj --scheme App
          fi
          cp build/ios/ipa/*.ipa $CM_BUILD_DIR/petal-release.ipa
          cp build/ios/ipa/*.ipa ../../petal-release.ipa
    artifacts:
      - "*.ipa"
      - petal-app/ios/App/build/ios/ipa/*.ipa
    publishing:
      app_store_connect:
        auth: integration
`;
