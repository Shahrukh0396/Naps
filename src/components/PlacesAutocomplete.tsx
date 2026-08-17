import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { SavedPlace } from '../context/SettingsContext';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import {
  fetchPlacePredictions,
  newPlacesSessionToken,
  type PlacePrediction,
} from '../services/placesAutocomplete';

function placeIcon(kind: SavedPlace['kind']): string {
  if (kind === 'home') return '🏠';
  if (kind === 'work') return '🏢';
  return '📌';
}

interface PlacesAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  placeholder?: string;
  /** Visual variant for start vs end destination */
  variant?: 'default' | 'gold';
  autoFocus?: boolean;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  icon?: string;
  /** Saved places shown as suggestions above Google predictions */
  savedSuggestions?: SavedPlace[];
  /** Bias Google predictions toward this point (usually GPS). */
  biasLocation?: { lat: number; lng: number } | null;
}

export default function PlacesAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Enter an address…',
  variant = 'default',
  autoFocus,
  inputStyle,
  containerStyle,
  icon = '📍',
  savedSuggestions = [],
  biasLocation = null,
}: PlacesAutocompleteProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const sessionTokenRef = useRef(newPlacesSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const biasRef = useRef(biasLocation);
  biasRef.current = biasLocation;

  const filteredSaved = useMemo(() => {
    const q = value.trim().toLowerCase();
    const withAddr = savedSuggestions.filter(p => p.address.trim().length > 0);
    if (!q) return withAddr;
    return withAddr.filter(
      p =>
        p.label.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q),
    );
  }, [savedSuggestions, value]);

  const showDropdown =
    open && (filteredSaved.length > 0 || predictions.length > 0);

  const runSearch = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (trimmed.length < 2) {
      setPredictions([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const preds = await fetchPlacePredictions({
        input: trimmed,
        sessionToken: sessionTokenRef.current,
        location: biasRef.current,
      });
      if (requestId !== requestIdRef.current) return;
      setPredictions(preds);
      setOpen(true);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setPredictions([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const handleChange = (text: string) => {
    onChange(text);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 220);
  };

  const handleSelectPrediction = (pred: PlacePrediction) => {
    const val = pred.description;
    onChange(val);
    onSelect?.(val);
    setPredictions([]);
    setOpen(false);
    setLoading(false);
    sessionTokenRef.current = newPlacesSessionToken();
  };

  const handleSelectSaved = (place: SavedPlace) => {
    const val = place.address;
    onChange(val);
    onSelect?.(val);
    setPredictions([]);
    setOpen(false);
    setLoading(false);
    sessionTokenRef.current = newPlacesSessionToken();
  };

  useEffect(() => {
    if (!value) {
      setPredictions([]);
      setLoading(false);
      if (!focused) setOpen(false);
    }
  }, [value, focused]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isGold = variant === 'gold';

  return (
    <View style={[styles.wrap, containerStyle]}>
      <View
        style={[
          styles.inputRow,
          isGold ? styles.inputRowGold : styles.inputRowDefault,
        ]}>
        <Text style={styles.icon}>{icon}</Text>
        <TextInput
          value={value}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={colors.lavenderSoft}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.input, inputStyle]}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
            if (value.trim().length >= 2) runSearch(value);
          }}
          onBlur={() => {
            setFocused(false);
            // Delay so suggestion presses can register
            setTimeout(() => setOpen(false), 180);
          }}
        />
        {loading && <ActivityIndicator size="small" color={colors.lavenderSoft} />}
      </View>

      {showDropdown && (
        <View style={styles.dropdown}>
          {filteredSaved.map(place => (
            <Pressable
              key={place.id}
              onPress={() => handleSelectSaved(place)}
              style={({ pressed }) => [
                styles.predictionRow,
                pressed && styles.predictionPressed,
              ]}>
              <Text style={styles.pin}>{placeIcon(place.kind)}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.mainText} numberOfLines={1}>
                  {place.label}
                </Text>
                <Text style={styles.secondaryText} numberOfLines={1}>
                  {place.address}
                </Text>
              </View>
            </Pressable>
          ))}
          {predictions.map(pred => (
            <Pressable
              key={pred.place_id}
              onPress={() => handleSelectPrediction(pred)}
              style={({ pressed }) => [
                styles.predictionRow,
                pressed && styles.predictionPressed,
              ]}>
              <Text style={styles.pin}>📍</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.mainText} numberOfLines={1}>
                  {pred.structured_formatting?.main_text ?? pred.description}
                </Text>
                {!!pred.structured_formatting?.secondary_text && (
                  <Text style={styles.secondaryText} numberOfLines={1}>
                    {pred.structured_formatting.secondary_text}
                  </Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      width: '100%',
      zIndex: 20,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 2,
      borderRadius: 16,
      paddingHorizontal: 12,
      minHeight: 48,
      gap: 8,
    },
    inputRowDefault: {
      backgroundColor: colors.inputBg,
      borderColor: colors.lavenderBorder,
    },
    inputRowGold: {
      backgroundColor: colors.goldSoft,
      borderColor: 'rgba(244,200,66,0.45)',
    },
    icon: { fontSize: 14 },
    input: {
      flex: 1,
      color: colors.purple,
      fontSize: 14,
      paddingVertical: 10,
    },
    dropdown: {
      marginTop: 6,
      backgroundColor: colors.cream,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      borderRadius: 14,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    predictionRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.lavenderBorder,
    },
    predictionPressed: {
      backgroundColor: colors.lavenderWash,
    },
    pin: { fontSize: 12, marginTop: 2 },
    mainText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.purple,
    },
    secondaryText: {
      fontSize: 11,
      color: colors.lavenderSoft,
      marginTop: 2,
    },
  });
}
