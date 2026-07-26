# WireTrace AI

WireTrace AI is an Expo / React Native app for capturing, analyzing, and reading electrical schematics across iOS, Android, and web.

## Prerequisites

- Node.js 20
- npm

## Install

From the project root:

```bash
npm install --legacy-peer-deps
```

## Run the app locally

```bash
npm run dev
```

Platform-specific commands:

```bash
npm run android
npm run ios
npm run web
```

## Build commands

Validate the project:

```bash
npm run check
```

Create a web build:

```bash
npm run build:web
```

Prepare a native Android project:

```bash
npm run build:android
```

## App configuration

The app uses OpenRouter for AI-powered schematic analysis.

- Do not commit API keys into the repository.
- Open the app and add your OpenRouter API key in **Settings** before using AI analysis features.
- The app stores the key locally on the device with Expo Secure Store.

## EAS build profiles

`eas.json` includes:

- `development` for internal development client builds
- `preview` for internal Android APK builds
- `production` for Android app bundle builds
- `production-apk` for release APK builds

## Continuous integration

GitHub Actions validates the app by:

1. installing dependencies
2. running TypeScript checks
3. running ESLint
4. building the web export
