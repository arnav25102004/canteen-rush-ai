import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Lang } from './copy';
import { ensureLoaded, getOrderQueueState, OrderQueueState, subscribeQueue } from '../../services/feedbackQueue';

const LANG_KEY = 'feedback_lang';

/** English by default; the choice is remembered. */
export function useFeedbackLang(): [Lang, () => void] {
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((v) => { if (v === 'hi') setLang('hi'); }).catch(() => {});
  }, []);
  const toggle = useCallback(() => {
    setLang((l) => {
      const next: Lang = l === 'en' ? 'hi' : 'en';
      AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
      return next;
    });
  }, []);
  return [lang, toggle];
}

/** 'sending' | 'queued' | null for one order's pending review. */
export function useQueueState(orderId: string): OrderQueueState {
  const [state, setState] = useState<OrderQueueState>(null);
  useEffect(() => {
    const update = () => setState(getOrderQueueState(orderId));
    void ensureLoaded().then(update);
    return subscribeQueue(update);
  }, [orderId]);
  return state;
}
