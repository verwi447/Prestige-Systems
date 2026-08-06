import { useMemo } from "react";
import AdminTicketsView from "./AdminTicketsView";
import ClientTicketsView from "./ClientTicketsView";

export default function MyTickets({ clientScope = "tickets" }) {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);
  const isAdmin = user?.role === "ADMIN";
  return isAdmin ? <AdminTicketsView /> : <ClientTicketsView scope={clientScope} user={user} />;
}
