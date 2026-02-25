import { useNavigate } from 'react-router-dom';

export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 py-12">
      {/* 헤더 */}
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          농업환경변동조사 필지 추출 시스템
        </h1>
        <p className="text-gray-500 text-lg">
          2026년 토양 시료 채취 대상 필지 추출 — 경상북도 봉화군
        </p>
      </div>

      {/* 카드 버튼 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-5xl">
        {/* 필지 추출 카드 */}
        <button
          onClick={() => navigate('/upload')}
          className="group bg-white border border-gray-200 rounded-2xl p-8 text-left shadow-sm hover:shadow-md hover:border-indigo-300 transition-all duration-200 cursor-pointer"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-indigo-100 group-hover:bg-indigo-200 transition-colors mb-5">
            <svg
              className="w-7 h-7 text-indigo-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">필지 추출 시작</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-4">
            엑셀 파일 업로드부터 최종 추출까지 6단계 워크플로로 대상 필지를 추출합니다.
          </p>
          <div className="flex flex-wrap gap-2">
            {['업로드', '매핑', '분석', '추출', '검토', '내보내기'].map((label, i) => (
              <span
                key={i}
                className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-full font-medium"
              >
                {i + 1}. {label}
              </span>
            ))}
          </div>
        </button>

        {/* 주소 합치기 카드 */}
        <button
          onClick={() => navigate('/address-merger')}
          className="group bg-white border border-gray-200 rounded-2xl p-8 text-left shadow-sm hover:shadow-md hover:border-amber-300 transition-all duration-200 cursor-pointer"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-amber-100 group-hover:bg-amber-200 transition-colors mb-5">
            <svg
              className="w-7 h-7 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 10h16M4 14h10M4 18h6M14 14l3 3 5-5"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">주소 합치기</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-4">
            시도·시군구·읍면동·리·번지 등 분리된 컬럼을 하나의 필지 주소로 합칩니다.
          </p>
          <div className="flex flex-wrap gap-2">
            {['엑셀 업로드', '컬럼 매핑', '주소 생성', '결과 다운로드'].map((label, i) => (
              <span
                key={i}
                className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs rounded-full font-medium"
              >
                {i + 1}. {label}
              </span>
            ))}
          </div>
        </button>

        {/* PNU 코드 생성 카드 */}
        <button
          onClick={() => navigate('/pnu-generator')}
          className="group bg-white border border-gray-200 rounded-2xl p-8 text-left shadow-sm hover:shadow-md hover:border-emerald-300 transition-all duration-200 cursor-pointer"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-emerald-100 group-hover:bg-emerald-200 transition-colors mb-5">
            <svg
              className="w-7 h-7 text-emerald-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">PNU 코드 생성</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-4">
            엑셀 파일에서 주소 컬럼을 매핑하여 19자리 PNU 코드를 일괄 생성합니다.
          </p>
          <div className="flex flex-wrap gap-2">
            {['엑셀 업로드', '컬럼 매핑', 'PNU 생성', '결과 다운로드'].map((label, i) => (
              <span
                key={i}
                className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium"
              >
                {i + 1}. {label}
              </span>
            ))}
          </div>
        </button>
      </div>

      {/* 시스템 요약 정보 */}
      <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-5xl">
        {[
          { label: '대상 지역', value: '봉화군' },
          { label: '추출 목표', value: '700필지' },
          { label: '워크플로', value: '6단계' },
          { label: 'PNU 길이', value: '19자리' },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-white border border-gray-200 rounded-xl px-4 py-4 text-center shadow-sm"
          >
            <div className="text-2xl font-bold text-gray-800">{item.value}</div>
            <div className="text-xs text-gray-500 mt-1">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
