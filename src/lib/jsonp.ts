/**
 * JSONP 요청 헬퍼
 *
 * VWORLD API는 CORS 헤더(Access-Control-Allow-Origin)를 보내지 않는다.
 * 배포 도메인에서 fetch로 호출하면 서버는 200 OK를 주지만 브라우저가 응답을 차단한다.
 * VWORLD가 callback 파라미터로 JSONP를 지원하므로 script 태그로 우회한다.
 *
 * fetch와 달리 네이티브 타임아웃·취소가 없으므로 직접 관리한다.
 */

/** JSONP 요청이 시간 내에 응답하지 않았을 때 */
export class JsonpTimeoutError extends Error {
  constructor(url: string) {
    super(`JSONP timeout: ${url}`);
    this.name = 'JsonpTimeoutError';
  }
}

/** script 로드 자체가 실패했을 때 (네트워크 오류, 4xx/5xx 등) */
export class JsonpNetworkError extends Error {
  constructor(url: string) {
    super(`JSONP network error: ${url}`);
    this.name = 'JsonpNetworkError';
  }
}

let callbackSeq = 0;

interface JsonpOptions {
  /** 콜백 함수명을 담을 쿼리 파라미터 이름 (기본: callback) */
  callbackParam?: string;
  /** 타임아웃 (기본: 15초) */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * JSONP로 JSON을 가져온다.
 * 성공·실패·취소 어느 경로로 끝나든 script 태그와 전역 콜백을 반드시 정리한다.
 */
export function jsonp<T = unknown>(
  baseUrl: string,
  params: Record<string, string>,
  options?: JsonpOptions,
): Promise<T> {
  const callbackParam = options?.callbackParam ?? 'callback';
  const timeoutMs = options?.timeoutMs ?? 15000;
  const signal = options?.signal;

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    // 예측 불가능한 콜백 이름 — 응답이 전역을 덮어쓰지 않도록
    const cbName = `__vworldJsonp_${Date.now().toString(36)}_${(callbackSeq++).toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const search = new URLSearchParams({ ...params, [callbackParam]: cbName });
    const url = `${baseUrl}?${search}`;

    const script = document.createElement('script');
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener('abort', onAbort);
      script.onerror = null;
      script.remove();
      // 응답이 늦게 도착해도 전역에 남지 않도록 삭제한다
      delete (window as unknown as Record<string, unknown>)[cbName];
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    function onAbort() {
      settle(() => reject(new DOMException('Aborted', 'AbortError')));
    }

    (window as unknown as Record<string, unknown>)[cbName] = (data: T) => {
      settle(() => resolve(data));
    };

    script.onerror = () => {
      settle(() => reject(new JsonpNetworkError(url)));
    };

    timer = setTimeout(() => {
      settle(() => reject(new JsonpTimeoutError(url)));
    }, timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });

    script.src = url;
    script.async = true;
    document.head.appendChild(script);
  });
}
