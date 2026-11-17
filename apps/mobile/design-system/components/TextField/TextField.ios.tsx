import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { AppTextFieldProps } from './TextField.types';
import { useAppTheme } from '../../theme/ThemeProvider';

export const TextField = React.memo(function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  helperText,
  error,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'none',
  returnKeyType,
  autoFocus = false,
  disabled = false,
  leftIcon,
  rightIcon,
  onRightIconPress,
  onBlur,
  onFocus,
  style,
  inputStyle,
}: AppTextFieldProps) {
  const { cupertinoColors, isDark } = useAppTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [isSecureVisible, setIsSecureVisible] = useState(!secureTextEntry);
  const hasError = Boolean(error);
  const errorMessage = typeof error === 'string' ? error : undefined;

  return (
    <View style={[styles.container, style]}>
      {label ? (
        <Text style={[styles.label, { color: cupertinoColors.label }]}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: isDark
              ? 'rgba(255, 255, 255, 0.08)'
              : cupertinoColors.secondarySystemBackground,
            borderColor: hasError
              ? cupertinoColors.systemRed
              : isFocused
              ? cupertinoColors.primary
              : isDark
              ? 'rgba(255, 255, 255, 0.12)'
              : cupertinoColors.separator,
          },
          disabled && styles.inputDisabled,
        ]}
      >
        {leftIcon && typeof leftIcon !== 'string' ? (
          <View style={styles.iconSlot}>{leftIcon}</View>
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder || label}
          placeholderTextColor={
            isDark ? 'rgba(255, 255, 255, 0.4)' : cupertinoColors.secondaryLabel
          }
          secureTextEntry={secureTextEntry !== undefined ? !isSecureVisible : false}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          returnKeyType={returnKeyType}
          autoFocus={autoFocus}
          editable={!disabled}
          onFocus={e => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={e => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: cupertinoColors.label }, inputStyle]}
        />

        {secureTextEntry !== undefined ? (
          <TouchableOpacity
            onPress={() => setIsSecureVisible(prev => !prev)}
            style={styles.iconSlot}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.toggleText, { color: cupertinoColors.primary }]}>
              {isSecureVisible ? 'Hide' : 'Show'}
            </Text>
          </TouchableOpacity>
        ) : rightIcon ? (
          <TouchableOpacity
            onPress={onRightIconPress}
            style={styles.iconSlot}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {typeof rightIcon !== 'string' ? rightIcon : null}
          </TouchableOpacity>
        ) : null}
      </View>

      {(errorMessage || helperText) ? (
        <Text
          style={[
            styles.helperText,
            { color: hasError ? cupertinoColors.systemRed : cupertinoColors.systemGray },
          ]}
        >
          {errorMessage || helperText}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    height: 52,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  iconSlot: {
    paddingLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 12,
    marginTop: 4,
    marginHorizontal: 8,
  },
});
