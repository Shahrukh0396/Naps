import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import AppAlert, {
  type AppAlertButton,
  type AppAlertConfig,
} from '../components/AppAlert';

type ShowAlert = (config: AppAlertConfig) => void;

const AlertContext = createContext<ShowAlert>(() => {});

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppAlertConfig | null>(null);

  const showAlert = useCallback((next: AppAlertConfig) => {
    setConfig(next);
  }, []);

  const close = useCallback(() => {
    setConfig(null);
  }, []);

  const buttons: AppAlertButton[] = useMemo(() => {
    if (config?.buttons && config.buttons.length > 0) return config.buttons;
    return [{ label: 'OK', variant: 'gold' }];
  }, [config]);

  return (
    <AlertContext.Provider value={showAlert}>
      {children}
      <AppAlert
        visible={!!config}
        title={config?.title ?? ''}
        message={config?.message}
        tone={config?.tone}
        buttons={buttons}
        onRequestClose={close}
      />
    </AlertContext.Provider>
  );
}

export function useAppAlert() {
  return useContext(AlertContext);
}
