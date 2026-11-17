import { useState } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
  ScrollView, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../../design-system/components/Button';
import { TextField } from '../../design-system/components/TextField';
import { Switch } from '../../design-system/components/Switch';
import { useAppTheme } from '../../design-system/theme/ThemeProvider';
import { TypographyTokens } from '../../design-system/tokens/typography';

export default function RegisterScreen() {
  const { colors, isDark, setMode } = useAppTheme();
  const { register, institution } = useAuthStore();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Terms agreement toggle with M3 Switch
  const [agreedToTerms, setAgreedToTerms] = useState(true);

  async function handleRegister() {
    if (!name || !email || !password) {
      Alert.alert('Incomplete Form', 'Please fill in all fields to continue.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters long.');
      return;
    }
    if (!agreedToTerms) {
      Alert.alert('Terms Required', 'Please accept the campus food policy to proceed.');
      return;
    }

    setLoading(true);
    try {
      await register(name.trim(), email.trim().toLowerCase(), password);
      Alert.alert(
        'Verify your email',
        'We sent a verification link to your university inbox. Open it, then sign in.'
      );
      router.replace('/(auth)/login');
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Something went wrong';
      Alert.alert('Registration Failed', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Top Bar with Navigation & Theme Toggle */}
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.backButton, { backgroundColor: colors.surfaceContainerHigh }]}
              accessibilityRole="button"
              accessibilityLabel="Go back to login"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons
                name="arrow-left"
                size={20}
                color={colors.onSurface}
              />
            </TouchableOpacity>

            <View style={styles.themeToggleRow}>
              <MaterialCommunityIcons
                name={isDark ? 'weather-night' : 'weather-sunny'}
                size={18}
                color={isDark ? '#FFB68B' : colors.primary}
              />
              <Switch
                value={isDark}
                onValueChange={val => setMode(val ? 'dark' : 'light')}
                accessibilityLabel="Toggle Dark/Light Mode"
              />
            </View>
          </View>

          {/* Header Block */}
          <View style={styles.headerBlock}>
            <Text style={[styles.logo, { color: colors.onBackground }]}>Campus Khana</Text>
            <Text style={[styles.subtitle, { color: colors.outline }]}>Create your student account</Text>
            <Text style={[styles.hint, { color: colors.primary }]}>
              {institution ? `Use your @${institution.emailDomain} email` : 'Use your university email'}
            </Text>
          </View>

          {/* Registration Form */}
          <View style={styles.form}>
            <TextField
              label="Full Name"
              value={name}
              onChangeText={setName}
              placeholder="Darshan Patel"
              leftIcon="account-outline"
              returnKeyType="next"
            />

            <TextField
              label="University Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="your@christuniversity.in"
              leftIcon="email-outline"
              returnKeyType="next"
            />

            <TextField
              label="Password (min 6 characters)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              leftIcon="lock-outline"
              returnKeyType="done"
            />

            {/* Terms & Conditions with M3 Switch */}
            <TouchableOpacity
              onPress={() => setAgreedToTerms(prev => !prev)}
              style={styles.termsRow}
              activeOpacity={0.8}
            >
              <Switch
                value={agreedToTerms}
                onValueChange={setAgreedToTerms}
                accessibilityLabel="Agree to campus policies switch"
              />
              <Text style={[styles.termsText, { color: colors.onSurfaceVariant }]}>
                I agree to the university canteen terms & ordering guidelines
              </Text>
            </TouchableOpacity>

            {/* Primary Register Action Button */}
            <Button
              label="Create Account"
              variant="filled"
              icon={
                <MaterialCommunityIcons
                  name="account-plus-outline"
                  size={20}
                  color={colors.onPrimary}
                />
              }
              fullWidth
              loading={loading}
              disabled={loading}
              onPress={handleRegister}
              style={{ marginTop: 8 }}
            />
          </View>

          {/* Footer Navigation */}
          <View style={styles.footerBlock}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.loginLink}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.loginText, { color: colors.outline }]}>
                Already have an account? <Text style={{ color: colors.primary, fontWeight: '700' }}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBlock: {
    marginBottom: 24,
  },
  logo: {
    fontSize: 34,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 6,
    fontSize: 15,
  },
  hint: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  form: {
    gap: 12,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  termsText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  footerBlock: {
    marginTop: 18,
  },
  loginLink: {
    alignItems: 'center',
  },
  loginText: {
    fontSize: 14,
  },
});
