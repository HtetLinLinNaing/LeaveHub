import * as React from "react"

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  keyOf: (row: T) => string
  mobileCard: (row: T) => React.ReactNode
  rowClassName?: (row: T) => string
  empty?: React.ReactNode
}

export function ResponsiveTable<T>({
  columns,
  rows,
  keyOf,
  mobileCard,
  rowClassName,
  empty,
}: Props<T>) {
  if (rows.length === 0) {
    return (
      <>{empty ?? <div className="rounded-lg border bg-white p-8 text-center text-gray-500">No items</div>}</>
    )
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border bg-white sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left">
              {columns.map((c) => (
                <th key={c.key} className={`px-4 py-3 font-medium ${c.className ?? ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={keyOf(row)} className={`border-b last:border-0 ${rowClassName?.(row) ?? ""}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y overflow-hidden rounded-lg border bg-white sm:hidden">
        {rows.map((row) => (
          <div key={keyOf(row)} className={`p-4 ${rowClassName?.(row) ?? ""}`}>
            {mobileCard(row)}
          </div>
        ))}
      </div>
    </>
  )
}
