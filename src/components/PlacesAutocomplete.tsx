import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { colors } from '../theme/colors';
import {
  fetchPlacePredictions,
  newPlacesSessionToken,
  type PlacePrediction,
} from '../services/placesAutocomplete';

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
}: PlacesAutocompleteProps) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const sessionTokenRef = useRef(newPlacesSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (trimmed.length < 2) {
      setPredictions([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const preds = await fetchPlacePredictions({
        input: trimmed,
        sessionToken: sessionTokenRef.current,
      });
      if (requestId !== requestIdRef.current) return;
      setPredictions(preds);
      setOpen(preds.length > 0);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setPredictions([]);
      setOpen(false);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const handleChange = (text: string) => {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 220);
  };

  const handleSelect = (pred: PlacePrediction) => {
    const val = pred.description;
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
      setOpen(false);
      setLoading(false);
    }
  }, [value]);

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
            if (predictions.length > 0) setOpen(true);
            else if (value.trim().length >= 2) runSearch(value);
          }}
        />
        {loading && <ActivityIndicator size="small" color={colors.lavenderSoft} />}
      </View>

      {open && predictions.length > 0 && (
        <View style={styles.dropdown}>
          {predictions.map(pred => (
            <Pressable
              key={pred.place_id}
              onPress={() => handleSelect(pred)}
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

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(196,181,244,0.15)',
    borderColor: colors.lavenderBorder,
  },
  inputRowGold: {
    backgroundColor: 'rgba(244,200,66,0.08)',
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
    borderColor: 'rgba(196,181,244,0.5)',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: colors.purple,
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
    borderBottomColor: 'rgba(196,181,244,0.35)',
  },
  predictionPressed: {
    backgroundColor: 'rgba(196,181,244,0.22)',
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
