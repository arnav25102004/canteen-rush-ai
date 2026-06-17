import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';

export default function LoginScreen() {
  const { login, institution, switchInstitution } = useAuthStore();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) { Alert.alert('Fill in all fields'); return; }
    setLoading(true);
    try {
      await login(email, password);
      router.replace('/(tabs)/home');
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Something went wrong';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>CanteenRush</Text>
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

      <TouchableOpacity onPress={() => router.push('/(auth)/register')} style={styles.registerLink}>
        <Text style={styles.registerText}>Don't have an account? <Text style={styles.registerBold}>Register</Text></Text>
      </TouchableOpacity>
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
  registerLink: { marginTop: 24, alignItems: 'center' },
  registerText: { color: '#ffffff60', fontSize: 14 },
  registerBold: { color: '#e94560', fontWeight: '600' },
  switchLink: { marginTop: 6, alignItems: 'center' },
  switchText: { color: '#ffffff40', fontSize: 11 },
});
