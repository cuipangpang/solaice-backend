/**
 * audioRecorder.ts — 음성 녹음 + Qwen Paraformer ASR 유틸
 *
 * 의존성: expo-av
 * 설치: npx expo install expo-av
 *
 * ASR: 백엔드 /api/v1/upload/transcribe → Qwen paraformer-v2
 * EXPO_PUBLIC_QWEN_API_KEY 불필요 (백엔드 QWEN_API_KEY 사용)
 */

import { Audio } from 'expo-av'

let _recording: Audio.Recording | null = null

/** 녹음 시작. 권한 요청 포함. true=성공, false=실패/권한 없음 */
export async function startRecording(): Promise<boolean> {
  try {
    const { status } = await Audio.requestPermissionsAsync()
    if (status !== 'granted') return false

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    })

    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    )
    _recording = recording
    return true
  } catch (e) {
    console.error('[audioRecorder] startRecording error:', e)
    return false
  }
}

/** 녹음 중지. 파일 URI 반환 (실패 시 null) */
export async function stopRecording(): Promise<string | null> {
  try {
    if (!_recording) return null
    await _recording.stopAndUnloadAsync()
    const uri = _recording.getURI()
    _recording = null
    return uri ?? null
  } catch (e) {
    console.error('[audioRecorder] stopRecording error:', e)
    _recording = null
    return null
  }
}

/**
 * 백엔드 /api/v1/upload/transcribe → Qwen Paraformer ASR로 한국어 STT.
 * 백엔드 실패 시 빈 문자열 반환 (크래시 없음).
 */
export async function transcribeAudio(fileUri: string): Promise<string> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL
    if (!apiUrl) {
      console.warn('[audioRecorder] EXPO_PUBLIC_API_URL 없음. ASR 스킵.')
      return ''
    }

    const formData = new FormData()
    formData.append('file', {
      uri: fileUri,
      type: 'audio/m4a',
      name: 'audio.m4a',
    } as any)

    const response = await fetch(`${apiUrl}/upload/transcribe`, {
      method: 'POST',
      body: formData,
      // Content-Type 헤더 미설정 → FormData가 boundary 포함해서 자동 설정
    })

    if (!response.ok) {
      console.warn('[audioRecorder] ASR 백엔드 응답 오류:', response.status)
      return ''
    }

    const data = await response.json()
    return data.transcript || ''
  } catch (e) {
    console.error('[audioRecorder] transcribeAudio error:', e)
    return ''
  }
}
