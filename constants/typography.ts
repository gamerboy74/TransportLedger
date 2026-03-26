import { Platform } from 'react-native';

export const Typography = {
  sizes: {
    tiny: 10,
    caption: 12,
    body: 14,
    subheading: 16,
    heading3: 18,
    heading2: 20,
    heading1: 24,
    title: 28,
    display: 32,
  },
  lineHeights: {
    tiny: 14,
    caption: 16,
    body: 20,
    subheading: 24,
    heading3: 26,
    heading2: 28,
    heading1: 32,
    title: 36,
    display: 40,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  fonts: Platform.select({
    ios: {
      regular: 'System',
      medium: 'System',
      bold: 'System',
    },
    android: {
      regular: 'Roboto',
      medium: 'Roboto-Medium',
      bold: 'Roboto-Bold',
    },
    default: {
      regular: 'sans-serif',
      medium: 'sans-serif-medium',
      bold: 'sans-serif',
    },
  }),
};
