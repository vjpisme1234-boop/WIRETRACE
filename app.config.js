module.exports = {
  expo: {
    name: "WireTrace AI",
    slug: "wiretrace-ai",
    owner: "vjpisme",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/images/home-background-gears.png",
      resizeMode: "contain",
      backgroundColor: "#0A0A0F",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.vjpisme-wiretrace",
      infoPlist: {
        NSCameraUsageDescription:
          "WireTrace AI needs camera access to photograph wire schematics for analysis.",
        NSPhotoLibraryUsageDescription:
          "WireTrace AI needs photo library access to import wire schematic images for analysis.",
        NSSpeechRecognitionUsageDescription:
          "Allow $(PRODUCT_NAME) to use speech recognition.",
        NSMicrophoneUsageDescription:
          "Allow $(PRODUCT_NAME) to use the microphone.",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon.png",
        backgroundColor: "#FFFFFF",
      },
      package: "com.vjpisme_wiretrace",
      versionCode: 9,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.RECORD_AUDIO",
      ],
    },
    web: {
      favicon: "./assets/images/icon.png",
      bundler: "metro",
    },
    plugins: [
      "expo-font",
      "expo-router",
      "expo-web-browser",
      "expo-secure-store",
      "expo-camera",
      "expo-speech-recognition",
      [
        "expo-image-picker",
        {
          photosPermission:
            "WireTrace AI needs photo library access to import wire schematic images for analysis.",
          cameraPermission:
            "WireTrace AI needs camera access to photograph wire schematics for analysis.",
        },
      ],
      "@react-native-community/datetimepicker",
    ],
    scheme: "wiretraceai",
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "227c64f5-68a5-46e2-ab10-60823a4a8bae",
      },
    },
  },
};
