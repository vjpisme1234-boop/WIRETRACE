import { SymbolView, SymbolViewProps, SymbolWeight } from "expo-symbols";
import { Pressable, StyleProp, ViewStyle } from "react-native";

export function IconSymbol({
  ios_icon_name,
  size = 24,
  color,
  style,
  weight = "regular",
  onPress,
  testID,
  accessibilityLabel,
}: {
  ios_icon_name: SymbolViewProps["name"];
  android_material_icon_name: any;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
  onPress?: any;
  testID?: any;
  accessibilityLabel?: any;
}) {
  const symbol = (
    <SymbolView
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      weight={weight}
      tintColor={color}
      resizeMode="scaleAspectFit"
      name={ios_icon_name}
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
    />
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{symbol}</Pressable>;
  }

  return symbol;
}
