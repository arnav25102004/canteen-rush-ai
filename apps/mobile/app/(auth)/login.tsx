import { useState } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Modal,
  ScrollView, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { auth } from '../../firebaseConfig';
import { useAuthStore, EmailNotVerifiedError, resendVerificationEmail } from '../../store/authStore';
import { Button } from '../../design-system/components/Button';
import { TextField } from '../../design-system/components/TextField';
import { Switch } from '../../design-system/components/Switch';
import { ExpressiveCheckbox } from '../../design-system/components/Checkbox';
import { ConnectedButtonGroup } from '../../design-system/components/Button/ConnectedButtonGroup';
import { useAppTheme } from '../../design-system/theme/ThemeProvider';
import { TypographyTokens } from '../../design-system/tokens/typography';

/**
 * Production-Ready Material 3 Expressive Auth Suite (Login & Register)
 * 
 * Design Architecture:
 * 1. Hero Anchor: Editorial Display Typography, organic brand badge, and campus domain indicator.
 * 2. Connected Segment Tab Bar: Morphing pill selector between Sign In and Register.
 * 3. Horizontal Shared Axis (X-axis): Outgoing slides -48dp while fading; incoming enters +48dp.
 * 4. Continuous Height Gliding: Animated card height matching exact layout metrics.
 * 5. Full Component Suite: ExpressiveButton, TextField, ExpressiveSwitch, Euclidean Ripple, and LoadingIndicator.
 */
