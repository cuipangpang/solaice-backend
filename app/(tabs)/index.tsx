import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useState } from "react";
import { petService, type PetProfile } from "@/services/petService";
import { healthRecordService, type HealthStats } from "@/services/healthRecordService";
import { localCache } from "@/utils/storage";

// ────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();

  const [petData, setPetData] = useState<PetProfile | null>(null);
  const [healthStats, setHealthStats] = useState<HealthStats | null>(null);
  const [loading, setLoading] = useState(true);

  // ── 화면 포커스마다 데이터 로드 ─────────────────────────
  useFocusEffect(
    useCallback(() => {
      let active = true;

      const load = async () => {
        setLoading(true);
        try {
          const petId = await localCache.getPetId();
          if (!petId) {
            if (active) { setPetData(null); setHealthStats(null); }
            return;
          }
          const [pet, stats] = await Promise.all([
            petService.getPet(petId),
            healthRecordService.getHealthStats(petId),
          ]);
          if (active) { setPetData(pet); setHealthStats(stats); }
        } catch (e) {
          console.error("[HomeScreen] 데이터 로드 실패:", e);
          if (active) { setPetData(null); setHealthStats(null); }
        } finally {
          if (active) setLoading(false);
        }
      };

      load();
      return () => { active = false; };
    }, [])
  );

  // ── 기존 로그아웃/설정 로직 ─────────────────────────────
  async function handleLogout() {
    // AsyncStorage.clear() 대신 로그인 관련 key만 제거
    // 'cached_pet_id' 는 삭제하지 않아 반려동물 데이터 유지
    await AsyncStorage.multiRemove([
      'guest_mode',
      'user_id',
      'user_mode',
      'auth_token',
      'user_token',
    ]);
    router.replace("/login");
  }

  function handleSettingsPress() {
    Alert.alert("설정", null as any, [
      { text: "로그아웃", onPress: handleLogout, style: "destructive" },
      { text: "취소", style: "cancel" },
    ]);
  }

  // ── 날짜 포맷 헬퍼 ───────────────────────────────────────
  function formatLastCheck(dateStr?: string): string {
    if (!dateStr) return "검사 기록 없음";
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "오늘";
      if (diffDays === 1) return "어제";
      if (diffDays < 7) return `${diffDays}일 전`;
      return `${d.getMonth() + 1}월 ${d.getDate()}일`;
    } catch {
      return "검사 기록 없음";
    }
  }

  const greetingName = petData?.name ?? "";
  const lastCheckLabel = healthStats?.last_check_at
    ? formatLastCheck(healthStats.last_check_at)
    : "검사 기록 없음";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ── 顶部问候区 ──────────────────────────────────── */}
        <View style={styles.greetingWrap}>
          <View style={styles.greetingRow}>
            <View style={styles.greetingTexts}>
              {loading ? (
                <ActivityIndicator size="small" color="#BDE0FE" style={{ marginVertical: 6 }} />
              ) : petData ? (
                <>
                  <Text style={styles.greetingTitle}>안녕, {greetingName} 오늘은 어때?</Text>
                  <Text style={styles.greetingSub}>마지막 검사: {lastCheckLabel}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.greetingTitle}>안녕하세요!</Text>
                  <Text style={styles.greetingSub}>반려동물을 등록하고 시작해보세요</Text>
                </>
              )}
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.settingsBtn,
                pressed && { opacity: 0.6 },
              ]}
              onPress={handleSettingsPress}
              accessibilityRole="button"
              accessibilityLabel="설정"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.settingsIcon}>설정</Text>
            </Pressable>
          </View>
        </View>

        {/* ── A区：宠物档案卡片 ────────────────────────────── */}
        {loading ? (
          <View style={styles.profileCardWrapper}>
            <View style={[styles.profileAvatarPlaceholder, { backgroundColor: '#DDE6EF', opacity: 0.5 }]} />
            <View style={styles.profileTextColumn}>
              <View style={{ height: 14, width: '60%', borderRadius: 7, backgroundColor: '#DDE6EF' }} />
              <View style={{ height: 12, width: '40%', borderRadius: 6, backgroundColor: '#DDE6EF', marginTop: 8 }} />
            </View>
          </View>
        ) : petData ? (
          <TouchableOpacity
            style={styles.profileCardWrapper}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/records')}
          >
            {petData.avatar_url ? (
              <Image
                source={{ uri: petData.avatar_url }}
                style={{ width: 60, height: 60, borderRadius: 30 }}
              />
            ) : (
              <View style={styles.profileAvatarPlaceholder} />
            )}
            <View style={styles.profileTextColumn}>
              <Text style={styles.profileName}>{petData.name}</Text>
              <Text style={styles.profileBreed}>
                {petData.breed || petData.species} · {petData.age_years ?? '?'}살
              </Text>
            </View>
            <Text style={styles.profileArrow}>›</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.profileCardWrapper}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/records')}
          >
            <View style={styles.profileAvatarPlaceholder} />
            <View style={styles.profileTextColumn}>
              <Text style={styles.profileName}>반려동물을 등록해보세요</Text>
              <Text style={styles.profileBreed}>档案 탭에서 프로필을 만들어주세요</Text>
            </View>
            <Text style={styles.profileArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* ── B区：功能入口双列卡片 ────────────────────────── */}
        <View style={styles.quickRow}>
          {/* 左：健康检测 */}
          <TouchableOpacity
            style={styles.quickCard}
            activeOpacity={0.8}
            onPress={() => router.push("/(tabs)/health-check")}
          >
            <Image source={require('../../assets/icons/health.png')} style={styles.quickCardIcon} />
            <View>
              <Text style={styles.quickCardTitle}>건강 검진</Text>
              <Text style={styles.quickCardSub}>6가지 전문 검사</Text>
            </View>
          </TouchableOpacity>

          {/* 右：心理健康 */}
          <TouchableOpacity
            style={styles.quickCard}
            activeOpacity={0.8}
            onPress={() => router.push('/mental')}
          >
            <Image source={require('../../assets/icons/play.png')} style={styles.quickCardIcon} />
            <View>
              <Text style={styles.quickCardTitle}>정신 건강</Text>
              <Text style={styles.quickCardSub}>감정 상태 평가</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── D区：AI健康问诊（Hero Banner） ──────────────── */}
        <View style={styles.consultCard}>
          <Text style={styles.consultTitle}>AI 건강 상담</Text>
          <Text style={styles.consultSub}>
            AI와 걱정을 나누고 전문적인 조언을 받으세요
          </Text>
          <TouchableOpacity
            style={styles.consultBtn}
            activeOpacity={0.8}
            onPress={() => router.push("/(tabs)/consult")}
          >
            <Text style={styles.consultBtnText}>상담 시작</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── 样式 ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#FAFCFF" },
  scroll: {
    paddingHorizontal: 24,
    paddingTop:        8,
    paddingBottom:     120,
  },

  // ── 问候区 ────────────────────────────────────────────────
  greetingWrap: { marginBottom: 20 },
  greetingRow: {
    flexDirection: "row",
    alignItems:    "flex-start",
    justifyContent: "space-between",
  },
  greetingTexts: { flex: 1 },
  greetingTitle: {
    fontFamily:   "NotoSerifKR_700Bold",
    fontSize:     24,
    color:        "#2B3A55",
    marginBottom: 4,
  },
  greetingSub: {
    fontFamily: "Pretendard-Regular",
    fontSize:   14,
    color:      "#7A8DA3",
  },
  settingsBtn: {
    width:           44,
    height:          44,
    alignItems:      "center",
    justifyContent:  "center",
    marginTop:       -4,
  },
  settingsIcon: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      "#7A8DA3",
  },

  // ── A区：宠物档案卡片（Profile Card） ────────────────────
  profileCardWrapper: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: '#F0F4F8',
    borderRadius:    16,
    padding:         16,
    marginBottom:    20,
  },
  profileAvatarPlaceholder: {
    width:           60,
    height:          60,
    borderRadius:    30,
    backgroundColor: '#DDE6EF',
  },
  profileTextColumn: {
    flex:       1,
    marginLeft: 14,
  },
  profileName: {
    fontFamily:   'NotoSerifKR_700Bold',
    fontSize:     18,
    color:        '#2B3A55',
    marginBottom: 4,
  },
  profileBreed: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   14,
    color:      '#7A8DA3',
  },
  profileArrow: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   22,
    color:      '#7A8DA3',
    marginLeft: 8,
  },

  // ── B区：双列功能卡片 ─────────────────────────────────────
  quickRow: {
    flexDirection: "row",
    gap:           12,
    marginBottom:  20,
  },
  quickCard: {
    flex:            1,
    height:          130,
    backgroundColor: "#FFFFFF",
    borderRadius:    20,
    padding:         20,
    alignItems:      "flex-start",
    justifyContent:  "space-between",
    shadowColor:     "#BDE0FE",
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.45,
    shadowRadius:    20,
    elevation:       4,
  },
  quickCardIcon: { width: 60, height: 60, resizeMode: 'contain', marginBottom: 16 },
  quickCardTitle: {
    fontFamily: "Pretendard-SemiBold",
    fontSize:   15,
    color:      "#2B3A55",
  },
  quickCardSub: {
    fontFamily: "Pretendard-Regular",
    fontSize:   12,
    color:      "#7A8DA3",
    marginTop:  2,
  },

  // ── D区：AI问诊卡片（Hero Banner） ────────────────────────
  consultCard: {
    backgroundColor: "#BDE0FE",
    borderRadius:    24,
    padding:         28,
    minHeight:       200,
    justifyContent:  "space-between",
    marginBottom:    16,
    shadowColor:     "#BDE0FE",
    shadowOffset:    { width: 0, height: 8 },
    shadowOpacity:   0.45,
    shadowRadius:    24,
    elevation:       6,
  },
  consultTitle: {
    fontFamily:   "NotoSerifKR_700Bold",
    fontSize:     22,
    color:        "#2B3A55",
    marginBottom: 8,
  },
  consultSub: {
    fontFamily:   "Pretendard-Regular",
    fontSize:     14,
    color:        "#2B3A55",
    opacity:      0.7,
    marginBottom: 24,
    lineHeight:   22,
  },
  consultBtn: {
    height:          64,
    borderRadius:    32,
    backgroundColor: "rgba(255,255,255,0.85)",
    alignItems:      "center",
    justifyContent:  "center",
    shadowColor:     "#2B3A55",
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.08,
    shadowRadius:    8,
    elevation:       2,
  },
  consultBtnText: {
    fontFamily: "Pretendard-SemiBold",
    fontSize:   17,
    color:      "#2B3A55",
  },
});
