import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, View, type ViewStyle } from 'react-native';

export function SkeletonBlock({ style }: { style?: ViewStyle }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.45, 0.85, 0.45],
  });

  return (
    <Animated.View
      style={[
        {
          backgroundColor: '#f4dbe8',
          borderRadius: 12,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCard({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: '#ffffffcc',
        borderColor: '#f2d7e6',
        borderWidth: 1,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
      }}
    >
      {children}
    </View>
  );
}
