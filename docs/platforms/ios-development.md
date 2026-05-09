---
summary: "iOS app development: setup, build, test, and deploy the OpenClaw iOS node app"
read_when:
  - Setting up iOS development environment
  - Building the iOS app from source
  - Running iOS tests locally
  - Debugging iOS build issues
  - Preparing iOS releases
---

# iOS Development Setup

Complete guide for building, testing, and developing the OpenClaw iOS app.

## Current State

- iOS app source: `apps/ios/` (Swift/SwiftUI)
- Project generation: XcodeGen (`project.yml`)
- CI: Disabled but configured in `.github/workflows/ci.yml`
- Requirements: Xcode 16+, iOS 18+ SDK, Swift 6.0

## Prerequisites

### 1. macOS Environment

- macOS with Xcode 16.0+ installed
- Command Line Tools: `xcode-select --install`
- Homebrew package manager

### 2. Install Build Tools

```bash
brew install xcodegen swiftlint swiftformat
```

**What each tool does:**
- **XcodeGen**: Generates Xcode project from `project.yml` (keeps project file out of git)
- **SwiftLint**: Enforces Swift style and conventions
- **SwiftFormat**: Formats Swift code consistently

### 3. Install fastlane (Optional)

For TestFlight uploads and App Store deployment:

```bash
brew install fastlane
```

## Local Development Setup

### Step 1: Initialize Submodules

The iOS app depends on shared packages in submodules:

```bash
git submodule update --init --recursive
```

**Dependencies:**
- `../shared/OpenClawKit` - Shared Swift package (types, protocol definitions)
- `../../Swabble` - Submodule (testing utilities)

### Step 2: Generate Xcode Project

```bash
cd apps/ios
xcodegen generate
```

This creates `OpenClaw.xcodeproj` from `project.yml`. The Xcode project file is gitignored because it's generated from the YAML config.

**If this fails:**
- Ensure xcodegen is installed: `brew install xcodegen`
- Check that `project.yml` exists in `apps/ios/`

### Step 3: Configure Code Signing

The project uses manual code signing with:
- Team ID: `Y5PE65HELJ` (default, hardcoded in `project.yml`)
- Provisioning profile: `ai.openclaw.ios Development`

**To use your own Team ID:**

1. Get your Team ID:
   ```bash
   scripts/ios-team-id.sh
   ```

2. Edit `apps/ios/project.yml` line 73:
   ```yaml
   DEVELOPMENT_TEAM: YOUR_TEAM_ID
   ```

3. Update provisioning profile specifier if needed (line 75)

4. Regenerate project:
   ```bash
   cd apps/ios
   xcodegen generate
   ```

**Alternative: Use Automatic Signing**

Edit `project.yml`:
```yaml
CODE_SIGN_STYLE: Automatic
```

Then remove or comment out `PROVISIONING_PROFILE_SPECIFIER`.

### Step 4: Open in Xcode

```bash
cd apps/ios
open OpenClaw.xcodeproj
```

### Step 5: Build and Run

In Xcode:
1. Select target: **OpenClaw**
2. Select destination: iPhone simulator or physical device
3. Build: `⌘B`
4. Run: `⌘R`

**First build notes:**
- Pre-build scripts will run SwiftLint and SwiftFormat
- These tools must be in PATH: `/opt/homebrew/bin` or `/usr/local/bin`
- Build may take 1-2 minutes on first run

## Pre-Build Scripts

The project has automated checks that run before every build:

### SwiftFormat (lint)

Validates Swift code formatting. Config: `../../.swiftformat`

**To fix formatting issues:**
```bash
swiftformat --config .swiftformat apps/ios/Sources apps/ios/Tests
```

### SwiftLint

Validates Swift code style. Config: `apps/ios/.swiftlint.yml`

**To fix auto-fixable issues:**
```bash
swiftlint --fix --config apps/ios/.swiftlint.yml
```

## Testing

