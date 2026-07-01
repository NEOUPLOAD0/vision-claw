import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnalyzeVision } from '@workspace/api-client-react';

type AppState = 'idle' | 'recording' | 'processing' | 'responding';

export default function VisionClawScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micGranted, setMicGranted] = useState(false);
  const [appState, setAppState] = useState<AppState>('idle');
  const [response, setResponse] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const insets = useSafeAreaInsets();

  // Pulse animation values for the record ring
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.5);

  const { mutateAsync: analyzeVision } = useAnalyzeVision();

  // Request mic permission on mount
  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ granted }) => {
      setMicGranted(granted);
    });
  }, []);

  // Pulse ring animation while recording
  useEffect(() => {
    if (appState === 'recording') {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.6, { duration: 700 }),
          withTiming(1, { duration: 700 })
        ),
        -1,
        false
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 700 }),
          withTiming(0.5, { duration: 700 })
        ),
        -1,
        false
      );
    } else {
      pulseScale.value = withTiming(1, { duration: 300 });
      pulseOpacity.value = withTiming(0, { duration: 300 });
    }
  }, [appState, pulseScale, pulseOpacity]);

  const pulseRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  const startRecording = useCallback(async () => {
    if (appState !== 'idle') return;

    if (!micGranted) {
      const { granted } = await Audio.requestPermissionsAsync();
      setMicGranted(granted);
      if (!granted) {
        Alert.alert('Microphone needed', 'Please grant microphone access to use voice.');
        return;
      }
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MEDIUM,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 64000,
        },
      });

      await recording.startAsync();
      recordingRef.current = recording;
      setAppState('recording');
    } catch (err) {
      console.error('Start recording failed:', err);
    }
  }, [appState, micGranted]);

  const stopAndAnalyze = useCallback(async () => {
    if (appState !== 'recording' || !recordingRef.current) return;

    setAppState('processing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      // Stop recording
      await recordingRef.current.stopAndUnloadAsync();
      const audioUri = recordingRef.current.getURI() ?? null;
      recordingRef.current = null;

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      // Capture camera frame
      let imageBase64: string | undefined;
      if (cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.5,
          exif: false,
        });
        imageBase64 = photo?.base64 ?? undefined;
      }

      if (!imageBase64) {
        setResponse('Could not capture camera frame. Please try again.');
        setAppState('idle');
        return;
      }

      // Read audio to base64 (native only)
      let audioBase64: string | undefined;
      if (audioUri && Platform.OS !== 'web') {
        audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
          encoding: 'base64' as FileSystem.EncodingType,
        });
      }

      // Call Gemini via backend
      const result = await analyzeVision({
        data: {
          imageBase64,
          imageMimeType: 'image/jpeg',
          audioBase64,
          audioMimeType: 'audio/mp4',
        },
      });

      const text = result.response;
      setResponse(text);
      setAppState('responding');

      // Speak the response
      Speech.speak(text, {
        rate: 1.0,
        pitch: 1.0,
        onDone: () => {
          setIsSpeaking(false);
          setAppState('idle');
        },
        onError: () => {
          setIsSpeaking(false);
          setAppState('idle');
        },
      });
      setIsSpeaking(true);
    } catch (err) {
      console.error('Analysis failed:', err);
      setResponse('Analysis failed. Please try again.');
      setAppState('idle');
    }
  }, [appState, analyzeVision]);

  const stopSpeaking = useCallback(() => {
    Speech.stop();
    setIsSpeaking(false);
    setAppState('idle');
  }, []);

  // --- Permission / loading gates ---
  if (!cameraPermission) {
    return <View style={styles.dark} />;
  }

  if (!cameraPermission.granted) {
    return (
      <View style={[styles.permScreen, { paddingTop: insets.top + 40 }]}>
        <Ionicons name="eye-outline" size={72} color="#00e5ff" />
        <Text style={styles.permTitle}>Camera Access Required</Text>
        <Text style={styles.permBody}>
          Vision Claw uses your camera to see and analyze the world around you.
        </Text>
        <Pressable style={styles.permBtn} onPress={requestCameraPermission}>
          <Text style={styles.permBtnText}>Grant Camera Access</Text>
        </Pressable>
        {!cameraPermission.canAskAgain && Platform.OS !== 'web' && (
          <Text style={styles.permHint}>
            Permission denied. Enable it in device Settings.
          </Text>
        )}
      </View>
    );
  }

  const statusMap: Record<AppState, string> = {
    idle: 'Hold to ask',
    recording: 'Listening…',
    processing: 'Thinking…',
    responding: isSpeaking ? 'Speaking…' : 'Done',
  };

  return (
    <View style={styles.root}>
      {/* Live camera fills screen */}
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Vignette overlay */}
      <View style={styles.vignette} pointerEvents="none" />

      {/* Top status bar */}
      <View
        style={[styles.topBar, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12) }]}
        pointerEvents="none"
      >
        <View style={styles.statusPill}>
          <View
            style={[
              styles.dot,
              appState === 'idle' && styles.dotIdle,
              appState === 'recording' && styles.dotRecord,
              appState === 'processing' && styles.dotProcess,
              appState === 'responding' && styles.dotRespond,
            ]}
          />
          <Text style={styles.statusText}>{statusMap[appState]}</Text>
        </View>
      </View>

      {/* Response bubble */}
      {response.length > 0 && (
        <View style={[styles.responseCard, { top: insets.top + (Platform.OS === 'web' ? 67 : 0) + 80 }]}>
          <ScrollView
            style={styles.responseScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.responseText}>{response}</Text>
          </ScrollView>
          {appState === 'idle' && (
            <Pressable
              onPress={() => setResponse('')}
              style={styles.closeBtn}
            >
              <Ionicons name="close-circle" size={22} color="#7a8fa6" />
            </Pressable>
          )}
        </View>
      )}

      {/* Bottom controls */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom:
              insets.bottom + (Platform.OS === 'web' ? 34 : 24),
          },
        ]}
      >
        {/* Stop speaking button */}
        {appState === 'responding' && isSpeaking && (
          <Pressable style={styles.stopBtn} onPress={stopSpeaking}>
            <Ionicons name="stop" size={24} color="#fff" />
          </Pressable>
        )}

        {/* Processing spinner */}
        {appState === 'processing' && (
          <View style={styles.processingRing}>
            <Ionicons name="scan" size={40} color="#00e5ff" />
          </View>
        )}

        {/* Hold-to-talk button */}
        {(appState === 'idle' || appState === 'recording') && (
          <View style={styles.btnWrapper}>
            {/* Animated pulse ring */}
            <Animated.View style={[styles.pulseRing, pulseRingStyle]} />

            <Pressable
              onPressIn={startRecording}
              onPressOut={stopAndAnalyze}
              style={({ pressed }) => [
                styles.holdBtn,
                pressed && styles.holdBtnActive,
                appState === 'recording' && styles.holdBtnRecording,
              ]}
            >
              <Ionicons
                name={appState === 'recording' ? 'mic' : 'mic-outline'}
                size={38}
                color={appState === 'recording' ? '#ff3040' : '#00e5ff'}
              />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#080c10',
  },
  dark: {
    flex: 1,
    backgroundColor: '#080c10',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // Simulate vignette using border opacity gradient
    borderWidth: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },

  // --- Permission screen ---
  permScreen: {
    flex: 1,
    backgroundColor: '#080c10',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 20,
  },
  permTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    marginTop: 8,
  },
  permBody: {
    color: '#7a8fa6',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  permBtn: {
    backgroundColor: '#00e5ff',
    borderRadius: 14,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 8,
  },
  permBtnText: {
    color: '#000000',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  permHint: {
    color: '#7a8fa6',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },

  // --- Top bar ---
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8,12,16,0.72)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.15)',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotIdle: { backgroundColor: '#7a8fa6' },
  dotRecord: { backgroundColor: '#ff3040' },
  dotProcess: { backgroundColor: '#ffaa00' },
  dotRespond: { backgroundColor: '#00e5ff' },
  statusText: {
    color: '#e0f7fa',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.5,
  },

  // --- Response card ---
  responseCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    maxHeight: 220,
    backgroundColor: 'rgba(8,12,16,0.88)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.18)',
    padding: 16,
  },
  responseScroll: {
    flex: 1,
  },
  responseText: {
    color: '#e8f4f8',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  closeBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
  },

  // --- Bottom bar ---
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
  },
  stopBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,48,64,0.25)',
    borderWidth: 2,
    borderColor: '#ff3040',
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,229,255,0.08)',
    borderWidth: 2,
    borderColor: 'rgba(0,229,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
  },
  pulseRing: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: '#ff3040',
    backgroundColor: 'rgba(255,48,64,0.12)',
  },
  holdBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,229,255,0.1)',
    borderWidth: 2.5,
    borderColor: '#00e5ff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00e5ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  holdBtnActive: {
    backgroundColor: 'rgba(0,229,255,0.18)',
    transform: [{ scale: 0.95 }],
  },
  holdBtnRecording: {
    backgroundColor: 'rgba(255,48,64,0.12)',
    borderColor: '#ff3040',
    shadowColor: '#ff3040',
  },
});
