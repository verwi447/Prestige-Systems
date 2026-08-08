import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ClipboardList, FileText, Search, Wrench, X } from "lucide-react";
import { search as searchAPI } from "../api";
import { isClientRole } from "../lib/permissions";
import "./GlobalSearch.css";

export const GLOBAL_SEARCH_EVENT = "open-global-search";

const EMPTY_RESULTS = { companies: [], offers: [], tickets: [], orders: [] };
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export default function GlobalSearch({ user }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const requestIdRef = useRef(0);
  const navigate = useNavigate();
  const isClient = isClientRole(user?.role);

  useEffect(() => {
    const openSearch = () => setOpen(true);
    const handleKeydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener(GLOBAL_SEARCH_EVENT, openSearch);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener(GLOBAL_SEARCH_EVENT, openSearch);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  useEffect(() => {
    if (open) {
      const frameId = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(frameId);
    }
    setQuery("");
    setResults(EMPTY_RESULTS);
    setLoading(false);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const requestId = ++requestIdRef.current;
    const timeoutId = window.setTimeout(() => {
      searchAPI.query(trimmed)
        .then((response) => {
          if (requestIdRef.current === requestId) setResults(response.data || EMPTY_RESULTS);
        })
        .catch(() => {
          if (requestIdRef.current === requestId) setResults(EMPTY_RESULTS);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [query, open]);

  const sections = useMemo(() => ([
    !isClient && {
      key: "companies",
      label: "Firmy klientów",
      icon: Building2,
      items: results.companies.map((company) => ({
        id: company.id,
        title: company.name,
        subtitle: [company.city, company.nip].filter(Boolean).join(" · "),
        path: `/companies/${company.id}`
      }))
    },
    {
      key: "offers",
      label: "Oferty",
      icon: FileText,
      items: results.offers.map((offer) => ({
        id: offer.id,
        title: offer.offer_number,
        subtitle: [offer.title, offer.customer_name].filter(Boolean).join(" · "),
        path: isClient ? `/client/offers/${offer.id}` : `/offers/${offer.id}`
      }))
    },
    {
      key: "orders",
      label: "Zamówienia",
      icon: ClipboardList,
      items: results.orders.map((order) => ({
        id: order.id,
        title: order.order_number,
        subtitle: [order.subject, order.customer_name].filter(Boolean).join(" · "),
        path: isClient ? `/client/orders/${order.id}` : `/orders/${order.id}`
      }))
    },
    {
      key: "tickets",
      label: "Zgłoszenia",
      icon: Wrench,
      items: results.tickets.map((ticket) => ({
        id: ticket.id,
        title: ticket.ticket_number,
        subtitle: [ticket.subject, ticket.customer_name].filter(Boolean).join(" · "),
        path: isClient ? `/client/tickets/${ticket.id}` : `/tickets/${ticket.id}`
      }))
    }
  ].filter(Boolean)), [results, isClient]);

  const totalCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.items.length, 0),
    [sections]
  );

  if (!open) return null;

  const trimmedQuery = query.trim();
  const goTo = (path) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="global-search-backdrop" onClick={() => setOpen(false)}>
      <div className="global-search-modal" role="dialog" aria-modal="true" aria-label="Wyszukiwanie" onClick={(event) => event.stopPropagation()}>
        <div className="global-search-input-row">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj firmy, oferty, zamówienia, zgłoszenia..."
          />
          <button type="button" aria-label="Zamknij wyszukiwanie" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>

        <div className="global-search-results">
          {trimmedQuery.length < MIN_QUERY_LENGTH && (
            <p className="global-search-hint">Wpisz co najmniej 2 znaki, aby wyszukać.</p>
          )}
          {trimmedQuery.length >= MIN_QUERY_LENGTH && loading && (
            <p className="global-search-hint">Szukam...</p>
          )}
          {trimmedQuery.length >= MIN_QUERY_LENGTH && !loading && totalCount === 0 && (
            <p className="global-search-hint">Brak wyników dla „{trimmedQuery}”.</p>
          )}
          {sections.map((section) => section.items.length > 0 && (
            <div className="global-search-section" key={section.key}>
              <div className="global-search-section-label">{section.label}</div>
              {section.items.map((item) => (
                <button
                  type="button"
                  className="global-search-result"
                  key={`${section.key}-${item.id}`}
                  onClick={() => goTo(item.path)}
                >
                  <section.icon size={16} aria-hidden="true" />
                  <span>
                    <strong>{item.title}</strong>
                    {item.subtitle && <small>{item.subtitle}</small>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="global-search-footer">
          <span><kbd>Ctrl</kbd> + <kbd>K</kbd> aby otworzyć</span>
          <span><kbd>Esc</kbd> aby zamknąć</span>
        </div>
      </div>
    </div>
  );
}