### Run Tests in Xcode

1. Open project: `open apps/ios/OpenClaw.xcodeproj`
2. Select scheme: **OpenClaw**
3. Test: `⌘U`

### Run Tests via Command Line

```bash
xcodebuild test \
  -project apps/ios/OpenClaw.xcodeproj \
  -scheme OpenClaw \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

**With code coverage:**
```bash
xcodebuild test \
  -project apps/ios/OpenClaw.xcodeproj \
  -scheme OpenClaw \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -enableCodeCoverage YES \
  -resultBundlePath /tmp/OpenClaw-iOS.xcresult
```

**View coverage report:**
```bash
xcrun xccov view --report /tmp/OpenClaw-iOS.xcresult
```

### Test Files Location

- Source: `apps/ios/Sources/`
- Tests: `apps/ios/Tests/`

**Key test files:**
- `AppCoverageTests.swift` - Basic app initialization
- `GatewayConnectionControllerTests.swift` - Gateway connection logic
- `VoiceWakeManagerTests.swift` - Voice wake detection
- `CameraControllerTests.swift` - Camera capture
- `ScreenControllerTests.swift` - Screen recording

## FastLane Setup (TestFlight / App Store)

### Step 1: Create App Store Connect API Key

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Navigate to: Users and Access → Keys → App Store Connect API
3. Click **Generate API Key** (role: App Manager or Admin)
4. Download the `.p8` file
5. Note the **Issuer ID** and **Key ID**

### Step 2: Create `.env` File

```bash
cd apps/ios/fastlane
cp .env.example .env
```

Edit `fastlane/.env`:
```bash
ASC_KEY_ID=YOUR_KEY_ID
ASC_ISSUER_ID=YOUR_ISSUER_ID
ASC_KEY_PATH=/absolute/path/to/AuthKey_XXXXXXXXXX.p8

# Code signing (Apple Team ID)
IOS_DEVELOPMENT_TEAM=YOUR_TEAM_ID
```

**Security note:** The `.env` file is gitignored. Keep your API key secure.

### Step 3: Upload Beta Build

```bash
cd apps/ios
fastlane beta
```

**What this does:**
1. Builds the app in release mode
2. Signs with App Store distribution profile
3. Uploads to TestFlight
4. Beta build available in ~5-10 minutes

**View available lanes:**
```bash
cd apps/ios
fastlane lanes
```

## CI Configuration

The iOS CI job exists in `.github/workflows/ci.yml` but is currently disabled.

### Current CI Issues

The CI configuration has outdated references:

- **Line 423:** Job is disabled with `if: false`
- **Line 548-549:** References wrong project name `Clawdis.xcodeproj` (should be `OpenClaw.xcodeproj`)
- **Line 549:** References wrong scheme `Clawdis` (should be `OpenClaw`)
- **Line 570:** References wrong target `Clawdis.app` (should be `OpenClaw.app`)

### Enabling iOS in CI

**Required changes to `.github/workflows/ci.yml`:**

```yaml
# Line 423: Enable the job
if: github.event_name == 'pull_request'

# Line 548: Fix project path
-project apps/ios/OpenClaw.xcodeproj \

# Line 549: Fix scheme name
-scheme OpenClaw \

