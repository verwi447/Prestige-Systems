import { useEffect, useState } from "react";
import { companies } from "../../api";

const formatDate = (date) => (date ? new Date(date).toLocaleDateString("pl-PL") : "-");

export default function CompanyTicketsTab({ companyId }) {
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    companies.getTickets(companyId).then((response) => setTickets(response.data || [])).catch(() => setTickets([]));
  }, [companyId]);

  return (
    <section className="company-tab-panel">
      <div className="tab-panel-header">
        <div>
          <h3>Zgłoszenia</h3>
          <p>Zgłoszenia serwisowe i zadania powiązane z firmą.</p>
        </div>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Numer</th>
              <th>Typ</th>
              <th>Status</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>{ticket.ticket_number || "-"}</td>
                <td>{ticket.type || "-"}</td>
                <td>{ticket.status || "-"}</td>
                <td>{formatDate(ticket.created_at)}</td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan="4">Brak zgłoszeń dla tej firmy.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
