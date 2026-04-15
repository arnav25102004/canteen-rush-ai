import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';

type Mode = 'login' | 'register';

export default function LoginScreen() {
  const { login, register } = useAuthStore();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !password || (mode === 'register' && !name)) {
      Alert.alert('Fill in all fields');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        await register(name, email, password);
      } else {
        await login(email, password);
      }
      // Navigate explicitly — don't rely solely on _layout.tsx segment detection
      router.replace('/(tabs)/home');
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.detail || e?.message || 'Something went wrong';
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
      <Text style={styles.logo}>ChristEats</Text>
      <Text style={styles.subtitle}>Christ University Virtual Canteen</Text>
      {mode === 'register' && (
        <Text style={styles.notice}>Only @christuniversity.in emails allowed</Text>
      )}

      <View style={styles.toggle}>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'login' && styles.toggleActive]}
          onPress={() => setMode('login')}
        >
          <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
            Sign In
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'register' && styles.toggleActive]}
          onPress={() => setMode('register')}
        >
          <Text style={[styles.toggleText, mode === 'register' && styles.toggleTextActive]}>
            Register
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.form}>
        {mode === 'register' && (
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            value={name}
            onChangeText={setName}
            placeholderTextColor="#aaa"
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="Email (yourname@christuniversity.in)"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholderTextColor="#aaa"
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min 6 characters)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor="#aaa"
        />
        <TouchableOpacity style={styles.btn} onPress={handleSubmit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 36, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 8 },
  subtitle: { color: '#ffffff80', textAlign: 'center', marginBottom: 32, fontSize: 14 },
  toggle: { flexDirection: 'row', backgroundColor: '#ffffff10', borderRadius: 12, marginBottom: 24, padding: 4 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  toggleActive: { backgroundColor: '#e94560' },
  toggleText: { color: '#ffffff60', fontWeight: '600' },
  toggleTextActive: { color: '#fff' },
  notice: { color: '#f59e0b', textAlign: 'center', fontSize: 12, marginBottom: 16 },
  form: { gap: 12 },
  input: { backgroundColor: '#ffffff15', color: '#fff', borderRadius: 12, padding: 16, fontSize: 16 },
  btn: { backgroundColor: '#e94560', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
