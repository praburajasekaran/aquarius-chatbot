import type { ReactNode } from "react";
import { styles } from "@/lib/email/styles";

export interface DataTableRow {
  label: string;
  value: ReactNode;
}

interface DataTableProps {
  rows: DataTableRow[];
}

export function DataTable({ rows }: DataTableProps) {
  return (
    <table style={styles.table}>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td style={styles.tableLabelCell}>{row.label}</td>
            <td style={styles.tableValueCell}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
