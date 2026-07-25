# WireTrace AI

This app was built using [Newly.app](https://newly.app) - a platform for creating mobile apps.

Made with 💙 for creativity.

## Premium features

WireTrace AI now supports a free tier and a premium tier:
- Free: up to 3 schematic scans
- Premium: unlimited scans, premium AI model, and expanded voice options

## RevenueCat setup

Set these environment variables for EAS/Expo builds:
- `EXPO_PUBLIC_RC_IOS_API_KEY`
- `EXPO_PUBLIC_RC_ANDROID_API_KEY`
- `EXPO_PUBLIC_RC_ENTITLEMENT_ID` (defaults to `pro`)

Store product identifiers expected by the app:
- `wiretrace_pro_monthly`
- `wiretrace_pro_yearly`

## OpenRouter API key

No API key is hardcoded in source anymore.
Users can add their own key in Settings, or provide a build-time fallback via:
- `EXPO_PUBLIC_OPENROUTER_API_KEY`
