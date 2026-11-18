import React, { useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { TextInput as PaperTextInput } from 'react-native-paper';
import { AppTextFieldProps } from './TextField.types';
import { useAppTheme } from '../../theme/ThemeProvider';

export const TextField = React.memo(function TextField({
  label,
  value,
  onChangeText,
  variant = 'outlined',
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
  const { colors, isDark } = useAppTheme();
  const [isSecureVisible, setIsSecureVisible] = useState(!secureTextEntry);
  const hasError = Boolean(error);
  const errorMessage = typeof error === 'string' ? error : undefined;

  const renderRight = () => {
    if (secureTextEntry !== undefined) {
      return (
        <PaperTextInput.Icon
          icon={isSecureVisible ? 'eye-off' : 'eye'}
          onPress={() => setIsSecureVisible(prev => !prev)}
          color={hasError ? colors.error : colors.outline}
        />
      );
    }
    if (typeof rightIcon === 'string') {
      return (
        <PaperTextInput.Icon
          icon={rightIcon}
          onPress={onRightIconPress}
          color={hasError ? colors.error : colors.outline}
        />
      );
    }
    return null;
  };

  const renderLeft = () => {
    if (typeof leftIcon === 'string') {
      return (
        <PaperTextInput.Icon
          icon={leftIcon}
          color={hasError ? colors.error : colors.outline}
        />
      );
    }
    return null;
  };

  return (
    <View style={[styles.container, style]}>
      <PaperTextInput
        mode={variant === 'filled' ? 'flat' : 'outlined'}
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        error={hasError}
        secureTextEntry={secureTextEntry !== undefined ? !isSecureVisible : false}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        returnKeyType={returnKeyType}
        autoFocus={autoFocus}
        disabled={disabled}
        left={renderLeft()}
        right={renderRight()}
        onBlur={onBlur}
        onFocus={onFocus}
        outlineColor={colors.outlineVariant}
        activeOutlineColor={colors.primary}
        textColor={colors.onSurface}
        placeholderTextColor={colors.outline}
        style={[
          styles.input,
          {
            backgroundColor: 'transparent',
            borderRadius: 16,
          },
          inputStyle,
        ]}
        outlineStyle={{
          borderRadius: 16,
          backgroundColor: isDark
            ? 'rgba(255, 255, 255, 0.06)'
            : 'rgba(0, 0, 0, 0.02)',
        }}
      />
      {(errorMessage || helperText) ? (
        <Text
          style={[
            styles.helperText,
            { color: hasError ? colors.error : colors.outline },
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
  input: {
    fontSize: 16,
  },
  helperText: {
    fontSize: 12,
    marginTop: 4,
    marginHorizontal: 12,
    letterSpacing: 0.2,
  },
});
