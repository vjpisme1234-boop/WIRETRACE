import "react-native-reanimated";
import React, { useEffect } from "react";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SystemBars } from "react-native-edge-to-edge";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme, Alert } from "react-native";
import { useNetworkState } from "expo-network";
import {
  DarkTheme,
  DefaultTheme,
  Theme,
  ThemeProvider,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { WidgetProvider } from "@/contexts/WidgetContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
// Note: Error logging is auto-initialized via index.ts import

// Dev builds show the full technical trace; production shows a plain,
// non-technical message with a reload action instead of hard-crashing.
function DevErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary mode={__DEV__ ? "debug" : "friendly"}>{children}</ErrorBoundary>;
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: "(tabs)", // Ensure any route can link back to `/`
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const networkState = useNetworkState();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  React.useEffect(() => {
    if (
      !networkState.isConnected &&
      networkState.isInternetReachable === false
    ) {
      Alert.alert(
        "🔌 You are offline",
        "You can keep using the app! Your changes will be saved locally and synced when you are back online."
      );
    }
  }, [networkState.isConnected, networkState.isInternetReachable]);

  const CustomDefaultTheme: Theme = {
    ...DefaultTheme,
    dark: false,
    colors: {
      primary: "rgb(0, 122, 255)", // System Blue
      background: "rgb(242, 242, 247)", // Light mode background
      card: "rgb(255, 255, 255)", // White cards/surfaces
      text: "rgb(0, 0, 0)", // Black text for light mode
      border: "rgb(216, 216, 220)", // Light gray for separators/borders
      notification: "rgb(255, 59, 48)", // System Red
    },
  };

  const CustomDarkTheme: Theme = {
    ...DarkTheme,
    colors: {
      primary: "rgb(10, 132, 255)", // System Blue (Dark Mode)
      background: "rgb(1, 1, 1)", // True black background for OLED displays
      card: "rgb(28, 28, 30)", // Dark card/surface color
      text: "rgb(255, 255, 255)", // White text for dark mode
      border: "rgb(44, 44, 46)", // Dark gray for separators/borders
      notification: "rgb(255, 69, 58)", // System Red (Dark Mode)
    },
  };
  return (
    <DevErrorBoundary>
      <StatusBar style="auto" animated />
        <ThemeProvider
          value={colorScheme === "dark" ? CustomDarkTheme : CustomDefaultTheme}
        >
          <SafeAreaProvider>
            <WidgetProvider>
              <GestureHandlerRootView>
              <Stack>
                {/* Main app with tabs */}
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                {/* WireTrace AI screens */}
                <Stack.Screen
                  name="camera"
                  options={{ headerShown: false, presentation: 'fullScreenModal' }}
                />
                <Stack.Screen
                  name="analyze"
                  options={{
                    headerShown: false,
                    title: 'Analyze Schematic',
                    headerStyle: { backgroundColor: '#0A0A0F' },
                    headerTintColor: '#00B4FF',
                  }}
                />
                <Stack.Screen
                  name="reader"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="identify-symbol"
                  options={{
                    presentation: 'formSheet',
                    headerShown: false,
                    sheetGrabberVisible: true,
                    sheetAllowedDetents: [0.6, 1.0],
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                    title: 'Settings',
                    headerStyle: { backgroundColor: '#0A0A0F' },
                    headerTintColor: '#FFFFFF',
                  }}
                />
                <Stack.Screen
                  name="symbol-dictionary"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                  }}
                />
                <Stack.Screen
                  name="standards"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                  }}
                />
                <Stack.Screen
                  name="schematic-view"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                  }}
                />
                <Stack.Screen
                  name="custom-reading-order"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                  }}
                />
              </Stack>
              <SystemBars style={"auto"} />
              </GestureHandlerRootView>
            </WidgetProvider>
          </SafeAreaProvider>
        </ThemeProvider>
    </DevErrorBoundary>
  );
}
