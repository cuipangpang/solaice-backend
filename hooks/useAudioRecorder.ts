/**
 * hooks/useAudioRecorder.ts
 *
 * 올바른 초기화 순서:
 *   1. requestPermissionsAsync
 *   2. setAudioModeAsync (allowsRecordingIOS: true)
 *   3. Audio.Recording.createAsync
 *
 * stopRecording() 후 setAudioModeAsync(allowsRecordingIOS: false) 로 리셋.
 */

import { useRef, useState } from 'react'
import { Alert } from 'react-native'
import { Audio } from 'expo-av'

export function useAudioRecorder() {
  const recordingRef = useRef<Audio.Recording | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startRecording = async (): Promise<boolean> => {
    try {
      // Step 1: 권한 요청
      const { status } = await Audio.requestPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('마이크 권한', '설정에서 마이크 권한을 허용해주세요.')
        return false
      }

      // Step 2: 오디오 세션 설정 (Recording 객체 생성 전)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      })

      // Step 3: 녹음 객체 생성 및 시작
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      )

      recordingRef.current = recording
      setIsRecording(true)
      setDuration(0)
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
      return true
    } catch {
      Alert.alert('녹음 오류', '마이크를 초기화할 수 없습니다.')
      return false
    }
  }

  const stopRecording = async (): Promise<string | null> => {
    const rec = recordingRef.current
    if (!rec) return null

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    try {
      await rec.stopAndUnloadAsync()

      // 오디오 세션 녹음 모드 해제
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false })

      const uri = rec.getURI()
      recordingRef.current = null
      setIsRecording(false)
      setDuration(0)
      return uri ?? null
    } catch {
      recordingRef.current = null
      setIsRecording(false)
      setDuration(0)
      return null
    }
  }

  return { startRecording, stopRecording, isRecording, duration }
}
