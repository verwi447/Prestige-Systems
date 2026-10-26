// Jedno zrodlo prawdy dla statusow ofert i zgloszen.
//
// Statusy sa trzymane w bazie jako polskie napisy (pilnuje tego CHECK na
// kolumnie offers.status), wiec kazdy plik, ktory filtrowal po statusie, mial
// wlasna kopie listy - lacznie z wariantami, ktore powstaly po bledach
// kodowania przy starszych importach. Kazda kolejna awaria kodowania dokladala
// kolejny wariant do kolejnej tablicy i nic tego nie weryfikowalo.
//
// Docelowo kolumna powinna trzymac kod (SENT, COMPLETED...), a polskie nazwy
// zyc w warstwie prezentacji. Do tego czasu wszystkie listy pochodza stad.

export const OFFER_STATUS = {
  DRAFT: "SZKIC",
  SENT: "WYSŁANA",
  IN_PROGRESS: "W REALIZACJI",
  TO_ACCEPTANCE: "DO AKCEPTACJI",
  ACCEPTED: "ZAAKCEPTOWANA",
  REJECTED: "ODRZUCONA",
  COMPLETED: "ZAKOŃCZONA"
};

// Dokladnie te wartosci dopuszcza CHECK na offers.status - lista musi sie z
// nim zgadzac, inaczej zapis konczy sie bledem bazy zamiast walidacja 400.
export const OFFER_STATUSES = Object.values(OFFER_STATUS);

export const TICKET_STATUSES = [
  "NEW",
  "ACCEPTED",
  "IN_PROGRESS",
  "WAITING_FOR_CLIENT",
  "WAITING_FOR_PARTS",
  "REJECTED",
  "COMPLETED",
  "CANCELLED"
];

export const TERMINAL_TICKET_STATUSES = ["REJECTED", "COMPLETED", "CANCELLED"];

// Warianty zapisane w bazie przez starsze wersje aplikacji i przez importy z
// uszkodzonym kodowaniem. Trzymane osobno i wylacznie do ODCZYTU - nic nowego
// nie powinno byc nimi zapisywane. Lista jest zamknieta: jesli pojawi sie
// kolejny wariant, nalezy naprawic dane, a nie dopisywac go tutaj.
const LEGACY_ALIASES = {
  [OFFER_STATUS.SENT]: ["WYSĹANA", "WYSÄąÂANA", "SENT"],
  [OFFER_STATUS.TO_ACCEPTANCE]: ["TO_ACCEPTANCE"],
  ZAKOŃCZONE: ["ZAKOĹCZONE", "ZAKONCZONE"],
  ZAMKNIĘTE: ["ZAMKNIÄTE", "ZAMKNIETE"]
};

const withAliases = (...values) => [
  ...new Set(values.flatMap((value) => [value, ...(LEGACY_ALIASES[value] || [])]))
];

// Oferta czeka na decyzje klienta - moze ja zaakceptowac albo odrzucic.
export const OFFER_DECISION_STATUSES = withAliases(OFFER_STATUS.SENT, OFFER_STATUS.TO_ACCEPTANCE);

// Oferty, ktorych klient nie powinien zobaczyc w ogole.
export const HIDDEN_CLIENT_OFFER_STATUSES = [OFFER_STATUS.DRAFT, "DRAFT"];

// Zgloszenia zamkniete: polskie napisy z roznych epok plus kody obecne w
// tickets.status.
export const CLOSED_TICKET_STATUSES = [
  ...withAliases("ZAKOŃCZONE", "ZAMKNIĘTE"),
  "ANULOWANE",
  "ODRZUCONE",
  ...TERMINAL_TICKET_STATUSES
];

// Przejscie oferty w ten status jest momentem publikacji wobec klienta.
export const PUBLISHING_OFFER_STATUSES = [OFFER_STATUS.SENT, OFFER_STATUS.TO_ACCEPTANCE];

const DIACRITIC_FOLD = { Ł: "L", ł: "l" };

// Porownanie odporne na diakrytyki i na czesc bledow kodowania: "WYSĹANA"
// rozklada sie do "WYSLANA" tak samo jak "WYSŁANA". Do uzytku w JS - zapytania
// SQL dostaja gotowe listy powyzej.
export function normalizeStatus(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[Łł]/g, (character) => DIACRITIC_FOLD[character] || character)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const matches = (value, list) => {
  const normalized = normalizeStatus(value);
  return list.some((entry) => normalizeStatus(entry) === normalized);
};

export const isOfferAwaitingDecision = (status) => matches(status, OFFER_DECISION_STATUSES);
export const isClosedTicketStatus = (status) => matches(status, CLOSED_TICKET_STATUSES);
export const isHiddenClientOfferStatus = (status) => matches(status, HIDDEN_CLIENT_OFFER_STATUSES);
