import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import api from '../services/api';
import { useAuthStore, Institution } from '../store/authStore';
import { useAppTheme } from '../design-system/theme/ThemeProvider';
import { Switch } from '../design-system/components/Switch';
import { LoadingIndicator } from '../design-system/components/LoadingIndicator';
import { TypographyTokens } from '../design-system/tokens/typography';

export default function SelectInstitutionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setInstitution } = useAuthStore();
  const { colors, isDark, setMode } = useAppTheme();

  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/institutions')
      .then(r => setInstitutions(r.data.institutions || []))
      .catch(() => setError('Could not load institutions. Please check your internet connection.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSelect(inst: Institution) {
    await setInstitution(inst);
    router.replace('/(auth)/login');
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: Math.max(insets.top + 8, 16),
          paddingBottom: Math.max(insets.bottom + 12, 16),
        },
      ]}
    >
      {/* Hero Header Block */}
      <View style={styles.header}>
        <View style={[styles.heroIconCircle, { backgroundColor: colors.surfaceContainerHighest }]}>
          <MaterialCommunityIcons name="domain" size={28} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.onBackground }]}>Select Institution</Text>
        <Text style={[styles.subtitle, { color: colors.outline }]}>
          Choose your university campus to view live canteen menus & ordering slots
        </Text>
      </View>

      {/* Loading state with M3 Expressive Morphing Indicator */}
      {loading && (
        <View style={styles.loadingContainer}>
          <LoadingIndicator size={42} color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.outline }]}>
            Fetching campuses...
          </Text>
        </View>
      )}

      {/* Error state */}
      {!!error && (
        <View style={[styles.errorCard, { backgroundColor: colors.surfaceContainerHigh }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={24} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      )}

      {/* Institution List */}
      <FlatList
        data={institutions}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.card,
              {
                backgroundColor: isDark ? colors.surfaceContainerLow : colors.surfaceContainerLowest,
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
              },
            ]}
            onPress={() => handleSelect(item)}
            activeOpacity={0.75}
          >
            <View style={styles.cardInner}>
              <View style={[styles.avatar, { backgroundColor: colors.primaryContainer }]}>
                <Text style={[styles.avatarText, { color: colors.onPrimaryContainer }]}>
                  {item.name.charAt(0)}
                </Text>
              </View>

              <View style={styles.cardText}>
                <Text style={[styles.instName, { color: colors.onSurface }]}>{item.name}</Text>
                <View style={styles.metaRow}>
                  <MaterialCommunityIcons name="map-marker-outline" size={13} color={colors.outline} />
                  <Text style={[styles.instMeta, { color: colors.outline }]}>{item.city}</Text>
                  <Text style={[styles.metaDot, { color: colors.outline }]}>•</Text>
                  <Text style={[styles.domainText, { color: colors.primary }]}>@{item.emailDomain}</Text>
                </View>
              </View>

              <View style={[styles.chevronSlot, { backgroundColor: colors.surfaceContainerHigh }]}>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={[styles.empty, { color: colors.outline }]}>No campuses registered yet.</Text>
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
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
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  heroIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: TypographyTokens.headlineSmall.fontSize,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  cardText: {
    flex: 1,
    marginLeft: 14,
  },
  instName: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  instMeta: {
    fontSize: 12,
  },
  metaDot: {
    fontSize: 10,
    marginHorizontal: 2,
  },
  domainText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chevronSlot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '500',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    borderRadius: 16,
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
});
