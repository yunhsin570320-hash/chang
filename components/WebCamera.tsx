import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform } from 'react-native';
import { Camera, X, RotateCcw } from 'lucide-react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';

interface WebCameraProps {
  visible: boolean;
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

// Native camera (iOS/Android)
function NativeCamera({ visible, onCapture, onClose }: WebCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const cameraRef = useRef<CameraView>(null);

  if (!visible) return null;

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, base64: true });
    if (photo?.base64) {
      onCapture(`data:image/jpeg;base64,${photo.base64}`);
    } else if (photo?.uri) {
      onCapture(photo.uri);
    }
  };

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={styles.nativeContainer}>
        {!permission?.granted ? (
          <View style={styles.permissionBox}>
            <Camera size={48} color="#555" />
            <Text style={styles.permissionText}>需要相機權限才能拍照</Text>
            <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>授予權限</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelLink} onPress={onClose}>
              <Text style={styles.cancelLinkText}>取消</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView ref={cameraRef} style={styles.nativeCamera} facing={facing} />
            <View style={styles.nativeHeader}>
              <TouchableOpacity onPress={onClose} style={styles.nativeHeaderBtn}>
                <X size={26} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.nativeTitle}>拍攝商品照片</Text>
              <TouchableOpacity
                onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
                style={styles.nativeHeaderBtn}
              >
                <RotateCcw size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.nativeControls}>
              <TouchableOpacity style={styles.captureBtn} onPress={handleCapture}>
                <View style={styles.captureBtnInner} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

// Web camera using getUserMedia
function WebCameraImpl({ visible, onCapture, onClose }: WebCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const startStream = useCallback(async (facing: 'user' | 'environment') => {
    setError(null);
    setReady(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: false,
      });
      streamRef.current = stream;
      const attach = () => {
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => { video.play().catch(() => {}); setReady(true); };
        } else {
          setTimeout(attach, 50);
        }
      };
      attach();
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('相機權限被拒絕，請在瀏覽器設定中允許相機存取');
      } else if (name === 'NotFoundError') {
        setError('找不到相機裝置');
      } else if (name === 'NotReadableError') {
        setError('相機已被其他應用程式佔用');
      } else {
        setError('無法存取相機，請確認裝置有相機且頁面使用 HTTPS');
      }
    }
  }, []);

  useEffect(() => {
    if (visible) { startStream(facingMode); }
    else { stopStream(); }
    return () => stopStream();
  }, [visible]);

  const handleFlip = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    startStream(next);
  };

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    stopStream();
    onCapture(dataUrl);
  };

  const handleClose = () => { stopStream(); onClose(); };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>拍攝商品照片</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.viewfinder}>
            {error ? (
              <View style={styles.errorBox}>
                <Camera size={48} color="#555" />
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => startStream(facingMode)}>
                  <Text style={styles.retryText}>重試</Text>
                </TouchableOpacity>
              </View>
            ) : (
              // @ts-ignore
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', backgroundColor: '#000' } as any}
              />
            )}
            {!ready && !error && (
              <View style={styles.loadingOverlay}>
                <Text style={styles.loadingText}>啟動相機中...</Text>
              </View>
            )}
          </View>

          {!error && (
            <View style={styles.controls}>
              <TouchableOpacity style={styles.flipBtn} onPress={handleFlip}>
                <RotateCcw size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.captureBtn, !ready && styles.captureBtnDisabled]}
                onPress={handleCapture}
                disabled={!ready}
              >
                <View style={styles.captureBtnInner} />
              </TouchableOpacity>
              <View style={{ width: 48 }} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function WebCamera(props: WebCameraProps) {
  if (Platform.OS !== 'web') {
    return <NativeCamera {...props} />;
  }
  return <WebCameraImpl {...props} />;
}

const styles = StyleSheet.create({
  // Native styles
  nativeContainer: { flex: 1, backgroundColor: '#000' },
  nativeCamera: { flex: 1 },
  nativeHeader: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  nativeHeaderBtn: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  nativeControls: {
    position: 'absolute',
    bottom: 48, left: 0, right: 0,
    alignItems: 'center',
  },
  permissionBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0D0D1A', gap: 16, padding: 32,
  },
  permissionText: { color: '#ccc', fontSize: 15, textAlign: 'center' },
  permissionBtn: {
    paddingHorizontal: 28, paddingVertical: 12,
    backgroundColor: '#00D4AA', borderRadius: 10,
  },
  permissionBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  cancelLink: { marginTop: 8 },
  cancelLinkText: { color: '#666', fontSize: 14 },

  // Web styles
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#0D0D1A',
    borderRadius: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  viewfinder: {
    width: '100%',
    aspectRatio: 1.333,
    backgroundColor: '#000',
    position: 'relative',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  loadingText: { color: '#aaa', fontSize: 14 },
  errorBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 16, padding: 24,
  },
  errorText: { color: '#FF6B6B', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: 'rgba(0,212,170,0.15)',
    borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.4)',
  },
  retryText: { color: '#00D4AA', fontWeight: '600', fontSize: 14 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingVertical: 24,
  },
  flipBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  captureBtnDisabled: { opacity: 0.4 },
  captureBtnInner: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#fff',
  },
});