# Line 570: Fix target name in coverage check
target_name = "OpenClaw.app"
```

**Additional considerations:**
- CI uses Xcode 26.1 (line 444) - verify this version is available on GitHub-hosted runners
- Coverage gate is set to 43% (line 571)
- Tests run on iPhone 16 simulator (preferred) or newest available iOS runtime

## Architecture Overview

### App Structure

```
apps/ios/Sources/
├── OpenClawApp.swift          # App entry point
├── RootTabs.swift             # Main tab view
├── RootCanvas.swift           # Canvas view
├── SessionKey.swift           # Session management
├── Camera/
│   └── CameraController.swift # Photo/video capture
├── Chat/
│   ├── ChatSheet.swift        # Chat interface
│   └── IOSGatewayChatTransport.swift
├── Gateway/
│   ├── GatewayConnectionController.swift
│   ├── GatewayDiscoveryModel.swift
│   ├── GatewaySettingsStore.swift
│   └── KeychainStore.swift    # Secure storage
├── Location/
│   └── LocationService.swift  # GPS integration
├── Screen/
│   ├── ScreenController.swift
│   ├── ScreenRecordService.swift
│   └── ScreenWebView.swift
├── Settings/
│   ├── SettingsTab.swift
│   └── VoiceWakeWordsSettingsView.swift
├── Status/
│   ├── StatusPill.swift
│   └── VoiceWakeToast.swift
└── Voice/
    ├── VoiceTab.swift
    ├── VoiceWakeManager.swift
    ├── VoiceWakePreferences.swift
    ├── TalkModeManager.swift
    └── TalkOrbOverlay.swift
```

### Key Tabs

1. **Voice Tab**: Voice wake detection, talk mode
2. **Screen Tab**: Screen sharing, canvas rendering
3. **Chat Tab**: Direct chat with gateway agent
4. **Settings Tab**: Gateway discovery, connection, preferences

### Dependencies

**Swift Packages** (in `project.yml`):
- `OpenClawKit` - Shared types and constants
- `OpenClawChatUI` - Chat interface components
- `OpenClawProtocol` - Gateway WebSocket protocol
- `SwabbleKit` - Testing utilities

**System Frameworks:**
- `AppIntents.framework` - App Shortcuts / Siri integration (iOS 18+)
- AVFoundation - Camera and audio
- CoreLocation - GPS services
- WebKit - Canvas rendering

### Deployment Settings

- **Target:** iOS 18.0+
- **Swift Version:** 6.0
- **Strict Concurrency:** Enabled (Swift 6 data-race safety)
- **Bundle ID:** `ai.openclaw.ios`
- **Version:** Defined in `project.yml` (CFBundleShortVersionString)

## Common Issues

### Issue: "xcodegen: command not found"

**Solution:**
```bash
brew install xcodegen
```

### Issue: "swiftformat: command not found" or "swiftlint: command not found"

**Solution:**
```bash
brew install swiftformat swiftlint
```

### Issue: Code signing failed

**Symptoms:**
- "No signing identity found"
- "Provisioning profile not found"

**Solutions:**

1. **Use your own Team ID** (see Step 3 above)

2. **Switch to automatic signing:**
   - Edit `project.yml`: `CODE_SIGN_STYLE: Automatic`
   - Regenerate: `xcodegen generate`

3. **Add Apple ID to Xcode:**
   - Xcode → Settings → Accounts
   - Add Apple ID
   - Download manual profiles

### Issue: Shared packages not found

**Symptoms:**
- "No such module 'OpenClawKit'"
- Build fails with import errors

**Solution:**
```bash
git submodule update --init --recursive
```

### Issue: "Could not find OpenClaw.xcodeproj"

**Cause:** Project not generated yet

**Solution:**
```bash
cd apps/ios
xcodegen generate
```

### Issue: Pre-build script fails with "command not found"

**Cause:** SwiftLint or SwiftFormat not in PATH

**Solution:**

Ensure Homebrew binaries are in your PATH. Add to `~/.zshrc` or `~/.bash_profile`:
```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
```

Then restart Xcode or your terminal.

### Issue: Simulator not found

**Symptoms:**
- "Unable to boot device"
- "No destinations found"

**Solution:**

List available simulators:
```bash
xcrun simctl list devices
```

Boot a simulator manually:
```bash
open -a Simulator
```

Or create a new one:
```bash
xcrun simctl create "iPhone 16" "iPhone 16"
```

## Development Workflow

### Making Changes

1. Make code changes in `apps/ios/Sources/`
2. Build in Xcode (`⌘B`) - pre-build scripts will lint automatically
3. Fix any lint errors
4. Run tests (`⌘U`)
5. Test on device or simulator

### Before Committing

```bash
# Format Swift code
swiftformat --config .swiftformat apps/ios/Sources apps/ios/Tests

