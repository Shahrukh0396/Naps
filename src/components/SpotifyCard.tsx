import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

const SPOTIFY_GREEN = '#1DB954';

const MOCK_TRACKS = [
  { id: '1', title: 'Soft Lullaby Loop', artist: 'Quiet Drive', duration: '4:12' },
  { id: '2', title: 'Gentle White Noise', artist: 'Nap Waves', duration: '5:01' },
  { id: '3', title: 'Midnight Car Ride', artist: 'Sleepy Miles', duration: '3:48' },
];

interface SpotifyCardProps {
  durationMinutes: number;
}

/** Mock Spotify panel for Phase 1 — real OAuth comes in backend/integration. */
export default function SpotifyCard({ durationMinutes }: SpotifyCardProps) {
  const [connected, setConnected] = useState(false);
  const [playing, setPlaying] = useState(false);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.logoDot}>
          <Text style={{ color: SPOTIFY_GREEN, fontSize: 14, fontWeight: '800' }}>♪</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Spotify for the drive</Text>
          <Text style={styles.sub}>
            {connected
              ? `Playlist sized for ~${durationMinutes} min`
              : 'Mock connect — real auth in Phase 2'}
          </Text>
        </View>
      </View>

      {!connected ? (
        <Pressable style={styles.connectBtn} onPress={() => setConnected(true)}>
          <Text style={styles.connectText}>Connect Spotify</Text>
        </Pressable>
      ) : (
        <View style={{ gap: 8 }}>
          {MOCK_TRACKS.map(t => (
            <View key={t.id} style={styles.trackRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.trackTitle}>{t.title}</Text>
                <Text style={styles.trackArtist}>{t.artist}</Text>
              </View>
              <Text style={styles.trackDur}>{t.duration}</Text>
            </View>
          ))}
          <View style={styles.actions}>
            <Pressable
              style={styles.playBtn}
              onPress={() => setPlaying(v => !v)}>
              <Text style={styles.playText}>{playing ? 'Pause' : 'Play mix'}</Text>
            </Pressable>
            <Pressable
              style={styles.disconnectBtn}
              onPress={() => {
                setConnected(false);
                setPlaying(false);
              }}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(29,185,84,0.25)',
    padding: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  logoDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(29,185,84,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 13, fontWeight: '700', color: colors.purple },
  sub: { fontSize: 11, color: colors.lavenderSoft, marginTop: 2 },
  connectBtn: {
    backgroundColor: SPOTIFY_GREEN,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  connectText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(196,181,244,0.35)',
  },
  trackTitle: { fontSize: 13, fontWeight: '600', color: colors.purple },
  trackArtist: { fontSize: 11, color: colors.lavenderSoft },
  trackDur: { fontSize: 11, color: colors.lavenderSoft },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  playBtn: {
    flex: 1,
    backgroundColor: colors.purple,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  playText: { color: colors.cream, fontWeight: '700', fontSize: 13 },
  disconnectBtn: {
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
    justifyContent: 'center',
  },
  disconnectText: { color: colors.purpleMuted, fontWeight: '600', fontSize: 12 },
});
