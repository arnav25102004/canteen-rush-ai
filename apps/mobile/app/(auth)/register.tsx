import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';

export default function RegisterScreen() {
  const { register, institution } = useAuthStore();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!name || !email || !password) { Alert.alert('Fill in all fields'); return; }
    if (password.length < 6) { Alert.alert('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await register(name, email, password);
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
      <Text style={styles.logo}>Campus Khana</Text>
      <Text style={styles.subtitle}>Create your account</Text>
      <Text style={styles.hint}>
        {institution ? `Use your @${institution.emailDomain} email` : 'Use your university email'}
      </Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input} placeholder="Full Name" value={name}
          onChangeText={setName} placeholderTextColor="#aaa"
        />
        <TextInput
          style={styles.input} placeholder="Email" value={email}
          onChangeText={setEmail} keyboardType="email-address"
          autoCapitalize="none" placeholderTextColor="#aaa"
        />
        <TextInput
          style={styles.input} placeholder="Password" value={password}
          onChangeText={setPassword} secureTextEntry placeholderTextColor="#aaa"
        />
        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Register</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => router.back()} style={styles.loginLink}>
        <Text style={styles.loginText}>Already have an account? <Text style={styles.loginBold}>Sign In</Text></Text>
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
  loginLink: { marginTop: 24, alignItems: 'center' },
  loginText: { color: '#ffffff60', fontSize: 14 },
  loginBold: { color: '#e94560', fontWeight: '600' },
});
