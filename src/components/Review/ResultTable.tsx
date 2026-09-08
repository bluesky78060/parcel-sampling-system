import { useRef, useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Parcel } from '../../types';
import { isRepresentative, isPublicPayment } from '../../lib/parcelCategory';
import { parcelMatchKey } from '../../lib/parcelKey';

interface ResultTableProps {
  parcels: Parcel[];
  selectedParcels: Parcel[];
  onToggleSelection: (parcel: Parcel) => void;
  onAddParcel: (parcel: Parcel) => void;
  onRemoveParcel: (parcel: Parcel) => void;
  targetCount: number;
  /** 표시용 선택 수. 생략 시 selectedParcels.length (겹치는 필지가 2행으로 잡힘) */
  selectedCount?: number;
}

export function ResultTable({
  parcels,
  selectedParcels,
  onToggleSelection: _onToggleSelection,
  onAddParcel,
  onRemoveParcel,
  targetCount,
  selectedCount,
}: ResultTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => {
    const set = new Set<string>();
    for (const p of selectedParcels) {
      const key = parcelMatchKey(p);
      if (key !== null) set.add(key);
    }
    return set;
  }, [selectedParcels]);

  /**
   * 식별 불가능한(키가 `null`) 선정 필지의 **행 식별자** 집합.
   *
   * 예전에는 참조 집합이었는데, `addParcel`이 사본을 저장하면 참조가 끊겨
   * 그 필지의 선택 표시가 켜지지 않았다. `rowUid`는 파싱 시점에 부여되어
   * 사본에도 따라가므로 그 구멍이 없다.
   */
  const selectedRowUids = useMemo(
    () =>
      new Set(
        selectedParcels.filter((p) => parcelMatchKey(p) === null).map((p) => p.rowUid),
      ),
    [selectedParcels],
  );

  const columns = useMemo<ColumnDef<Parcel>[]>(
    () => [
      {
        id: 'selection',
        header: () => <span className="text-xs text-gray-500">선택</span>,
        cell: ({ row }) => {
          const parcel = row.original;
          // 키가 없으면 참조로 판정한다 — 선정분은 스토어의 객체가 그대로 넘어온다.
          const key = parcelMatchKey(parcel);
          const isSelected =
            key !== null ? selectedSet.has(key) : selectedRowUids.has(parcel.rowUid);
          const isRep = isRepresentative(parcel);

          if (isRep) {
            return (
              <span className="w-5 h-5 rounded border flex items-center justify-center bg-emerald-500 border-emerald-500 text-white cursor-not-allowed" title="대표필지 (고정)">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            );
          }

          // PNU도 주소도 지번도 없는 필지는 **선택할 수 없다.**
          //
          return (
            <button
              onClick={() => {
                if (isSelected) {
                  onRemoveParcel(parcel);
                } else {
                  onAddParcel(parcel);
                }
              }}
              className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                isSelected
                  ? 'bg-blue-500 border-blue-500 text-white'
                  : 'bg-white border-gray-300 hover:border-blue-400'
              }`}
              title={isSelected ? '선택 해제' : '선택'}
            >
              {isSelected && (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        },
        enableSorting: false,
        size: 50,
      },
      {
        id: 'category',
        header: '구분',
        cell: ({ row }) => {
          const p = row.original;
          // 공익 추출에도 뽑힌 대표필지는 두 성격을 다 가지므로 배지도 둘 다 보여준다
          return (
            <span className="inline-flex gap-0.5">
              {isRepresentative(p) && (
                <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700">대표</span>
              )}
              {isPublicPayment(p) && (
                <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-100 text-blue-700">공익</span>
              )}
            </span>
          );
        },
        enableSorting: false,
        size: 50,
      },
      {
        id: 'index',
        header: '#',
        cell: ({ row }) => (
          <span className="text-gray-400 text-xs">{row.index + 1}</span>
        ),
        enableSorting: false,
        size: 50,
      },
      {
        accessorKey: 'farmerId',
        header: '경영체번호',
        size: 90,
      },
      {
        accessorKey: 'farmerName',
        header: '경영체명',
        size: 80,
      },
      {
        accessorKey: 'parcelId',
        header: '필지번호',
        size: 90,
      },
      {
        accessorKey: 'address',
        header: '주소',
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <span className="truncate block max-w-[160px]" title={val}>
              {val}
            </span>
          );
        },
        size: 180,
      },
      {
        accessorKey: 'ri',
        header: '리',
        size: 80,
      },
      {
        accessorKey: 'area',
        header: '면적',
        cell: ({ getValue }) => {
          const val = getValue<number | undefined>();
          if (val == null) return <span className="text-gray-400">-</span>;
          return <span>{val.toLocaleString()}</span>;
        },
        size: 80,
      },
      {
        accessorKey: 'sampledYears',
        header: '채취이력',
        cell: ({ getValue }) => {
          const years = getValue<number[]>();
          if (!years || years.length === 0) {
            return <span className="text-gray-400 text-xs">없음</span>;
          }
          const sorted = [...years].sort((a, b) => a - b);
          return (
            <span className={`text-xs font-medium ${years.length >= 2 ? 'text-red-600' : 'text-orange-500'}`}>
              {sorted.join(', ')}
            </span>
          );
        },
        enableSorting: false,
        size: 100,
      },
    ],
    [selectedSet, selectedRowUids, onAddParcel, onRemoveParcel]
  );

  const table = useReactTable({
    data: parcels,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const search = String(filterValue).toLowerCase();
      const { farmerId, farmerName, parcelId, address, ri } = row.original;
      return (
        farmerId.toLowerCase().includes(search) ||
        (farmerName ?? '').toLowerCase().includes(search) ||
        parcelId.toLowerCase().includes(search) ||
        (address ?? '').toLowerCase().includes(search) ||
        (ri ?? '').toLowerCase().includes(search)
      );
    },
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 바 */}
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="경영체번호, 경영체명, 필지번호, 주소 검색..."
          className="flex-1 max-w-sm px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
          선택:{' '}
          <span className="text-blue-600 font-semibold">{selectedCount ?? selectedParcels.length}</span>
          <span className="text-gray-400"> / {targetCount}</span>
        </span>
      </div>

      {/* 테이블 스크롤 컨테이너 */}
      <div
        ref={tableContainerRef}
        className="max-h-[600px] overflow-auto border border-gray-200 rounded-lg"
      >
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className={`px-3 py-2 text-left text-xs font-semibold text-gray-600 select-none ${
                        canSort ? 'cursor-pointer hover:bg-gray-100' : ''
                      }`}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="text-gray-400">
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '⇅'}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: paddingTop }} colSpan={columns.length} />
              </tr>
            )}
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              const parcel = row.original;
              const key = parcelMatchKey(parcel);
              const isSelected =
            key !== null ? selectedSet.has(key) : selectedRowUids.has(parcel.rowUid);
              const isRep = isRepresentative(parcel);

              return (
                <tr
                  key={row.id}
                  data-index={virtualRow.index}
                  className={`border-b border-gray-100 transition-colors ${
                    isRep
                      ? 'bg-emerald-50 hover:bg-emerald-100'
                      : isSelected
                      ? 'bg-blue-50 hover:bg-blue-100'
                      : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="px-3 py-2"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: paddingBottom }} colSpan={columns.length} />
              </tr>
            )}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="py-12 text-center text-gray-400 text-sm">
            검색 결과가 없습니다.
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        총 {rows.length.toLocaleString()}개 행 표시 (전체 {parcels.length.toLocaleString()}개)
      </p>
    </div>
  );
}
