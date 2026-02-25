import { useState, useCallback, useRef, useEffect } from 'react';
import type { Parcel } from '../types';
import { batchGeocode } from '../lib/batchGeocoder';
import { isGeocodingAvailable } from '../lib/kakaoGeocoder';

interface GeocodingState {
  isRunning: boolean;
  progress: { done: number; total: number; failed: number };
  isComplete: boolean;
  error: string | null;
}

interface UseGeocodingReturn {
  state: GeocodingState;
  startGeocoding: (parcels: Parcel[], force?: boolean) => Promise<Parcel[]>;
  cancelGeocoding: () => void;
  resetState: () => void;
  isAvailable: boolean;
}

const initialState: GeocodingState = {
  isRunning: false,
  progress: { done: 0, total: 0, failed: 0 },
  isComplete: false,
  error: null,
};

export function useGeocoding(): UseGeocodingReturn {
  const [state, setState] = useState<GeocodingState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isAvailable = isGeocodingAvailable();

  // 언마운트 시 진행 중인 geocoding 자동 취소
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const startGeocoding = useCallback(async (parcels: Parcel[], force = false): Promise<Parcel[]> => {
    // 이미 실행 중이면 기존 작업 취소
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setState({
      isRunning: true,
      progress: { done: 0, total: parcels.length, failed: 0 },
      isComplete: false,
      error: null,
    });

    try {
      const result = await batchGeocode(parcels, {
        force,
        onProgress: (done: number, total: number, failed: number) => {
          setState((prev) => ({
            ...prev,
            progress: { done, total, failed },
          }));
        },
        signal: abortController.signal,
      });

      // 취소된 경우 상태 업데이트 생략
      if (abortController.signal.aborted) {
        return result;
      }

      setState((prev) => ({
        ...prev,
        isRunning: false,
        isComplete: true,
      }));

      return result;
    } catch (err) {
      // AbortError는 에러로 처리하지 않음
      if (err instanceof Error && err.name === 'AbortError') {
        setState((prev) => ({
          ...prev,
          isRunning: false,
          isComplete: false,
        }));
        return parcels;
      }

      const errorMessage =
        err instanceof Error ? err.message : 'Geocoding 중 알 수 없는 오류가 발생했습니다.';

      setState((prev) => ({
        ...prev,
        isRunning: false,
        isComplete: false,
        error: errorMessage,
      }));

      throw err;
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  }, []);

  const cancelGeocoding = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;

      setState((prev) => ({
        ...prev,
        isRunning: false,
        isComplete: false,
        error: null,
      }));
    }
  }, []);

  const resetState = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    state,
    startGeocoding,
    cancelGeocoding,
    resetState,
    isAvailable,
  };
}