export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { login, register, institution, switchInstitution } = useAuthStore();
  const router = useRouter();

  // Mode: 'login' | 'register'
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  // Exact content height tracking
  const [loginContentHeight, setLoginContentHeight] = useState(380);
  const [registerContentHeight, setRegisterContentHeight] = useState(480);

  // Reanimated UI-thread values
  const transition = useSharedValue(0); // 0 = Login, 1 = Register
  // animatedCardHeight stores total card height (slice content + 40px vertical padding)
  const animatedCardHeight = useSharedValue(420);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [agreedToTerms, setAgreedToTerms] = useState(true);
  const [loading, setLoading] = useState(false);

  // Forgot password modal state
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // --- Horizontal Shared Axis Motion ---
  const handleTabSwitch = (newTab: string) => {
    if (newTab === activeTab) return;

    if (newTab === 'register') {
      setActiveTab('register');
      animatedCardHeight.value = withTiming(registerContentHeight + 40, {
        duration: 360,
        easing: Easing.bezier(0.2, 0.0, 0, 1.0),
      });
      transition.value = withTiming(1, {
        duration: 360,
        easing: Easing.bezier(0.2, 0.0, 0, 1.0),
      });
    } else {
      setActiveTab('login');
      animatedCardHeight.value = withTiming(loginContentHeight + 40, {
        duration: 360,
        easing: Easing.bezier(0.2, 0.0, 0, 1.0),
      });
      transition.value = withTiming(0, {
        duration: 360,
        easing: Easing.bezier(0.2, 0.0, 0, 1.0),
      });
    }
  };

  // Login Slice: Centered at 0; slides left (-48dp) and fades out at 1
  const loginAnimatedStyle = useAnimatedStyle(() => {
    const translateX = -48 * transition.value;
    const opacity = 1 - transition.value;
    return {
      transform: [{ translateX }],
      opacity,
      pointerEvents: transition.value > 0.5 ? 'none' : 'auto',
    };
  });

  // Register Slice: Starts right (+48dp) and faded (0); slides to center (0) and fades in (1)
  const registerAnimatedStyle = useAnimatedStyle(() => {
    const translateX = 48 * (1 - transition.value);
    const opacity = transition.value;
    return {
      transform: [{ translateX }],
      opacity,
      pointerEvents: transition.value < 0.5 ? 'none' : 'auto',
    };
  });

  // Card Height Interpolation
  const cardContainerAnimatedStyle = useAnimatedStyle(() => ({
    height: animatedCardHeight.value,
  }));

  // Auth submission handlers
  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Incomplete Form', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace('/(tabs)/home');
    } catch (e: any) {
      if (e instanceof EmailNotVerifiedError) {
        Alert.alert('Verify your email', e.message, [
          { text: 'OK' },
          { text: 'Resend email', onPress: handleResend },
        ]);
      } else if (e?.code === 'auth/too-many-requests') {
        Alert.alert('Too many attempts', 'Please wait a while before trying again.');
      } else {
        const msg = e?.response?.data?.error || e?.message || 'Something went wrong';
        Alert.alert('Sign In Failed', msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (!name || !email || !password) {
      Alert.alert('Incomplete Form', 'Please fill in all fields to create your account.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters long.');
      return;
    }
    if (!agreedToTerms) {
      Alert.alert('Terms Required', 'Please accept the campus ordering policy.');
      return;
    }
    setLoading(true);
    try {
      await register(name.trim(), email.trim().toLowerCase(), password);
      Alert.alert(
        'Verify your email',
        'We sent a verification link to your university inbox. Open it, then sign in.'
      );
      handleTabSwitch('login');
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Something went wrong';
      Alert.alert('Registration Failed', msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    try {
      const wait = await resendVerificationEmail(email.trim().toLowerCase(), password);
      if (wait > 0) Alert.alert('Please wait', `You can resend in ${wait} seconds.`);
      else Alert.alert('Email sent', 'Check your university inbox.');
    } catch {
      Alert.alert('Could not resend', 'Please try again in a minute.');
    }
  }

  async function handleForgotPassword() {
    const trimmed = forgotEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid university email address.');
      return;
    }
    setForgotLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setForgotVisible(false);
      setForgotEmail('');
      Alert.alert('Email Sent', `Password reset instructions sent to ${trimmed}.`);
    } catch {
      Alert.alert('Error', 'Could not send reset email. Please try again.');
    } finally {
      setForgotLoading(false);
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
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: Math.max(insets.top + 16, 24), paddingBottom: Math.max(insets.bottom + 16, 24) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* HERO EDITORIAL ANCHOR */}
          <View style={styles.heroAnchor}>
            <View style={[styles.heroIconBadge, { backgroundColor: colors.surfaceContainerHighest }]}>
              <MaterialCommunityIcons
                name="silverware-fork-knife"
                size={26}
                color={colors.primary}
              />
            </View>
            <Text style={[styles.heroTitle, { color: colors.onBackground }]}>Campus Khana</Text>
            {institution ? (
              <>
                <Text style={[styles.heroSubtitle, { color: colors.outline }]}>{institution.name}</Text>
                <View style={[styles.pillDomainBadge, { backgroundColor: colors.surfaceContainerLow }]}>
                  <MaterialCommunityIcons name="domain" size={13} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={[styles.pillDomainText, { color: colors.primary }]}>
                    @{institution.emailDomain}
                  </Text>
                </View>
              </>
            ) : (
              <Text style={[styles.heroSubtitle, { color: colors.outline }]}>University Virtual Canteen</Text>
            )}
          </View>

          {/* CONNECTED SEGMENTED CONTROL: SIGN IN <-> REGISTER */}
          <View style={styles.tabSelectorContainer}>
            <ConnectedButtonGroup
              items={[
                { id: 'login', label: 'Sign In' },
                { id: 'register', label: 'Create Account' },
              ]}
              selectedId={activeTab}
              onSelect={handleTabSwitch}
              fullWidth
            />
          </View>

          {/* ANCHORED CARD CONTAINER (Smooth Height Gliding) */}
          <Animated.View
            style={[
              styles.cardContainer,
              {
                backgroundColor: isDark ? colors.surfaceContainerLow : colors.surfaceContainerLowest,
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
              },
              cardContainerAnimatedStyle,
            ]}
          >
            {/* SLICE 1: SIGN IN */}
            <Animated.View
              onLayout={e => {
                const h = e.nativeEvent.layout.height;
                if (h > 0 && Math.abs(h - loginContentHeight) > 2) {
                  setLoginContentHeight(h);
                  if (activeTab === 'login') {
                    animatedCardHeight.value = h + 40;
                  }
                }
              }}
              style={[
                styles.formSlice,
                activeTab === 'login' ? styles.sliceRelative : styles.sliceAbsolute,
                loginAnimatedStyle,
              ]}
            >
              <View style={styles.formFields}>
                <TextField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="your@christuniversity.in"
                  leftIcon="email-outline"
                  returnKeyType="next"
                />

                <TextField
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="••••••••"
                  leftIcon="lock-outline"
                  returnKeyType="done"
                />

                <View style={styles.optionsRow}>
                  <ExpressiveCheckbox
                    checked={rememberMe}
                    onCheckedChange={setRememberMe}
                    label="Stay signed in"
                    accessibilityLabel="Stay signed in checkbox"
                  />

                  <TouchableOpacity
                    onPress={() => { setForgotEmail(email); setForgotVisible(true); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[styles.forgotText, { color: colors.primary }]}>
                      Forgot Password?
                    </Text>
                  </TouchableOpacity>
                </View>

                <Button
                  label="Sign In"
                  variant="filled"
                  icon={
                    <MaterialCommunityIcons
                      name="login-variant"
                      size={20}
                      color={colors.onPrimary}
                    />
                  }
                  fullWidth
                  loading={loading}
                  disabled={loading}
                  onPress={handleLogin}
                  style={{ marginTop: 8 }}
                />
              </View>
            </Animated.View>

            {/* SLICE 2: CREATE ACCOUNT */}
            <Animated.View
              onLayout={e => {
                const h = e.nativeEvent.layout.height;
                if (h > 0 && Math.abs(h - registerContentHeight) > 2) {
                  setRegisterContentHeight(h);
                  if (activeTab === 'register') {
                    animatedCardHeight.value = h + 40;
                  }
                }
              }}
              style={[
                styles.formSlice,
                activeTab === 'register' ? styles.sliceRelative : styles.sliceAbsolute,
                registerAnimatedStyle,
              ]}
            >
              <View style={styles.formFields}>
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

                <View style={{ marginVertical: 4 }}>
                  <ExpressiveCheckbox
                    checked={agreedToTerms}
                    onCheckedChange={setAgreedToTerms}
                    label="I agree to canteen ordering rules & campus slot policies"
                    accessibilityLabel="Agree to campus policies checkbox"
                    labelStyle={{ fontSize: 13, flex: 1 }}
                  />
                </View>

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
            </Animated.View>
          </Animated.View>

          {/* FOOTER: INSTITUTION SWITCHING */}
          {institution ? (
            <TouchableOpacity onPress={switchInstitution} style={styles.switchInstitutionBtn}>
              <Text style={[styles.switchInstitutionText, { color: colors.outline }]}>
                Not ordering at {institution.name}? <Text style={{ color: colors.primary, fontWeight: '600' }}>Change</Text>
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </TouchableWithoutFeedback>

      {/* Forgot Password Modal */}
      <Modal
        visible={forgotVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setForgotVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: isDark ? colors.surfaceContainerHigh : colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.onSurface }]}>Reset Password</Text>
            <Text style={[styles.modalSubtitle, { color: colors.outline }]}>
              Enter your college email and we'll send you a reset link.
            </Text>
            <TextField
              label="College Email"
              placeholder="your@christuniversity.in"
              value={forgotEmail}
              onChangeText={setForgotEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
              style={{ marginBottom: 12 }}
            />
            <Button
              label="Send Reset Link"
              variant="filled"
              size="medium"
              fullWidth
              loading={forgotLoading}
              disabled={forgotLoading}
              onPress={handleForgotPassword}
              style={{ marginBottom: 8 }}
            />
            <Button
              label="Cancel"
              variant="text"
              size="small"
              onPress={() => setForgotVisible(false)}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  themeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroAnchor: {
    alignItems: 'center',
    marginBottom: 20,
  },
  heroIconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: TypographyTokens.headlineMedium.fontSize,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 14,
    marginBottom: 8,
  },
  pillDomainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  pillDomainText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tabSelectorContainer: {
    marginBottom: 16,
  },

  // Anchored Card Container
  cardContainer: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  formSlice: {
    width: '100%',
  },
  sliceRelative: {
    position: 'relative',
  },
  sliceAbsolute: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
  },
  formFields: {
    gap: 12,
  },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 2,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rememberMeText: {
    fontSize: 13,
    fontWeight: '500',
  },
  forgotText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 2,
  },
  termsText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  switchInstitutionBtn: {
    marginTop: 20,
    alignItems: 'center',
  },
  switchInstitutionText: {
    fontSize: 13,
  },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: '#00000080', justifyContent: 'center', padding: 24 },
  modalBox: { borderRadius: 28, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  modalSubtitle: { fontSize: 13, marginBottom: 16, lineHeight: 20 },
});
