import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, View, StyleSheet, type ViewStyle } from 'react-native';
import { Theme } from '../constants/theme';

export function SkeletonBlock({ style }: { style?: ViewStyle }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
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
        styles.skeletonBlock,
        { opacity },
        style,
      ]}
    />
  );
}

export function SkeletonCard({ children }: { children: ReactNode }) {
  return (
    <View style={styles.skeletonCard}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonBlock: {
    backgroundColor: Theme.colors.light.disabled,
    borderRadius: Theme.borderRadius.md,
  },
  skeletonCard: {
    backgroundColor: Theme.colors.light.background,
    borderColor: Theme.colors.light.border,
    borderWidth: 1,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
});
