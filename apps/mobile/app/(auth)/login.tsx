import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import { useAuthStore } from '../../store/authStore';

export default function LoginScreen() {
  const { login, institution, switchInstitution } = useAuthStore();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) { Alert.alert('Fill in all fields'); return; }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace('/(tabs)/home');
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Something went wrong';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const trimmed = forgotEmail.trim().toLowerCase();
    if (!trimmed) { Alert.alert('Enter your email address'); return; }
    if (!trimmed.includes('@')) { Alert.alert('Invalid Email', 'Please enter a valid email address.'); return; }

    setForgotLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setForgotVisible(false);
      setForgotEmail('');
      Alert.alert(
        'Email Sent',
        `A password reset link has been sent to ${trimmed}. Check your inbox and spam folder.`,
      );
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        Alert.alert('Not Found', 'No account found with that email address.');
      } else if (err.code === 'auth/invalid-email') {
        Alert.alert('Invalid Email', 'Please enter a valid email address.');
      } else if (err.code === 'auth/too-many-requests') {
        Alert.alert('Too Many Requests', 'Too many reset attempts. Please try again in an hour.');
      } else {
        Alert.alert('Error', 'Could not send reset email. Please try again.');
      }
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>Campus Khana</Text>
      {institution ? (
        <>
          <Text style={styles.subtitle}>{institution.name}</Text>
          <Text style={styles.hint}>Use your @{institution.emailDomain} email</Text>
          <TouchableOpacity onPress={switchInstitution} style={styles.switchLink}>
            <Text style={styles.switchText}>Not your institution? Switch →</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.hint}>Use your university email</Text>
      )}

      <View style={styles.form}>
        <TextInput
          style={styles.input} placeholder="Email" value={email}
          onChangeText={setEmail} keyboardType="email-address"
          autoCapitalize="none" placeholderTextColor="#aaa"
        />
        <TextInput
          style={styles.input} placeholder="Password" value={password}
          onChangeText={setPassword} secureTextEntry placeholderTextColor="#aaa"
        />
        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign In</Text>}
        </TouchableOpacity>
      </View>

      {/* Forgot password link */}
      <TouchableOpacity
        onPress={() => { setForgotEmail(email); setForgotVisible(true); }}
        style={styles.forgotLink}
      >
        <Text style={styles.forgotText}>Forgot Password?</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push('/(auth)/register')} style={styles.registerLink}>
        <Text style={styles.registerText}>Don't have an account? <Text style={styles.registerBold}>Register</Text></Text>
      </TouchableOpacity>

      {/* Forgot password modal */}
      <Modal
        visible={forgotVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setForgotVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Reset Password</Text>
            <Text style={styles.modalSubtitle}>
              Enter your college email and we'll send you a reset link.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="your@christuniversity.in"
              placeholderTextColor="#aaa"
              value={forgotEmail}
              onChangeText={setForgotEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            <TouchableOpacity
              style={[styles.modalBtn, forgotLoading && styles.btnDisabled]}
              onPress={handleForgotPassword}
              disabled={forgotLoading}
            >
              {forgotLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.modalBtnText}>Send Reset Link</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setForgotVisible(false)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 36, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 6 },
  subtitle: { color: '#ffffff80', textAlign: 'center', marginBottom: 8, fontSize: 14 },
  hint: { color: '#f59e0b', textAlign: 'center', fontSize: 12, marginBottom: 32 },
  form: { gap: 12 },
  input: { backgroundColor: '#ffffff15', color: '#fff', borderRadius: 12, padding: 16, fontSize: 16 },
  btn: { backgroundColor: '#e94560', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  forgotLink: { marginTop: 16, alignItems: 'center' },
  forgotText: { color: '#F97316', fontSize: 14, textDecorationLine: 'underline' },
  registerLink: { marginTop: 12, alignItems: 'center' },
  registerText: { color: '#ffffff60', fontSize: 14 },
  registerBold: { color: '#e94560', fontWeight: '600' },
  switchLink: { marginTop: 6, alignItems: 'center' },
  switchText: { color: '#ffffff40', fontSize: 11 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: '#00000080', justifyContent: 'center', padding: 24 },
  modalBox: { backgroundColor: '#1e2235', borderRadius: 16, padding: 24 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  modalSubtitle: { color: '#ffffff80', fontSize: 13, marginBottom: 16, lineHeight: 20 },
  modalInput: { backgroundColor: '#ffffff15', color: '#fff', borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 12 },
  modalBtn: { backgroundColor: '#F97316', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 8 },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalCancel: { alignItems: 'center', padding: 8 },
  modalCancelText: { color: '#ffffff60', fontSize: 14 },
});
