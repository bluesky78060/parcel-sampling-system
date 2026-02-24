import type { Statistics } from '../../types';

interface StatsDashboardProps {
  statistics: Statistics;
}

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  iconColor: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, iconColor, icon }: StatCardProps) {
  return (
    <div className="rounded-lg shadow-sm border border-gray-200 bg-white p-4 flex items-start gap-3">
      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-gray-500 truncate">{label}</p>
        <div className="text-2xl font-bold text-gray-900 mt-0.5">{value}</div>
      </div>
    </div>
  );
}

export function StatsDashboard({ statistics }: StatsDashboardProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard
        label="전체 필지 수"
        value={statistics.totalParcels.toLocaleString()}
        iconColor="bg-blue-100 text-blue-600"
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        }
      />
      <StatCard
        label="2024 기채취"
        value={statistics.sampled2024.toLocaleString()}
        iconColor="bg-red-100 text-red-600"
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        }
      />
      <StatCard
        label="2025 기채취"
        value={statistics.sampled2025.toLocaleString()}
        iconColor="bg-orange-100 text-orange-600"
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />
      <StatCard
        label="추출 가능 필지"
        value={statistics.eligibleParcels.toLocaleString()}
        iconColor="bg-green-100 text-green-600"
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />
      <StatCard
        label="리(里) 수"
        value={statistics.uniqueRis.toLocaleString()}
        iconColor="bg-purple-100 text-purple-600"
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
      />
      <StatCard
        label="목표 달성 가능 여부"
        value={
          statistics.canMeetTarget ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
              가능 (700 달성)
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-red-100 text-red-800">
              불가능 ({statistics.eligibleParcels} / 700)
            </span>
          )
        }
        iconColor={statistics.canMeetTarget ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}
        icon={
          statistics.canMeetTarget ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )
        }
      />
    </div>
  );
}
