import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Animated, Easing, Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import OfflineQueueButton from '../../components/OfflineQueueButton';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import { fetchHomeSummary, fetchReportsBootstrap, fetchTransportersSummary } from '../../lib/summaries';
import { fmt, fmtShort, monthKey, monthLabel } from '../../constants/defaults';

export default function HomeScreen() {
  const C = {
    bg: '#fff7fb',
    card: '#ffffffcc',
    cardStrong: '#ffffff',
    border: '#f2d7e6',
    text: '#111111',
    muted: '#6b5c67',
    accent: '#d9468f',
    accentSoft: '#f9a8d4',
  };

  const [month, setMonth] = useState(monthKey());
  const listRef = useRef<ScrollView | null>(null);
  const heroAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const queryClient = useQueryClient();
  const notice = useThemedNotice();

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['homeSummary', month],
    queryFn: () => fetchHomeSummary(month),
    refetchInterval: 120_000,
  });

  const loading = isLoading;
  const earnings = data?.earnings ?? { commissionIncome: 0, dieselProfit: 0, gstCommission: 0, totalEarnings: 0 };
  const counts = data?.counts ?? { owners: 0, vehicles: 0 };
  const totalBalance = data?.totalBalance ?? 0;

  const monthProgress = Math.min(100, Math.max(0, Math.round((new Date().getDate() / 31) * 100)));

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setMonth(next);
  };

  const prefetchLikelyNextScreens = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: ['transportersSummary', month],
      queryFn: () => fetchTransportersSummary(month),
    });
    void queryClient.prefetchQuery({
      queryKey: ['reportsBootstrap'],
      queryFn: fetchReportsBootstrap,
    });
  }, [month, queryClient]);

  useEffect(() => {
    if (error) notice.showError('Error', 'Could not load dashboard. Check your internet connection.');
  }, [error, notice]);

  useFocusEffect(useCallback(() => {
    listRef.current?.scrollTo({ y: 0, animated: false });
    void refetch();
    heroAnim.setValue(0);
    cardAnim.setValue(0);
    progressAnim.setValue(0);
    Animated.parallel([
      Animated.timing(heroAnim, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardAnim, { toValue: 1, duration: 420, delay: 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(progressAnim, { toValue: 1, duration: 800, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  }, [refetch, heroAnim, cardAnim, progressAnim]));

  useEffect(() => {
    if (!loading) prefetchLikelyNextScreens();
  }, [loading, prefetchLikelyNextScreens]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ position: 'absolute', top: 24, left: -42, width: 170, height: 170, borderRadius: 85, backgroundColor: '#f9a8d433' }} />
      <View style={{ position: 'absolute', top: 180, right: -64, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe844' }} />

      <ScrollView ref={listRef} refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => { void refetch(); }} tintColor={C.accent} />}>
        <View style={{ paddingHorizontal: 16, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16 }}>👨🏽</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <OfflineQueueButton />
            <Pressable onPress={() => router.push('/(tabs)/entry')} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
              <Ionicons name="add" size={18} color="#111111" />
            </Pressable>
            <Pressable onPress={() => router.push('/(tabs)/reports')} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#111111" />
            </Pressable>
          </View>
        </View>

        <Animated.View style={{ paddingHorizontal: 16, paddingTop: 2, marginBottom: 8, opacity: heroAnim, transform: [{ translateY: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '600' }}>My Income</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Pressable
              onPress={() => shiftMonth(-1)}
              style={({ pressed }) => ({ width: 26, height: 26, borderRadius: 13, backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}
            >
              <Ionicons name="chevron-back" size={14} color="#111111" />
            </Pressable>
            <Text style={{ color: '#8d8289', fontSize: 11, marginHorizontal: 10 }}>{monthLabel(month)}</Text>
            <Pressable
              onPress={() => shiftMonth(1)}
              style={({ pressed }) => ({ width: 26, height: 26, borderRadius: 13, backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}
            >
              <Ionicons name="chevron-forward" size={14} color="#111111" />
            </Pressable>
          </View>
        </Animated.View>

        {loading ? (
          <View style={{ marginHorizontal: 16 }}>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 10, width: 80, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 40, width: 170, marginBottom: 14 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <SkeletonBlock style={{ height: 52, flex: 1 }} />
                <SkeletonBlock style={{ height: 52, flex: 1 }} />
                <SkeletonBlock style={{ height: 52, flex: 1 }} />
              </View>
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 14, width: 150, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 8, borderRadius: 99, marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <SkeletonBlock style={{ height: 16, width: 44 }} />
                <SkeletonBlock style={{ height: 16, width: 38 }} />
                <SkeletonBlock style={{ height: 16, width: 44 }} />
              </View>
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 16, width: 180, marginBottom: 12 }} />
              <SkeletonBlock style={{ height: 56, borderRadius: 12, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 56, borderRadius: 12, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 56, borderRadius: 12 }} />
            </SkeletonCard>
          </View>
        ) : (
        <>
        <Animated.View style={{ marginHorizontal: 16, backgroundColor: C.cardStrong, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.border, opacity: cardAnim, transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
          <Text style={{ color: '#8d8289', fontSize: 11 }}>Total Income</Text>
          <Text style={{ color: C.text, fontSize: 41, fontWeight: '500', marginTop: 2 }}>
            {fmtShort(earnings.totalEarnings)}
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
          {[
            { label: 'Commission', emoji: '💰', value: earnings.commissionIncome },
            { label: 'Diesel', emoji: '⛽', value: earnings.dieselProfit },
            { label: 'GST', emoji: '📋', value: earnings.gstCommission },
          ].map(c => (
            <View key={c.label} style={{ flex: 1, backgroundColor: '#fff7fb', borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 10 }}>
              <Text style={{ fontSize: 12.5 }}>{c.label}</Text>
              <Text style={{ color: C.text, fontSize: 14.5, fontWeight: '700', marginTop: 3 }}>
                {fmtShort(c.value)}
              </Text>
            </View>
          ))}
        </View>
        </Animated.View>

        <Animated.View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: C.cardStrong, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, opacity: cardAnim, transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="cash-outline" size={16} color="#d9468f" />
              <Text style={{ color: C.text, marginLeft: 8, fontWeight: '700' }}>{fmt(earnings.totalEarnings)}</Text>
            </View>
            <Ionicons name="arrow-up-outline" size={14} color="#111111" />
          </View>
          <Text style={{ color: '#8d8289', fontSize: 12, marginTop: 2 }}>For this month</Text>
          <View style={{ height: 8, borderRadius: 99, backgroundColor: '#f4ecef', marginTop: 12, overflow: 'hidden' }}>
            <Animated.View style={{ width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${monthProgress}%`] }), height: 8, borderRadius: 99, backgroundColor: '#e879b5' }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={{ color: '#8d8289', fontSize: 11 }}>Day 1</Text>
            <Text style={{ color: '#111111', fontSize: 11, fontWeight: '700' }}>{monthProgress}%</Text>
            <Text style={{ color: '#8d8289', fontSize: 11 }}>Day 31</Text>
          </View>
        </Animated.View>

        <Animated.View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: C.cardStrong, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 14, opacity: cardAnim, transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }] }}>
          <Text style={{ color: '#111111', fontSize: 18, fontWeight: '700' }}>Budget Per Categories</Text>
          <Text style={{ color: '#8d8289', fontSize: 12, marginTop: 2 }}>This month total spend</Text>
          {[
            { icon: 'car-outline' as const, title: 'Quick Entry', sub: 'Daily diesel and trip entries', route: '/(tabs)/entry', value: `${counts.vehicles} vehicles` },
            { icon: 'people-outline' as const, title: 'Transport Owners', sub: 'Owner profiles and balances', route: '/(tabs)/transporters', value: `${counts.owners} owners` },
            { icon: 'document-text-outline' as const, title: 'Reports & Routes', sub: 'Export files and route rates', route: '/(tabs)/reports', value: fmtShort(Math.abs(totalBalance)) },
          ].map(a => (
            <Pressable key={a.title} onPress={() => router.push(a.route as any)}
              style={({ pressed }) => ({ backgroundColor: '#fffdfd', borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', marginTop: 10, transform: [{ scale: pressed ? 0.985 : 1 }] })}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#fde7f1', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                <Ionicons name={a.icon} size={16} color="#111111" />
              </View>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: C.text, fontWeight: '700' }} numberOfLines={1}>{a.title}</Text>
                <Text style={{ color: '#8d8289', fontSize: 11, marginTop: 1 }} numberOfLines={1}>{a.sub}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ backgroundColor: '#fff0f7', borderWidth: 1, borderColor: '#f2d7e6', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#111111', fontWeight: '700', fontSize: 11 }}>{a.value}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={14} color="#8d8289" style={{ marginLeft: 6 }} />
            </Pressable>
          ))}
        </Animated.View>
        </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