# Lint Swift code
swiftlint --fix --config apps/ios/.swiftlint.yml

# Run tests
cd apps/ios
xcodebuild test \
  -project OpenClaw.xcodeproj \
  -scheme OpenClaw \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

### Updating project.yml

If you modify `apps/ios/project.yml` (add files, change settings, etc.):

```bash
cd apps/ios
xcodegen generate
```

The `.xcodeproj` file is gitignored, so you only commit `project.yml` changes.

## Testing with a Gateway

To test the full app functionality, you need a running gateway:

1. Start gateway on another device:
   ```bash
   openclaw gateway --port 18789
   ```

2. In iOS app Settings tab:
   - Enable discovery (Bonjour or manual host)
   - Select gateway from list
   - Approve pairing on gateway host

3. Test node capabilities:
   ```bash
   # List connected nodes
   openclaw nodes status

   # Test canvas
   openclaw nodes invoke --node "iOS Node" --command canvas.snapshot --params '{}'

   # Test camera
   openclaw nodes invoke --node "iOS Node" --command camera.capture --params '{"camera":"back"}'
   ```

For more details on pairing and gateway setup, see [iOS app usage guide](/platforms/ios).

## Version Updates

Version information is in `apps/ios/project.yml`:

```yaml
# Line 84-85 (main app)
CFBundleShortVersionString: "2026.1.27-beta.1"
CFBundleVersion: "20260126"

# Line 133-134 (test bundle)
CFBundleShortVersionString: "2026.1.27-beta.1"
CFBundleVersion: "20260126"
```

After updating versions, regenerate the project:
```bash
cd apps/ios
xcodegen generate
```

## Troubleshooting Build Issues

### Clean Build

If experiencing strange build issues:

```bash
# In Xcode
Cmd+Shift+K (Clean Build Folder)

# Or via command line
xcodebuild clean \
  -project apps/ios/OpenClaw.xcodeproj \
  -scheme OpenClaw
```

### Reset Simulators

If simulator is misbehaving:

```bash
# List devices
xcrun simctl list devices

# Erase specific device
xcrun simctl erase <DEVICE_UDID>

# Erase all unavailable devices
xcrun simctl delete unavailable
```

### Check Swift Version

```bash
swift --version
# Should show Swift 6.0 or later

xcrun swift --version
# Should match Xcode's Swift version
```

### Verify Xcode Selection

```bash
xcode-select -p
# Should point to Xcode 16+

sudo xcode-select --switch /Applications/Xcode.app
```

## Related Documentation

- [iOS app usage guide](/platforms/ios) - Running the app, pairing, features
- [FastLane setup](/fastlane/SETUP.md) - TestFlight uploads (in apps/ios/fastlane/)
- [iOS README](/apps/ios/README.md) - Quick reference
- [Gateway pairing](/gateway/pairing) - Node pairing process
- [Gateway discovery](/gateway/discovery) - Bonjour and DNS-SD
- [Blink Shell](/platforms/blink-shell) - CLI access from iOS via SSH

## Next Steps

1. ✅ Install prerequisites (Xcode, tools)
2. ✅ Generate Xcode project
3. ✅ Build and run in simulator
4. ✅ Run tests to verify setup
5. Configure code signing for device testing
6. Test pairing with a gateway
7. Set up fastlane for TestFlight (optional)
8. Enable CI when ready for automated testing

## Getting Help

If you encounter issues not covered here:

1. Check the [iOS troubleshooting guide](/platforms/ios)
2. Review Xcode build logs for specific errors
3. Verify all prerequisites are installed
4. Ensure submodules are initialized
5. Try a clean build

For gateway-related issues, see [gateway troubleshooting](/gateway/troubleshooting).
