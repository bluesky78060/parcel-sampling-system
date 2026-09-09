import { useState, useCallback, useRef, useEffect } from 'react';
import type { Parcel } from '../types';
import { batchGeocode } from '../lib/batchGeocoder';
import { isGeocodingAvailable } from '../lib/kakaoGeocoder';
import type { GeocodeDiagnosticKind } from '../lib/batchGeocoder';

/**
 * batchGeocode가 돌려준 최종 진단 중 화면이 쓰는 값.
 *
 * 개별 숫자 필드로 상태에 펼쳐 두면 "진단이 아직 없다"와 "진단이 있고 0건이다"가
 * 같은 `0`이 된다. 실제로 그 둘을 구분하지 못해 실행 중 화면이 실패 내역을
 * 공허한 등식(0+0+0+0 === 0)으로 "검산 통과"시키고 빈 목록을 그렸다.
 * 그래서 진단은 한 덩어리로 두고, 없을 때는 null이다.
 */
export interface GeocodingSummary {
  /**
   * 실제로 좌표를 확보한 필지 수 (확정값).
   *
   * `progress.done - progress.failed`로 대신하면 안 된다. progress는 화면을 움직이는
   * 보고 채널이지 결과의 출처가 아니다 — Phase 0가 추정치를 보고하던 때 그 뺄셈이
   * 250건을 449건으로 표시했다. 지금은 실제값을 보고하지만, 출처를 진단 하나로 두는
   * 원칙은 그대로다.
   */
  resolved: number;
  /** 서버는 응답했으나 좌표를 찾지 못한 필지 수 */
  notFound: number;
  /**
   * 호출 한도 초과로 막힌 필지 수.
   *
   * 서버 미응답과 반드시 갈라야 한다. 미응답은 "다시 실행하면 재시도됩니다"가 맞지만
   * 한도는 오늘 안에 회복되지 않아 같은 안내가 정반대 지시가 된다.
   */
  quotaBlocked: number;
  /** 서버가 응답하지 않아 실패한 필지 수 */
  unreachable: number;
  /** 인증 거부로 실패한 필지 수 */
  authBlocked: number;
  /**
   * 시도했는데 실패한 필지 수. 위 네 항목의 합이 정확히 이것이다.
   *
   * `progress.failed`로 대신하면 안 된다. 그것은 `onProgress` 콜백이 만든 별개의 수라
   * 오늘 우연히 같을 뿐 같다는 보장이 없다.
   */
  attemptedFailures: number;
}

export interface GeocodingState {
  isRunning: boolean;
  /** note는 Phase 0(PNU 일괄 조회)처럼 done이 오래 멈춰 있는 구간의 활동 표시다 */
  progress: { done: number; total: number; failed: number; note?: string };
  isComplete: boolean;
  error: string | null;
  /**
   * 서버 장애로 변환을 포기했는가.
   *
   * error만으로는 부족하다. 2026-09-06 장애에서 전량 실패했는데도 isComplete가
   * true로 잡혀 화면에 "좌표 변환 완료!"가 떴다. 실패 원인이 데이터인지 서버인지
   * 구분되지 않는 것이 사용자가 계속 재시도하게 만든 직접 원인이었다.
   */
  serviceDown: boolean;
  /**
   * 중단 사유. serviceDown일 때만 의미가 있다.
   *
   * 화면 문구는 이 값 하나로 갈라야 한다. 예전에는 진행 카드가 실패 건수 비교로
   * 사유를 따로 판정해, 진단이 "한도 초과(지금 다시 해도 같다)"로 정한 실행에서
   * 카드에는 "나중에 다시 실행하면 건너뜁니다"가 붙었다 — 같은 화면에 반대 지시.
   */
  failureKind: GeocodeDiagnosticKind | null;
  /** 최종 진단. 실행 중·취소·예외에서는 null이다. */
  summary: GeocodingSummary | null;
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
  serviceDown: false,
  failureKind: null,
  summary: null,
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
      ...initialState,
      isRunning: true,
      progress: { done: 0, total: parcels.length, failed: 0 },
    });

    try {
      const { parcels: result, diagnostics } = await batchGeocode(parcels, {
        force,
        onProgress: (done: number, total: number, failed: number, note?: string) => {
          // 취소된 실행의 늦은 보고는 버린다. 취소 시점에 서버에 나가 있던 요청은
          // 응답이 올 때까지 살아 있고, 그 보고가 **다음 실행**의 상태에 섞인다.
          if (abortController.signal.aborted) return;
          // 보고값을 그대로 쓴다. 예전에는 Math.max로 단조 증가를 강제했는데, 그것은
          // Phase 0가 추정치를 보고하던 시절 진행 바가 뒤로 튕기는 것을 가리던 장치였다.
          // 지금은 실제 확보 건수만 보고하므로 클램프가 필요 없고, 남겨 두면 잘못된
          // 보고(예: 취소된 실행의 늦은 값)를 조용히 굳히는 쪽으로만 작용한다.
          setState((prev) => ({ ...prev, progress: { done, total, failed, note } }));
        },
        signal: abortController.signal,
      });

      // 취소된 경우 상태 업데이트 생략
      if (abortController.signal.aborted) {
        return result;
      }

      // 서버 장애로 끝났으면 완료로 표시하지 않는다.
      // "완료"라고 적어놓고 성공 0건인 화면이 이번 장애에서 가장 큰 혼란이었다.
      setState((prev) => ({
        ...prev,
        isRunning: false,
        isComplete: !diagnostics.serviceDown,
        serviceDown: diagnostics.serviceDown,
        failureKind: diagnostics.serviceDown ? diagnostics.failureKind : null,
        summary: {
          resolved: diagnostics.pnuResolved + diagnostics.addressResolved,
          notFound: diagnostics.notFound,
          quotaBlocked: diagnostics.quotaBlocked,
          unreachable: diagnostics.unreachable,
          authBlocked: diagnostics.authBlocked,
          attemptedFailures: diagnostics.attemptedFailures,
        },
        error: diagnostics.message ?? prev.error,
      }));

      if (diagnostics.serviceDown) {
        console.error('[useGeocoding] 서버 장애로 변환 중단:', diagnostics.detail);
      }

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
