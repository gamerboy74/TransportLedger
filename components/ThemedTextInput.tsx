import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { Theme } from '../constants/theme';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  required?: boolean;
  containerStyle?: any;
}

/**
 * Performance-optimized TextInput that uses a local "soft-sync" state 
 * to prevent character skipping during heavy bridge traffic or re-renders.
 */
export const ThemedTextInput = React.memo(({ label, error, required, value, onChangeText, style, containerStyle, ...props }: Props) => {
  // Local state for immediate UI feedback (prevents character skipping)
  const [localValue, setLocalValue] = useState(value || '');
  
  // Sync with prop if it changes externally (e.g. from parent clearing the field)
  useEffect(() => {
    if (value !== undefined && value !== localValue) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChangeText = (text: string) => {
    // Update local state IMMEDIATELY for 60fps typing feel
    setLocalValue(text);
    // Notify parent
    if (onChangeText) {
      onChangeText(text);
    }
  };

  return (
    <View style={[s.container, containerStyle]}>
      {label && (
        <View style={s.labelRow}>
          <Text style={s.label}>{label}{required ? ' *' : ''}</Text>
        </View>
      )}
      <TextInput
        style={[s.input, error && s.inputError, style]}
        value={localValue}
        onChangeText={handleChangeText}
        placeholderTextColor={Theme.colors.light.muted}
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        {...props}
      />
      {error && <Text style={s.errorText}>{error}</Text>}
    </View>
  );
});

const s = StyleSheet.create({
  container: { marginBottom: Theme.spacing.lg },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Theme.spacing.xs },
  label: { 
    color: Theme.colors.light.subtext, 
    fontSize: Theme.typography.sizes.caption, 
    fontWeight: Theme.typography.weights.bold, 
    textTransform: 'uppercase', 
    letterSpacing: 0.6 
  },
  input: {
    backgroundColor: Theme.colors.light.white,
    borderWidth: 1,
    borderColor: Theme.colors.light.border,
    color: Theme.colors.light.text,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    fontSize: Theme.typography.sizes.body,
    height: 48, // Standard touch target height
  },
  inputError: { borderColor: Theme.colors.light.error },
  errorText: { color: Theme.colors.light.error, fontSize: Theme.typography.sizes.caption, marginTop: Theme.spacing.xs },
});
